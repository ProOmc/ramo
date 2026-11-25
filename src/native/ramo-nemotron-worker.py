"""Ramo-owned, offline microphone dictation worker.

Engine: NVIDIA Nemotron Streaming 0.6B (cache-aware FastConformer-RNNT),
exported to ONNX and run by sherpa-onnx. English only: this file replaces the
earlier Moonshine worker and keeps its JSON-line protocol, so the renderer, the
pet and ``LocalSpeech`` in ``ramo-local-stt.js`` do not need a second code
path.

Protocol: JSON objects on stdout, one per line.
- Default (one-shot): stdin accepts 'stop'. Emits partial/final once, then exits.
- Persistent (--persistent flag): keeps the model hot between sessions so pet
  mode never pays a model load per turn. stdin commands (one per line):
    start    -> begin a new capture session, emits 'ready'
    stop     -> end the current capture, emits 'final', stays alive
    shutdown -> flush and exit 0
- Setup (--setup --root <dir>): install the ONNX model.
- Decode (--decode <wav> --root <dir>): run one fixed WAV through the same
  recognizer and print 'final'; used by tools/live-stt.cjs. No microphone.

No cloud speech recognition. The microphone is opened only while a session is
listening and is released between sessions so a game can use it.
"""
import json
import os
import queue
import sys
import tarfile
import threading
import time
import urllib.request
import wave

# sherpa-onnx export of nvidia/nemotron-speech-streaming-en-0.6b. The 560 ms
# chunk is the accuracy/latency balance recommended by the model card.
MODEL = {
    'name': 'sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25',
    'url': 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'
           'sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25.tar.bz2',
    'label': 'Nemotron Streaming 0.6B',
}

# Silence policy. Hold-to-talk normally ends on the explicit 'stop' sent when
# the user releases the button; these timers are the safety net for a session
# that is left open (dictation without Stop, or a held button with no speech).
# The 1.6 s pause matches the earlier worker's 1.45 s finish, widened a little
# because Nemotron updates its partial text once per 560 ms chunk.
SILENCE_FINAL_SECONDS = 1.6
NO_SPEECH_SECONDS = 30.0
MAX_SESSION_SECONDS = 100.0
TAIL_PADDING_SECONDS = 0.2


def emit(kind, **fields):
    print(json.dumps({'type': kind, **fields}, ensure_ascii=False), flush=True)


def model_path(root):
    return os.path.join(root, 'models', MODEL['name'])


def model_ready(root):
    directory = model_path(root)
    return all(
        os.path.isfile(os.path.join(directory, name))
        for name in ('encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt')
    )


def download_model(root):
    """Download and unpack the model. Returns True when the files exist."""
    if model_ready(root):
        return True
    directory = model_path(root)
    if os.path.isdir(directory):
        # A partial or corrupt extraction: start from a clean directory.
        import shutil
        shutil.rmtree(directory, ignore_errors=True)
    models = os.path.join(root, 'models')
    os.makedirs(models, exist_ok=True)
    archive = os.path.join(models, MODEL['name'] + '.tar.bz2')
    part = archive + '.part'
    emit('status', message='Downloading ' + MODEL['label'] + ' (about 450 MB, one time)')
    started = time.time()
    last_report = [0.0]

    def report(blocks, block_size, total):
        done = blocks * block_size
        now = time.time()
        if total and (now - last_report[0] >= 4.0 or done >= total):
            last_report[0] = now
            pct = min(100, int(done * 100 / total))
            emit('status', message='Downloading ' + MODEL['label'] + ': ' + str(pct) + '%')

    urllib.request.urlretrieve(MODEL['url'], part, report)
    os.replace(part, archive)
    emit('status', message='Unpacking ' + MODEL['label'])
    with tarfile.open(archive, 'r:bz2') as tar:
        try:
            tar.extractall(models, filter='data')
        except TypeError:  # Python < 3.11.4 has no extraction filters
            tar.extractall(models)
    try:
        os.remove(archive)
    except OSError:
        pass
    if not model_ready(root):
        raise RuntimeError('The ' + MODEL['label'] + ' model did not unpack correctly')
    emit('status', message=MODEL['label'] + ' ready (downloaded in %.0fs)' % (time.time() - started))
    return True


def create_recognizer(root):
    import sherpa_onnx

    directory = model_path(root)
    if not model_ready(root):
        raise RuntimeError(MODEL['label'] + ' is not installed yet')
    # Three threads measured at about 0.75x real time for speech on this
    # machine, and it stayed stable across repeated turns. Four threads and
    # more were slower in the sustained case (thread pool oversubscription), so
    # three is the default. RAMO_STT_THREADS overrides it.
    threads = int(os.environ.get('RAMO_STT_THREADS') or 3)
    provider = os.environ.get('RAMO_STT_PROVIDER') or 'cpu'
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=os.path.join(directory, 'tokens.txt'),
        encoder=os.path.join(directory, 'encoder.int8.onnx'),
        decoder=os.path.join(directory, 'decoder.int8.onnx'),
        joiner=os.path.join(directory, 'joiner.int8.onnx'),
        num_threads=max(1, threads),
        sample_rate=16000,
        feature_dim=128,          # Nemotron uses 128-bin log-mel features.
        model_type='nemotron',    # Selects sherpa's NeMo transducer loop.
        decoding_method='greedy_search',
        # Endpoint detection is deliberately off: hold-to-talk ends on the
        # explicit stop, and our own silence policy is easier to reason about
        # than resetting the stream mid-utterance.
        enable_endpoint_detection=False,
        provider=provider,
    )


class Microphone:
    """Open the capture device only for the duration of one session."""

    def __init__(self, events):
        self.events = events
        self.input = None
        self.rate = 16000

    def open(self):
        import sounddevice as sd
        last_error = None
        # 16 kHz is the model rate. If PortAudio cannot open the device at that
        # rate, 48 kHz still works because sherpa-onnx resamples internally.
        for rate in (16000, 48000):
            try:
                def callback(indata, frames, time_info, status):
                    if status:
                        # Overflows are not fatal; the audio that did arrive is
                        # still decoded. Report once per session at most.
                        self.events.put(('audio_status', str(status)))
                    self.events.put(('audio', indata[:, 0].copy()))

                stream = sd.InputStream(
                    samplerate=rate,
                    channels=1,
                    dtype='float32',
                    blocksize=int(rate * 0.1),
                    callback=callback,
                )
                stream.start()
                self.input = stream
                self.rate = rate
                return rate
            except Exception as exc:  # try the next rate
                last_error = exc
        raise RuntimeError('Microphone unavailable: ' + str(last_error))

    def close(self):
        stream = self.input
        self.input = None
        if stream is None:
            return
        try:
            stream.stop()
        except Exception:
            pass
        try:
            stream.close()
        except Exception:
            pass


class Session:
    """One utterance: a sherpa stream plus the mic that feeds it."""

    def __init__(self, recognizer, events):
        self.recognizer = recognizer
        self.events = events
        self.mic = Microphone(events)
        self.rate = 16000
        self.stream = None
        self.text = ''
        self.last_change = None
        self.started = 0.0

    def start(self):
        self.stream = self.recognizer.create_stream()
        self.rate = self.mic.open()
        self.text = ''
        self.last_change = None
        self.started = time.monotonic()

    def accept(self, samples):
        self.stream.accept_waveform(self.rate, samples)

    def _decode(self):
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)

    def update(self):
        """Decode pending audio and return the current partial text."""
        self._decode()
        text = self.recognizer.get_result(self.stream)
        if text != self.text:
            if text:
                self.last_change = time.monotonic()
            self.text = text
        return self.text

    def finalize(self):
        """Flush the decoder, close the mic and return the final text."""
        try:
            import numpy as np
            self.stream.accept_waveform(
                self.rate, np.zeros(int(self.rate * TAIL_PADDING_SECONDS), dtype=np.float32)
            )
        except Exception:
            pass
        try:
            self.stream.input_finished()
        except Exception:
            pass
        try:
            self._decode()
        except Exception:
            pass
        try:
            self.text = self.recognizer.get_result(self.stream)
        except Exception:
            pass
        # The device is released after decoding so the release cost is not on
        # the critical path between the user letting go and the text arriving.
        self.mic.close()
        return self.text.strip()


def serve_persistent(root, recognizer, events):
    emit('hot', message='Model loaded (kept hot)')
    state = 'idle'
    session = None
    audio_status = ''
    emitted = ''

    while True:
        try:
            kind, value = events.get(timeout=0.05)
        except queue.Empty:
            kind, value = None, None
        now = time.monotonic()

        if kind == 'cmd':
            if value == 'start' and state == 'idle':
                audio_status = ''
                emitted = ''
                try:
                    session = Session(recognizer, events)
                    session.start()
                except Exception as exc:
                    emit('error', message=str(exc))
                    session = None
                    continue
                state = 'listening'
                emit('ready', message='Listening')
            elif value in ('stop', 'shutdown') and state == 'listening':
                text = session.finalize() if session else ''
                session = None
                state = 'idle'
                emit('final', text=text)
                if value == 'shutdown':
                    break
            elif value == 'shutdown':
                break
            continue

        if kind == 'error':
            emit('error', message=value)
            if state == 'listening' and session:
                text = session.finalize()
                session = None
                state = 'idle'
                emit('final', text=text)
            continue

        if state != 'listening' or session is None:
            continue  # discard stale audio while idle

        if kind == 'audio_status':
            if value and value != audio_status:
                audio_status = value
                emit('status', message='Audio input: ' + value[:120])
            continue
        if kind != 'audio':
            continue

        try:
            session.accept(value)
            text = session.update()
        except Exception as exc:
            emit('error', message='Local recognition failed: ' + str(exc))
            text = session.finalize() if session else ''
            session = None
            state = 'idle'
            emit('final', text=text)
            continue

        now = time.monotonic()  # decoding can take a moment; use fresh time
        if text and text != emitted:
            emitted = text
            emit('partial', text=text[:16000])
        last = session.last_change
        if last and now - last >= SILENCE_FINAL_SECONDS:
            text = session.finalize()
            session = None
            state = 'idle'
            emit('final', text=text)
        elif not text and now - session.started >= NO_SPEECH_SECONDS:
            emit('status', message='No speech detected')
            text = session.finalize()
            session = None
            state = 'idle'
            emit('final', text=text)
        elif now - session.started >= MAX_SESSION_SECONDS:
            text = session.finalize()
            session = None
            state = 'idle'
            emit('final', text=text)

    return 0


def serve_once(root, recognizer, events):
    emit('ready', message='Listening')
    session = None
    try:
        session = Session(recognizer, events)
        session.start()
    except Exception as exc:
        emit('error', message=str(exc))
        return 3
    audio_status = ''
    emitted = ''
    try:
        while True:
            try:
                kind, value = events.get(timeout=0.09)
            except queue.Empty:
                kind, value = None, None
            now = time.monotonic()
            if kind == 'cmd':
                break  # 'stop' from the caller, or stdin EOF.
            if kind == 'error':
                emit('error', message=value)
                break
            if kind == 'audio_status':
                if value and value != audio_status:
                    audio_status = value
                    emit('status', message='Audio input: ' + value[:120])
                continue
            if kind != 'audio':
                continue
            try:
                session.accept(value)
                text = session.update()
            except Exception as exc:
                emit('error', message='Local recognition failed: ' + str(exc))
                break
            now = time.monotonic()
            if text and text != emitted:
                emitted = text
                emit('partial', text=text[:16000])
            last = session.last_change
            if last and now - last >= SILENCE_FINAL_SECONDS:
                break
            if not text and now - session.started >= NO_SPEECH_SECONDS:
                emit('status', message='No speech detected')
                break
            if now - session.started >= MAX_SESSION_SECONDS:
                break
        text = session.finalize()
        emit('final', text=text)
        return 0
    finally:
        if session:
            session.mic.close()


def decode_wav(root, wav_path):
    import numpy as np
    recognizer = create_recognizer(root)
    with wave.open(wav_path, 'rb') as handle:
        rate = handle.getframerate()
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16)
    samples = samples.astype(np.float32) / 32768.0
    stream = recognizer.create_stream()
    step = int(0.1 * rate)
    started = time.time()
    for i in range(0, len(samples), step):
        stream.accept_waveform(rate, samples[i:i + step])
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
    stream.accept_waveform(rate, np.zeros(int(rate * TAIL_PADDING_SECONDS), dtype=np.float32))
    stream.input_finished()
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)
    text = recognizer.get_result(stream)
    emit('final', text=text, seconds=round(time.time() - started, 3), audio=round(len(samples) / rate, 3))
    return 0


def command_reader(events, persistent):
    try:
        for raw in sys.stdin:
            line = raw.strip().lower()
            if line in ('start', 'stop', 'shutdown', 'end'):
                events.put(('cmd', 'stop' if line == 'end' else line))
            elif line == '':
                continue
    except Exception:
        pass
    events.put(('cmd', 'shutdown'))  # stdin closed
    if not persistent:
        events.put(('cmd', 'stop'))    # one-shot workers end on EOF too


def option(raw, name, default=None):
    if name in raw:
        index = raw.index(name)
        if index + 1 < len(raw):
            return raw[index + 1]
    return default


def main():
    raw = sys.argv[1:]
    persistent = '--persistent' in raw
    root = option(raw, '--root')
    if root is None:
        root = os.path.join(os.path.expanduser('~'), '.ramo', 'speech')

    if '--setup' in raw:
        try:
            download_model(root)
            return 0
        except Exception as exc:
            emit('error', message='Could not install the speech model: ' + str(exc))
            return 2

    if '--decode' in raw:
        wav = option(raw, '--decode')
        try:
            return decode_wav(root, wav)
        except Exception as exc:
            emit('error', message='Could not decode ' + str(wav) + ': ' + str(exc))
            return 3

    if not model_ready(root):
        # One automatic install keeps the worker usable even when it is started
        # directly (the app normally installs ahead of time).
        try:
            download_model(root)
        except Exception as exc:
            emit('error', message='Speech model is not installed: ' + str(exc))
            return 3

    events = queue.Queue()

    try:
        emit('status', message='Loading ' + MODEL['label'])
        recognizer = create_recognizer(root)
    except Exception as exc:
        emit('error', message='Local speech model or microphone unavailable: ' + str(exc))
        return 3

    # Warm the capture device before the stdin reader thread starts. On Windows
    # the first PortAudio open in a process initialises the audio backend and is
    # slow (about 2 s), and doing it while another thread is blocked reading the
    # command pipe can stall the process outright. Paying that cost up front,
    # with the device released immediately, keeps the first dictation fast and
    # avoids the stall. The device is not held, so a game can still use the mic.
    try:
        warm = Microphone(events)
        warm.open()
        warm.close()
    except Exception:
        pass

    threading.Thread(target=command_reader, args=(events, persistent), daemon=True).start()

    if persistent:
        return serve_persistent(root, recognizer, events)
    return serve_once(root, recognizer, events)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        emit('error', message=str(exc))
        sys.exit(1)
