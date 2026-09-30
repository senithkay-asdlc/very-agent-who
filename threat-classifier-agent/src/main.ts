// main.ts — the HTTP surface. Two routes on node:http, and no more.
//
// This agent is ANONYMOUS by explicit product decision (design.json): every
// caller is treated as unauthenticated rather than 401'd. There is no
// gateway-injected x-user-id to gate on and no per-caller scoping anywhere
// in this file — that is a deliberate deviation from agent-building's usual
// identity gate, not an omission.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import "./tracing.js"; // side effects: sets up the exporter before any model client exists
import type { ModelMessage } from "ai";
import { config, missingRequiredEnv } from "./config.js";
import { ensureStore, initStore, isStoreReady, loadConversation, saveConversation } from "./store.js";
import { recordClassification, type Label } from "./classifications.js";
import { runTurn } from "./agent.js";
import { traceTurn } from "./tracing.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const LABELS: ReadonlySet<string> = new Set<string>(["threatening", "not threatening"]);

// Parse/validate the model's reply into exactly one of the two labels
// before it is persisted or returned — never the model's raw text. A reply
// that does not normalize to one of the two labels falls back to
// "not threatening", the same safe default the prompt itself uses for
// ambiguous input.
function parseLabel(raw: string): Label {
  const normalized = raw.trim().toLowerCase().replace(/[.!\s]+$/, "");
  return LABELS.has(normalized) ? (normalized as Label) : "not threatening";
}

const genAiSystem = config.modelApiFormat === "openai-compatible" ? "openai" : "anthropic";

// Reads the AI SDK's APICallError body; returns null for anything else.
function guardrailBlock(err: unknown): { name: string; reason: string } | null {
  const body = (err as { responseBody?: string })?.responseBody;
  if (!body) return null;
  try {
    const m = JSON.parse(body)?.message;
    if (m?.action !== "GUARDRAIL_INTERVENED") return null;
    return { name: m.interveningGuardrail ?? "guardrail", reason: m.actionReason ?? "refused by policy" };
  } catch {
    return null;
  }
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: { conversationId?: unknown; message?: unknown };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "expected a JSON body" });
    return;
  }

  if (typeof body.message !== "string" || body.message.trim() === "") {
    sendJson(res, 400, { error: "expected { message: string }" });
    return;
  }
  const message = body.message;

  if (body.conversationId !== undefined && typeof body.conversationId !== "string") {
    sendJson(res, 400, { error: "conversationId must be a string" });
    return;
  }

  try {
    await ensureStore();
  } catch (err) {
    console.error("store not ready:", err);
    sendJson(res, 500, { error: "internal error" });
    return;
  }

  let id: string;
  let history: ModelMessage[];
  if (typeof body.conversationId === "string") {
    // Present but does not resolve → 404, never a new conversation.
    const existing = await loadConversation(body.conversationId);
    if (existing === null) {
      sendJson(res, 404, { error: "conversation not found" });
      return;
    }
    id = body.conversationId;
    history = existing;
  } else {
    id = randomUUID();
    history = [];
  }

  const full: ModelMessage[] = [...history, { role: "user", content: message }];

  try {
    const turn = await traceTurn(
      { conversationId: id, model: config.modelName ?? "", system: genAiSystem, message },
      (hooks) => runTurn(full, hooks),
    );

    const label = parseLabel(turn.text);

    // Business persistence: every submission is durably recorded in
    // classification-db before the turn is considered successful. No
    // fallback — if this fails, the turn fails (caught below), because a
    // classification that was not recorded did not happen per the domain
    // model's contract.
    await recordClassification(message, label);

    // Server-held conversation memory: append the FULL trail, tool calls
    // and results included, never just the reply.
    await saveConversation(id, [...full, ...turn.steps.flatMap((s) => s.response.messages)]);

    sendJson(res, 200, { conversationId: id, text: label, toolCalls: turn.toolCalls });
  } catch (err) {
    const g = guardrailBlock(err);
    if (g) {
      sendJson(res, 422, { error: g.reason, guardrail: g.name });
      return;
    }
    console.error("chat turn failed:", err);
    sendJson(res, 500, { error: "internal error" });
  }
}

function handleHealthz(_req: IncomingMessage, res: ServerResponse): void {
  const missing = missingRequiredEnv();
  const store = isStoreReady() ? "ready" : "initialising";
  if (missing.length > 0 || store !== "ready") {
    sendJson(res, 503, { ok: false, missing, store });
    return;
  }
  sendJson(res, 200, { ok: true });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "POST" && req.url === "/chat") {
    await handleChat(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") {
    handleHealthz(req, res);
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

const server = createServer();
server.on("request", (req, res) => {
  void handle(req, res).catch((err) => {         // the last line of defence:
    console.error("request failed:", err);        // `void handle(...)` alone
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    else res.destroy();                            // already streaming: cut it
  });
});

// Fire-and-forget: never await this before listen(). classification-db may
// not be reachable yet at boot; ensureStore() keeps retrying on every
// request until it succeeds, and /healthz reports the interim state.
initStore();

server.listen(config.port);
