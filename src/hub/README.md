# Ramo Agent Hub

A standalone, zero-dependency message hub for agent-to-agent coordination.

It is **not** part of Ramo. The hub package is `src/hub/`, and it runs and
stores its own data. Ramo consumes the same module (the worker require()s
it), and so can Muse, OpenCode, or any agent that speaks the message format.

## What it is

- Inbox + outbox for agent messages.
- Routes between any set of registered peers (it does not assume the peers are
  Ramo and Muse).
- Message format is fixed and small:
  `{ from, to, kind, id, text, timestamp }`
- Kinds: `message` | `question` | `job`.
- Threads are stored as JSON lines, one file per thread, under the data root.
- A peer registers with: `name`, `address` (URL), `token`.
- The hub has one master token. A peer authenticates to the hub with **either**
  the master token **or** its own peer token (the hub knows every peer token
  from the registration step).

## Storage layout

Root: `%APPDATA%\Ramo\agent-hub\` (or `$HOME/.ramo-agent-hub/` off Windows).

    token          master token, 0600, generated on first run, never printed
    peers.json     registered peers (atomically replaced)
    threads/<id>.jsonl   message log per thread (atomically appended)
    outbox.jsonl   pending messages (queued but not delivered)
    README.md      this file

Directories are created 0700; files are created 0600. On Windows the ACL is
the same file's; privileges are per-directory of your user profile.

## Message format

    {
      "from": "Muse",
      "to":   "Ramo",
      "kind": "question",            // message | question | job
      "id":   "<32 hex>",            // optional; the hub mints one if absent
      "text": "...",
      "timestamp": 1763107200000     // epoch ms; optional, hub stamps if absent
    }

Validation rules:

- `from`, `to`: `/^[a-z0-9_-]{1,32}$/i`
- `kind`: one of `message | question | job`
- `text`: non-empty, ≤ 32768 chars
- `id`: 1-64 hex chars if supplied
- master token or a peer token required for POST /messages and /register

## Endpoints

    GET    /healthz             → { ok: true }
    POST   /register            → body { name, address, token, kinds? }
                                  creates or replaces the named peer.
                                  address must be an http:// or https:// URL.
                                  `kinds` defaults to all of them.
    GET    /peers               → list of { name, address, kinds, registeredAt }
                                  tokens are NEVER returned.
    GET    /threads/<thread>    → { thread, messages: [...] }  ( bearer auth )
    POST   /messages            → body { thread?, from, to, kind, id?, text, timestamp? }
                                  authenticated. Validates, appends to the
                                  thread file, routes to every peer whose name
                                  matches `to` (or, if `to` is `*`, to everyone).
    GET    /outbox              → the queued messages the hub could not hand off

## Requirements and starting it

    node src/hub/hub.mjs serve                   # localhost only, port 4317
    node src/hub/hub.mjs serve --host 100.100.148.33   # tailnet

Bind to the tailnet IP if Muse (or any peer) must reach the hub. Binding to
127.0.0.1 serves only this PC; the outbox still collects any undeliverable
messages, so Ramo is safe with either binding.

    RAMO_AGENT_HUB_PORT=4317                 port
    RAMO_AGENT_HUB_HOST=100.100.148.33       host
    RAMO_AGENT_HUB_DIR=<path>                override the data root
    RAMO_AGENT_NAME=<name>                   name the CLI uses for `send`


## How a peer connects (any agent, any harness)

1. Run the hub: `node src/hub/hub.mjs serve`
2. Open the data directory once to read the master token:
   `node src/hub/hub.mjs status` — it only tells you whether the token exists.
   The file `token` itself holds the value; it was minted on first serve and
   is never echoed by the server or by logs.
3. Register your peer once per network:

       POST /register
       Authorization: Bearer <master-token>
       Content-Type: application/json

       { "name": "opencode", "address": "http://127.0.0.1:4317", "token": "<peer-token>" }

4. Attach an HTTP listener on that address; incoming messages arrive as:

       POST /messages
       Authorization: Bearer <peer-token>
       { "thread": "default", "from": "Muse", "to": "opencode",
         "kind": "job", "text": "...", "id": "<64-hex>",
         "timestamp": 1763107200000 }

   Replies are sent the same way, with the hub as the relay.

## Where the OpenCode adapter goes

OpenCode speaks HTTP on this network. The adapter is a peer whose `address` is
`http://<host>:<port>/messages`-compatible with the OpenCode HTTP API. It is
**not** built yet — this job requires only that adding it is a registration,
not a code change:

    POST /register
    { "name": "opencode",
      "address": "http://<opencode-host>:<opencode-port>/messages",
      "token": "<opencode-auth-token>" }

The hub then routes any message with `to: "opencode"` to it with that token.
An "opencode ↔ Muse ↔ Ramo" thread is just `to: "*"`.

## Branches the hub does NOT take

- No uploads, no publishing, no posting elsewhere. It is a router, not a client
  for anything else.
- The push path (Ramo → Muse) is described separately; the hub does not
  navigate browsers.

## See also

- `hub.mjs` — implementation.
- `muse-push.mjs` — the Ramo → Muse browser push.
- `tests/hub.test.mjs` — the model-free regression suite.
