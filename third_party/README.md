# Vendored third-party source

`pi/` is the upstream **Pi** coding-agent source, vendored so that this project's
dependencies are visible to git, readable in place, and patchable by this project.

## Provenance

| | |
|---|---|
| Upstream | https://github.com/earendil-works/pi (monorepo, `packages/coding-agent`) |
| Package | `@earendil-works/pi-coding-agent` |
| Version | 1.4.0 |
| Author | Mario Zechner / Earendil Works |
| Licence | MIT — see `pi/LICENSE`, kept intact as attribution is required |
| Source snapshot | Upstream release source for version 1.4.0 |

The vendored tree is a copy of the upstream source at that version. It is not modified.

## What was copied

Source, tests, docs, schemas, examples and the repository build scripts — 2,044 files,
about 25 MB. Pi's own test suites are included deliberately: they are the regression net
for the kernel migration described below.

## What was excluded, and why

| Excluded | Reason |
|---|---|
| `node_modules/` | Installed dependencies, not source. Reinstalled by `npm install`. |
| `dist/` | Build output. `vendor/runtime` holds the built `coding-agent` package that the app actually loads. |
| `.git/` | `pi-main` is an extracted snapshot, not a checkout. |

## What this project uses from Pi

**Nothing at runtime.** Pi was adopted as a working agent harness and has been
integrated into this project as its own kernel. The runtime does not import Pi,
Hermes or any other agent framework.

The vendored tree is kept as a **read-only upstream record**: it is the
reference for diffing, for porting fixes and for auditing where each piece of
`src/runtime/kernel/` and `src/runtime/capabilities/` came from. The
provenance of every derived file, and the list of what changed, is recorded in
`src/runtime/kernel/README.md`.

Pi's own test suites remain vendored as the historical regression net for the
migration. They are not part of `npm test`, which runs this project's suite.

## Why it is vendored

Pi was substrate, and it stayed substrate rather than becoming the product. The
project owns its own agent harness: the turn loop, prompt assembly, context
policy, compaction, session format and tool dispatch live in
`src/runtime/kernel/`. Vendoring the source makes that migration auditable
without fighting an opaque compiled bundle, and keeps the exact upstream state
visible.

## Updating from upstream

Copy deliberately; never overwrite silently. The vendored tree is a read-only
record now: it is not rebuilt, and `vendor/runtime` is not deployed. When a
newer Pi version is worth auditing:

1. Copy the new source over `pi/`, preserving `pi/LICENSE`.
2. Diff the new upstream against the vendored tree to see what changed.
3. Decide deliberately which upstream fixes matter for `src/runtime/kernel/`,
   port those by hand, and record the port in `src/runtime/kernel/README.md`.
4. Record what changed and why in the commit message.

## Resolved item

`packages/agent/src/agent-loop.ts` carries Pi's client attribution
(`PI_ATTRIBUTION`) in its default identity. The kernel in `src/runtime/kernel/`
identifies the assistant as Ramo; the attribution was deliberately not
carried over, because the loop is this project's. The upstream licence and
authorship are recorded here and in the shipped notices instead.
