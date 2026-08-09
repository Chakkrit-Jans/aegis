import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODELS } from "../config.js";
import type { AiConfig } from "./settings.js";

/**
 * Provider-pluggable chat with tool-calling, normalized to a common shape so the
 * orchestrator doesn't care which backend is active.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  // assistant tool-call requests (normalized)
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
}

export interface Provider {
  name: string;
  model: string;
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult>;
}

function openAICompatible(baseURL: string, apiKey: string, model: string): Provider {
  const client = new OpenAI({ baseURL, apiKey: apiKey || "x" });
  return {
    name: `openai:${baseURL}`,
    model,
    async chat(messages, tools) {
      const res = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant" | "tool",
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls
            ? {
                tool_calls: m.tool_calls.map((t) => ({
                  id: t.id,
                  type: "function" as const,
                  function: { name: t.name, arguments: JSON.stringify(t.arguments) },
                })),
              }
            : {}),
        })) as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      });
      const msg = res.choices[0]?.message;
      return {
        text: msg?.content ?? "",
        toolCalls: (msg?.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          arguments: safeParse(c.function.arguments),
        })),
      };
    },
  };
}

function anthropicProvider(apiKey: string, model: string): Provider {
  const client = new Anthropic({ apiKey });
  return {
    name: "anthropic",
    model,
    async chat(messages, tools) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const res = await client.messages.create({
        model,
        max_tokens: 4096,
        system: system || undefined,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })) as Anthropic.MessageParam[],
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      });
      const toolCalls: ToolCall[] = [];
      let text = "";
      for (const block of res.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use")
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: (block.input as Record<string, unknown>) ?? {},
          });
      }
      return { text, toolCalls };
    },
  };
}

/** Fetch the list of model ids the configured key can access, from the provider. */
export async function listModels(ai: AiConfig): Promise<string[]> {
  if (ai.provider === "anthropic") {
    // Anthropic has no models.list in this SDK version — call the REST endpoint.
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`.slice(0, 200));
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id).sort();
  }
  const baseURL = ai.provider === "deepseek" ? "https://api.deepseek.com" : ai.baseUrl;
  const client = new OpenAI({ baseURL, apiKey: ai.apiKey || "x", timeout: 20_000, maxRetries: 1 });
  const res = await client.models.list();
  return res.data.map((m) => m.id).sort();
}

export function makeProvider(ai: AiConfig): Provider {
  const model = ai.model || DEFAULT_MODELS[ai.provider];
  switch (ai.provider) {
    case "deepseek":
      return openAICompatible("https://api.deepseek.com", ai.apiKey, model);
    case "anthropic":
      return anthropicProvider(ai.apiKey, model);
    case "openai-compatible":
      return openAICompatible(ai.baseUrl, ai.apiKey, model);
    default:
      throw new Error(`Unknown AI provider: ${ai.provider}`);
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
