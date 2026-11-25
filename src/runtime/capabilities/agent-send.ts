/**
 * The Agent Hub bridge — `agent_send` capability.
 *
 * One outbound channel for this conversation with other agents and harnesses.
 * Sends a message to another peer registered in the local Agent Hub. When
 * there is nothing meaningful to send, the capability is simply not called —
 * the model decides, the tool does not manufacture chatter.
 *
 * The message is always tagged `[Ramo] ...` when the local assistant is the
 * sender. Any failure to reach the hub lands the message in the hub's outbox
 * instead of an error the model can't act on.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Capability, CapabilityResult, JsonObject } from "../kernel/types.js";

const envDir = process.env.RAMO_AGENT_HUB_DIR
  || (process.env.APPDATA ? path.join(process.env.APPDATA, "Ramo", "agent-hub") : path.join(os.homedir(), ".ramo-agent-hub"));
const HUB_URL = process.env.RAMO_AGENT_HUB_URL || "http://127.0.0.1:4317";
const TOKEN_FILE = path.join(envDir, "token");
const OUTBOX_FILE = path.join(envDir, "outbox.jsonl");

function readToken(): string | null {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch { return null; }
}

function queue(to: string, kind: string, text: string, reason: string): CapabilityResult {
  try {
    fs.mkdirSync(envDir, { recursive: true, mode: 0o700 });
    const entry = { from: "ramo", to, kind, text, id: Date.now().toString(16), reason, timestamp: Date.now() };
    fs.appendFileSync(OUTBOX_FILE, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return {
      content: [{ type: "text", text: `queued (reason: ${reason})` }],
      details: { queued: true, reason } as unknown as JsonObject,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `could not reach the Agent Hub and could not queue the message: ${error instanceof Error ? error.message : String(error)}` }],
      details: { queued: false } as unknown as JsonObject,
    };
  }
}

export function createAgentSendCapability(): Capability {
  return {
    name: "agent_send",
    label: "Send to Agent Hub",
    description: "Send a message, question or job to another agent or harness connected to the local Agent Hub. Use it when there is something real to say to Muse or another participant on this thread — a reply, a question, a task. Do not send greetings, status pings, or anything there is nothing to say about. The message is tagged [Ramo] automatically.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Peer name to send to (e.g. muse)" },
        kind: { type: "string", enum: ["message", "question", "job"], description: "What kind of message this is" },
        text: { type: "string", description: "What to say" },
      },
      required: ["to", "kind", "text"],
      additionalProperties: false,
    },
    readOnly: false,
    async execute(_id, args, _signal) {
      const to = String((args as JsonObject).to ?? "").trim().toLowerCase();
      const kind = String((args as JsonObject).kind ?? "message").trim().toLowerCase();
      const rawText = String((args as JsonObject).text ?? "").trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(to)) {
        return { content: [{ type: "text", text: "`to` must match ^[a-z0-9_-]{1,32}$" }], details: { ok: false } as unknown as JsonObject };
      }
      if (!["message", "question", "job"].includes(kind)) {
        return { content: [{ type: "text", text: "`kind` must be message, question or job" }], details: { ok: false } as unknown as JsonObject };
      }
      if (!rawText) {
        return { content: [{ type: "text", text: "`text` must not be empty" }], details: { ok: false } as unknown as JsonObject };
      }
      const text = rawText.startsWith("[Ramo] ") ? rawText : `[Ramo] ${rawText}`;
      const token = readToken();
      if (!token) return queue(to, kind, text, "no hub token yet — the hub is not running this launch");
      try {
        const body = JSON.stringify({ from: "ramo", to, kind, text, timestamp: Date.now() });
        const response = await fetch(`${HUB_URL}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
          body,
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) return queue(to, kind, text, `hub answered HTTP ${response.status}`);
        const data = (await response.json().catch(() => ({}))) as { delivered?: number; queued?: number };
        return {
          content: [{ type: "text", text: `delivered to ${data.delivered ?? 0} peer(s), queued ${data.queued ?? 0}` }],
          details: { delivered: data.delivered ?? 0, queued: data.queued ?? 0 } as unknown as JsonObject,
        };
      } catch (error) {
        return queue(to, kind, text, error instanceof Error ? error.message : String(error));
      }
    },
  };
}
