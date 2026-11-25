# First run

1. Extract the complete ZIP on Windows x64. Keep `Ramo` together.
2. Run `ramoresearchresponsiveuinativeeditor.exe`. The app is unsigned; compare the ZIP's published SHA-256 if Windows shows a SmartScreen warning.
3. In Setup, choose **Start Ollama** or **Download Ollama** if needed. If its API uses another loopback port, edit the port and refresh. Choose models yourself from the Ollama library based on your hardware and their licenses, then run `ollama pull <model-id>`. Cloud API models are a complete alternative and can be created and assigned in Setup.
4. Choose **Refresh detection**. Ramo suggests Fast (smallest), Smart (mid-size), and Super Smart (largest); change any assignment before finishing.
5. Search needs no account to try AnySearch's direct anonymous API. Add an AnySearch key if you have one. Tavily is only a keyed reserve.
6. Cloud models are optional. Save a provider key, then add an API model and its provider model ID from the model picker.

Ramo stores chats, settings and keys in the Windows per-user application-data profile, not in the ZIP folder. Delete that profile as well as the extracted folder to remove all local data. Export chats before deleting them.

PDF/document tools create a local Python environment on first use. Scanned documents download OCRia-nano-1 through LiteParse on first OCR use. OCR is CPU-only and never invokes Ollama or another vision/LLM model. TTS and STT are opt-in from Settings and set up locally when enabled.
