# Security policy

Report suspected vulnerabilities through the repository's private GitHub vulnerability-reporting flow. Do not open a public issue containing credentials, personal chats, document contents or exploit details.

Ramo can read/write files and run commands with the user's Windows permissions. Trust only projects you intend to modify, keep tool access at **Ask before changes**, and review approval cards. Treat retrieved pages and model output as untrusted data.

Never attach real API keys to an issue. Rotate a key immediately if it appeared in a log, screenshot, chat, bundle or commit.

## Desktop boundary review for 3.0.0

The reviewed windows use sandboxing, context isolation and disabled Node integration; renderer preload exposes typed IPC methods rather than Node primitives. Privileged project IPC checks the sender, file URLs are restricted to app resources, the content security policy disables remote scripts, and external links use the existing safe-URL policy. The worker gateway binds only to `127.0.0.1`, requires a per-service bearer token, and rejects browser `Origin` headers and non-loopback `Host` values. The Ollama setup button opens only the official Ollama download URL. This is a scoped source review, not an independent penetration test.
