# The Ramo kernel

This directory is the agent kernel of Ramo Unified. It owns the whole
conversation: the turn loop, the prompt assembly, the context policy and
compaction, the session format and tree, the tool dispatch, the capability
registry and the permission checks.

Nothing here is imported by another agent framework, and no framework is
imported from here. The runtime reaches the local model through Ramo's own
transport (`src/runtime/model/client.ts`) and the local tools through
Ramo's own capabilities (`src/runtime/capabilities/`).

## Provenance

The kernel was derived from the working agent loop of **Pi 1.4.0**
(`third_party/pi`, MIT licensed, Copyright (c) 2025 Mario Zechner). Pi is kept
as a read-only upstream record: it is the reference for diffing, for porting
fixes and for auditing where each piece came from. It is not a dependency and
it is not shipped.

| File | Derived from | What changed |
|---|---|---|
| `types.ts` | `packages/agent/src/types.ts`, `packages/ai/src/types.ts` | Ramo's own contracts and vocabulary: a *turn*, a *capability*, a *transcript*. |
| `stream.ts` | `packages/ai/src/utils/event-stream.ts` | Renamed to Ramo's vocabulary; one generic stream with an explicit final-result extractor instead of a response-specific subclass. |
| `schema.ts` | `packages/ai/src/utils/transcript.ts`, `packages/ai/src/utils/validation.ts` | The typebox dependency is gone. Validation is implemented in-project against plain JSON Schema, because no validation library may be added. |
| `wire.ts` | `packages/ai/src/api/transform-messages.ts`, `openai-completions.ts` | The transcript-to-wire translation without the provider-specific branches; only the local OpenAI-compatible gateway is supported. |
| `loop.ts` | `packages/agent/src/agent-loop.ts` | The provider call is injected as a `respond` function instead of reaching into a model registry. The behaviour is preserved: a turn is one assistant response plus its capability calls and results; capability batches run in parallel unless a capability forces sequential execution; a response cut off by the output token limit fails its capability calls instead of running them with truncated arguments; steering and follow-up messages are drained at the same points. |
| `host.ts` | `packages/coding-agent/src/core/agent-session.ts` | No settings manager, no package manager, no extension system. The capability set, the permission mode, the context and the skills are passed in directly. The session is Ramo's own store; the model call is Ramo's own transport. |
| `skills.ts` | `packages/coding-agent/src/core/skills.ts` | Discovery, validation, first-wins collisions and the Agent Skills prompt format are preserved. The `ignore` package is not shipped, so dot-directories and `node_modules` are skipped instead of honouring `.gitignore`. |
| `prompts.ts` | `packages/coding-agent/src/core/prompt-templates.ts` | Discovery and the full `$1`/`$@`/`${N:-default}`/slice substitution are preserved, including bash-style quoting. A name collision keeps the first template and is reported. |
| `frontmatter.ts` | `packages/coding-agent/src/utils/frontmatter.ts` | The `yaml` package is not shipped; a scalar reader handles the keys these files use, including `|` and `>` blocks. |
| `resources.ts` | `packages/coding-agent/src/core/diagnostics.ts` | Only the diagnostic fields Ramo uses are kept. |
| `context.ts` | `packages/coding-agent/src/core/compaction/compaction.ts` | The trigger, the token estimates, the cut point and the summary format are preserved, because the summary format is what the model reads to continue the work. The compaction record and the context reconstruction live in Ramo's own session store. |
| `session.ts` | `packages/coding-agent/src/core/session-manager.ts` | Ramo's own JSON Lines tree with a navigable leaf. The entry vocabulary is the same, so a session written by either implementation stays readable. |

The capabilities in `src/runtime/capabilities/` follow Pi's tool behaviour —
the same argument shapes, the same truncation limits (2000 lines or 50 KB),
the same output formats, the same error strings and the same requirement that
an edit's `oldText` match a unique region — but the implementations are
Ramo's own:

| Capability | Derived from | What changed |
|---|---|---|
| `files.ts` | `packages/coding-agent/src/core/tools/{read,write,edit,ls}.ts` | Own path resolution, own LCS line diff instead of a diff package, own file mutation queue. |
| `search.ts` | `packages/coding-agent/src/core/tools/{find,grep}.ts` | Ramo owns the binary lookup: the bundled `fd.exe` and `rg.exe` are used, and nothing is downloaded at runtime. |
| `shell.ts` | `packages/coding-agent/src/core/tools/shell.ts` | Own environment helper and own process-tree termination. PowerShell stays a headless agent capability; there is no terminal view. |
| `truncate.ts` | `packages/coding-agent/src/core/tools/truncate.ts` | Renamed to Ramo's vocabulary. |
| `codemode.ts` | `packages/coding-agent/src/core/extensions/codemode.ts` | The nested calls run through the kernel host, so they pass the same permission check and the same result hook as a call the model made directly. |
| `mcp.ts` | `packages/coding-agent/src/core/extensions/mcp.ts` | Own JSON-RPC client over stdio, own configuration discovery, own process-tree teardown and an 8 s connect timeout. |

## What Pi no longer contributes

Pi was a working agent harness, and it was adopted as the base. It is now a
historical record only. The following went with it:

- the settings manager, the package manager and the extension system;
- the interactive terminal view and its runtime;
- the Pi session manager, replaced by `session.ts`;
- the Pi model registry and its provider layer, replaced by
  `src/runtime/model/client.ts`;
- the Pi TUI, which never shipped in Ramo.

Pi's resource loader is also gone, but the two resources that are not code —
skills and prompt templates — are read by `skills.ts` and `prompts.ts` with
Pi's semantics. The extension system stays out because it executes arbitrary
project code against a Pi-specific API.

`tools/verify.cjs` checks that no Pi runtime bundle is deployed and that the
worker has no Pi runtime dependency.

## Identity

The kernel's own prompt identifies the assistant as Ramo. Pi's client
attribution (`PI_ATTRIBUTION`) was deliberately not carried over: the loop is
this project's, and the upstream licence and attribution are recorded in
`third_party/README.md` and in the shipped notices instead.

## Wire compatibility

The worker-to-parent protocol in `src/runtime/service.cjs` is a fixed
boundary: the method names, the event names and the payload shapes are
unchanged, because the interface and the native host depend on them. The
kernel's internal event vocabulary is Ramo's own and is mapped onto that
protocol in `src/runtime/worker.ts`.
