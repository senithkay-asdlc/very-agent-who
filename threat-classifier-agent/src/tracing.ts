// tracing.ts — imported for side effects from the top of main.ts, before
// anything creates a model client. Also exports traceTurn, which main.ts
// wraps every /chat turn in.
//
// Copied per agent-building's building.md, "src/tracing.ts — copy it
// whole": written unconditionally, and inert when the platform sets no
// AMP_OTEL_ENDPOINT.
import { context, trace, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import type {
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  LanguageModelUsage,
  ModelMessage,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "ai";

const endpoint = process.env.AMP_OTEL_ENDPOINT;
const apiKey = process.env.AMP_AGENT_API_KEY;
const agentName = process.env.OTEL_SERVICE_NAME ?? "agent";

// Prompts, completions, tool arguments and results go on spans unless the
// platform sets this to "false". ON when unset, as Agent Manager's own
// instrumentation defaults.
const recordContent = process.env.TRACELOOP_TRACE_CONTENT !== "false";

const tracer = trace.getTracer("agent");

if (endpoint && apiKey) {
  const provider = new NodeTracerProvider({
    // SET THIS OR THE TRACES ARE ANONYMOUS. A provider built without a
    // resource reports `service.name: unknown_service:node`, and every agent
    // in the org looks identical in the trace view — spans all correct, view
    // useless. The platform supplies the name in OTEL_SERVICE_NAME; a bare
    // NodeTracerProvider does not run resource detection, so read it.
    resource: new Resource({ "service.name": agentName }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          // The exporter appends nothing — AMP_OTEL_ENDPOINT is a base.
          url: `${endpoint}/v1/traces`,
          headers: { "x-amp-api-key": apiKey },
        }),
      ),
    ],
  });
  provider.register();
  // Without this the last spans of a turn die with the pod.
  process.on("SIGTERM", () => {
    void provider.shutdown().finally(() => process.exit(0));
  });
}

// The streamText callbacks that open and close the per-step spans. Declared
// as METHODS, not function-typed properties: streamText types its callbacks by
// the agent's own tool set, and only a method's parameter is checked loosely
// enough to accept that narrower event. As properties, every agent with typed
// tools fails to compile.
export interface TurnHooks {
  onLanguageModelCallStart(e: LanguageModelCallStartEvent): void;
  onLanguageModelCallEnd(e: LanguageModelCallEndEvent): void;
  onToolExecutionStart(e: ToolExecutionStartEvent): void;
  onToolExecutionEnd(e: ToolExecutionEndEvent): void;
}

export interface TurnTrace {
  conversationId: string;
  model: string; // MODEL_NAME
  system: string; // "anthropic" | "openai" — see "Tracing"
  message: string; // this turn's user message
}

// One agent turn: an `invoke_agent` span, with a `chat` child per model call
// and an `execute_tool` child per tool call. Agent Manager classifies each
// span by gen_ai.operation.name; a span without one shows as "unknown".
export async function traceTurn<T extends { text: string; usage: LanguageModelUsage }>(
  turn: TurnTrace,
  run: (hooks: TurnHooks) => Promise<T>,
): Promise<T> {
  const agent = tracer.startSpan(`invoke_agent ${agentName}`, {
    attributes: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": agentName,
      "gen_ai.conversation.id": turn.conversationId,
      "gen_ai.system": turn.system,
      "gen_ai.request.model": turn.model,
    },
  });
  const parent = trace.setSpan(context.active(), agent);
  if (recordContent) {
    agent.setAttribute("gen_ai.input.messages", toMessages([{ role: "user", content: turn.message }]));
  }

  // Model calls in a turn run one after another, so one open span is enough;
  // tool calls in a step may run in parallel, so they are keyed by call id.
  let chat: Span | undefined;
  const toolSpans = new Map<string, Span>();

  const hooks: TurnHooks = {
    onLanguageModelCallStart: (e) => {
      // A call that is retried starts again without having ended.
      if (chat) {
        chat.setStatus({ code: SpanStatusCode.ERROR, message: "model call retried" });
        chat.end();
      }
      chat = tracer.startSpan(
        `chat ${e.modelId}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.system": turn.system,
            "gen_ai.request.model": e.modelId,
          },
        },
        parent,
      );
      if (recordContent) {
        chat.setAttribute("gen_ai.input.messages", toMessages(e.messages));
        if (e.instructions !== undefined) {
          chat.setAttribute(
            "gen_ai.system_instructions",
            typeof e.instructions === "string" ? e.instructions : JSON.stringify(e.instructions),
          );
        }
      }
    },
    onLanguageModelCallEnd: (e) => {
      if (!chat) return;
      chat.setAttributes({
        "gen_ai.response.model": e.modelId,
        "gen_ai.response.finish_reasons": [e.finishReason],
        "gen_ai.usage.input_tokens": e.usage.inputTokens ?? 0,
        "gen_ai.usage.output_tokens": e.usage.outputTokens ?? 0,
      });
      if (recordContent) {
        chat.setAttribute(
          "gen_ai.output.messages",
          JSON.stringify([{ role: "assistant", parts: e.content.flatMap(toPart) }]),
        );
      }
      chat.setStatus({ code: SpanStatusCode.OK });
      chat.end();
      chat = undefined;
    },
    onToolExecutionStart: (e) => {
      const span = tracer.startSpan(
        `execute_tool ${e.toolCall.toolName}`,
        {
          attributes: {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": e.toolCall.toolName,
            "gen_ai.tool.call.id": e.toolCall.toolCallId,
          },
        },
        parent,
      );
      if (recordContent) {
        span.setAttribute("gen_ai.tool.call.arguments", JSON.stringify(e.toolCall.input ?? {}));
      }
      toolSpans.set(e.toolCall.toolCallId, span);
    },
    onToolExecutionEnd: (e) => {
      const span = toolSpans.get(e.toolCall.toolCallId);
      if (!span) return;
      toolSpans.delete(e.toolCall.toolCallId);
      if (e.toolOutput.type === "tool-error") {
        span.setAttribute("error.type", "tool_error");
        // An error message can carry the provider's response body: content.
        span.setStatus({
          code: SpanStatusCode.ERROR,
          ...(recordContent ? { message: String(e.toolOutput.error) } : {}),
        });
      } else {
        if (recordContent) {
          span.setAttribute("gen_ai.tool.call.result", JSON.stringify(e.toolOutput.output ?? null));
        }
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    },
  };

  try {
    const result = await run(hooks);
    agent.setAttributes({
      "gen_ai.usage.input_tokens": result.usage.inputTokens ?? 0,
      "gen_ai.usage.output_tokens": result.usage.outputTokens ?? 0,
    });
    if (recordContent) {
      agent.setAttribute("gen_ai.output.messages", toMessages([{ role: "assistant", content: result.text }]));
    }
    agent.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    // The class name is metadata; the message and stack are content.
    agent.setAttribute("error.type", (err as Error)?.name ?? "Error");
    if (recordContent) {
      agent.recordException(err as Error);
      agent.setStatus({ code: SpanStatusCode.ERROR, message: String((err as Error)?.message ?? err) });
    } else {
      agent.setStatus({ code: SpanStatusCode.ERROR });
    }
    throw err;
  } finally {
    // A failed model call never reaches its end callback: close what is open
    // so no span is lost. A span never ended is a span never exported.
    for (const span of [chat, ...toolSpans.values()]) {
      if (!span) continue;
      span.setStatus({ code: SpanStatusCode.ERROR, message: "turn ended before this step completed" });
      span.end();
    }
    agent.end();
  }
}

// OpenTelemetry GenAI message shape, as a JSON string — Agent Manager reads
// these attributes as strings and drops anything else.
type Part =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: unknown }
  | { type: "tool_call_response"; id: string; response: unknown };

function toMessages(messages: ReadonlyArray<ModelMessage>): string {
  return JSON.stringify(
    messages.map((m) => ({
      role: m.role,
      parts: typeof m.content === "string"
        ? [{ type: "text", content: m.content }]
        : m.content.flatMap(toPart),
    })),
  );
}

// One message part. Reasoning, files and sources are not message content.
function toPart(part: { type: string }): Part[] {
  const p = part as { type: string } & Record<string, unknown>;
  switch (p.type) {
    case "text":
      return [{ type: "text", content: String(p.text) }];
    case "tool-call":
      return [{ type: "tool_call", id: String(p.toolCallId), name: String(p.toolName), arguments: p.input }];
    case "tool-result":
      // The SDK wraps a result as { type: "json" | "text", value }; the value
      // is the result.
      return [{ type: "tool_call_response", id: String(p.toolCallId), response: (p.output as { value?: unknown })?.value ?? p.output }];
    default:
      return [];
  }
}
