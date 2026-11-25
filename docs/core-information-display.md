# Core information display

This manual describes the current React source for Ramo's Chat surface. The
shell is assembled in [`src/ui/layout/App.tsx`](../src/ui/layout/App.tsx): the
home transcript, visual core, composer, toast host, and setup gate share one
`ShellProvider`.

## State and refresh

[`src/ui/lib/hooks.tsx`](../src/ui/lib/hooks.tsx) supplies the active chat,
messages, busy state, pending user text, live text/thinking buffers, and toast
state through `useShell()`.

- Runtime text and thinking deltas append to separate live buffers. Agent start,
  message end, and agent settlement clear those buffers; other runtime events
  refresh busy state and the chat snapshot.
- Activity events also refresh the view, with chat refreshes debounced by 120 ms.
  A 500 ms freshness timer covers missed events.
- Messages come from `conversationMessages()`. The live activity run is read
  separately from `assistantApi().session.turn.activity`.

## Chat transcript

[`src/ui/conversation/Home.tsx`](../src/ui/conversation/Home.tsx) maps each
stored message to a [`Turn`](../src/ui/conversation/Turn.tsx), in message order.
An idle chat shows “What are we working on?” and a short usage hint.

Each turn has separate `YOU` and `RAMO` articles:

- User and assistant text pass through `renderMarkdown`; user image attachments
  appear as thumbnails. Markdown code blocks have delegated copy buttons.
- Before the submitted exchange reaches the message store, `pendingUser` is
  shown as `YOU · sending`. It is retired only when that chat gains a message or
  the active chat changes.
- Assistant actions include Speak, Branch, Retry, Copy, and Delete; user actions
  include Edit and Delete. `ReplyStats` receives the turn's activity run.
- Completed assistant answers can contain charts, which `Turn` replaces with
  rendered SVG after Markdown rendering.

During a turn, Home shows `Ramo is working…` when there is neither live output
nor a live activity row. Live answer text and activity appear together in a
`RAMO · LIVE` article. Stored file cards follow the transcript.

Home keeps the view at the bottom while new messages or live output arrive,
unless the reader scrolls at least 240 px away. A **Latest** button then returns
to the end. Switching chats resets scroll and search. **Find** or Ctrl/Cmd+F
searches the transcript; Enter and Shift+Enter cycle matches, and Escape closes
search.

## Tool calls and results

[`src/ui/lib/activity.ts`](../src/ui/lib/activity.ts) defines `ActivityRun`,
`ActivityCall`, and `ActivityStep`. `gatherInlineRuns()` places each stored
message activity run at that message's index and appends a non-empty live run at
`messages.length`. [`Turn.tsx`](../src/ui/conversation/Turn.tsx) selects the run
for its index; [`Home.tsx`](../src/ui/conversation/Home.tsx) selects the live run
only while busy.

[`ActivityTimeline.tsx`](../src/ui/conversation/ActivityTimeline.tsx) renders
this recorded activity; it does not synthesize progress. Model calls and steps
are merged by timestamp. A collapsed process header reports one of:

- `Working · live` with a live indicator;
- `Processed · <elapsed>` with a check;
- `Failed after <elapsed>` or `Stopped after <elapsed>` with a stop icon.

The header also counts search steps. The body defaults open for a run first
rendered live and is user-toggleable. Empty live runs say “No steps recorded
yet”; empty completed runs render nothing.

Step rows use the recorded kind and message. Searches read `Searched — …`, reads
`Read — …`, and recalls `Recall — …`; other kinds use their message or kind.
Rows can additionally show `why`, up to six linked sources, and a read step's
character count. Step messages are clipped to 90 characters. Raw
`ActivityCall.output` and arbitrary tool-result payloads are not rendered here:
results appear only through the specific step fields above. Hidden/missing
activity fields remain hidden.

## Model thinking

Thinking has two distinct paths:

1. `hooks.tsx` accumulates `thinking_delta` events into `liveThinking`. Home
   uses that buffer to recognize streaming and maintain scrolling, but does not
   directly print it in the live article.
2. The visible reasoning text comes from each `ActivityCall.thinking` in the
   activity run. `ActivityTimeline` labels it **Deep reasoning**, renders it as
   Markdown, and provides an independent disclosure control. It is initially
   open when first rendered live. Positive `metrics.output_tps` is displayed as
   tokens per second.

A call without thinking instead appears as a compact model-call line with its
model name (or `Model call`), optional token rate, and done/failed status.
Consequently, live reasoning visibility depends on the activity stream, not
merely on `liveThinking` receiving deltas.

## Status and notifications

The visual core in [`src/ui/layout/Core.tsx`](../src/ui/layout/Core.tsx) is a
welcome/activity element only on an unoccupied Home page; it is hidden off Home
or once a message exists. It remains mounted so its animation state persists.
It polls legacy state every 400 ms through
[`computeCoreState()`](../src/ui/lib/core.tsx), which maps activity to the
captions **Ready**, **Thinking**, **Searching**, **Responding**, **Recalling**,
**Listening**, or **Attention needed**. A second line shows the configured model
name and effort. The ASTER motion maps phases to idle, thinking, generating, or
tool behavior, with model- and mood-dependent color and motion.

Transient notifications are coordinated by `showToast()` in `hooks.tsx` and
rendered by `ToastHost` in [`App.tsx`](../src/ui/layout/App.tsx) as a polite
status region. Ordinary toasts clear after six seconds; actionable toasts stay
until their action or dismiss button is used. Turn operation failures and copy
confirmations use this mechanism. A `background_job_done` event also creates a
toast containing the job id, exit code, and at most the final 120 characters of
its last non-empty output line.
