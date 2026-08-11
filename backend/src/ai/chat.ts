import type { Server } from "socket.io";
import { Engagement, Session, Approval } from "../db/mongo.js";
import { checkScope } from "../engagement/scope.js";
import { makeProvider, type ChatMessage } from "./providers.js";
import { getActiveAiConfig } from "./settings.js";
import { getTool, toolSchemas } from "./tools.js";
import { isEnterprise } from "../edition/service.js";
import { awaitApproval } from "../approvals/registry.js";
import { getWorkerRef } from "../workers/registry.js";
import { record, setStatus, saveMessages } from "./orchestrator.js";
import { log } from "../lib/log.js";

/**
 * CHAT mode — the operator drives the assessment one instruction at a time and
 * confirms every check/attack before it runs. For each operator message the agent
 * replies in plain language with WHAT tool/command it will use and WHICH target,
 * then proposes a single tool call. Active/intrusive tools wait for the operator to
 * confirm (the approval gate); the tool's output is written to the transcript as the
 * log of that check/attack. This is a single propose→confirm→execute→log turn — it
 * does NOT loop autonomously (that is orchestrator.runSession).
 */
const CHAT_SYSTEM = `You are Aegis, a penetration-testing assistant operating under a signed, AUTHORIZED
engagement, in interactive CHAT mode. The operator gives you ONE instruction at a time.

For each instruction:
1. First reply in 1-3 short sentences, in the operator's language, stating plainly:
   - WHAT you will do (the check or attack),
   - WHICH tool/command you will run,
   - and the exact TARGET (host or URL, from the in-scope list).
2. Then call EXACTLY ONE tool to carry it out. Never call more than one tool.

Every active or intrusive tool WAITS for the operator to CONFIRM before it runs, so
propose the single best next action and explain it clearly. Only act toward the
objective and only against in-scope targets. If the message is a question or needs no
tool, just answer it in plain language without calling a tool. Do not produce
target-specific exploit code, evasion/anti-forensics tooling, DoS, or mass scanning.`;

export async function runChatTurn(sessionId: string, io: Server, text: string): Promise<void> {
  const session = await Session.findById(sessionId).lean();
  if (!session) throw new Error("session not found");
  const engagement = await Engagement.findById(session.engagement).lean();
  if (!engagement) throw new Error("engagement not found");

  const aiConfig = await getActiveAiConfig();
  if (!aiConfig.apiKey && aiConfig.provider !== "openai-compatible") {
    await record(sessionId, { role: "event", content: "No AI API key configured. Set it in Settings → AI Provider." }, io);
    await setStatus(sessionId, "idle", io);
    return;
  }
  const provider = makeProvider(aiConfig);
  const worker = await getWorkerRef(engagement.worker);
  const scopeState = {
    authorization: { granted: engagement.authorization?.granted ?? false },
    scope: { include: engagement.scope?.include ?? [], exclude: engagement.scope?.exclude ?? [] },
  };

  // Persisted conversation (shared with the transcript). Seed it on first use.
  const seed: ChatMessage = {
    role: "user",
    content: `Engagement: ${engagement.name} (client: ${engagement.client || "n/a"})
Scope include: ${scopeState.scope.include.join(", ") || "(none)"}
Scope exclude: ${scopeState.scope.exclude.join(", ") || "(none)"}
Objective: ${session.objective || "(none given)"}`,
  };
  const messages: ChatMessage[] = (session.messages as ChatMessage[] | undefined)?.length
    ? (session.messages as ChatMessage[])
    : [seed];
  messages.push({ role: "user", content: `OPERATOR: ${text}` });

  await setStatus(sessionId, "running", io);

  try {
    // One propose turn. Force the chat-mode system prompt regardless of any stored one.
    const input: ChatMessage[] = [
      { role: "system", content: CHAT_SYSTEM },
      ...messages.filter((m) => m.role !== "system"),
    ];
    const enterprise = await isEnterprise();
    const result = await provider.chat(input, toolSchemas(undefined, { enterprise }));

    if (result.text.trim()) {
      await record(sessionId, { role: "assistant", content: result.text }, io);
      messages.push({ role: "assistant", content: result.text });
    }

    const call = result.toolCalls[0];
    if (!call) {
      // Pure conversational answer — nothing to run.
      await saveMessages(sessionId, messages);
      await setStatus(sessionId, "idle", io);
      return;
    }
    const tool = getTool(call.name);
    if (!tool) {
      await record(sessionId, { role: "tool", tool: call.name, content: `Unknown tool: ${call.name}` }, io);
      messages.push({ role: "user", content: `Tool result (${call.name}): unknown tool` });
      await saveMessages(sessionId, messages);
      await setStatus(sessionId, "idle", io);
      return;
    }
    // Edition gate: exploitation (L4/L5) tools require an Enterprise license.
    if (tool.edition === "enterprise" && !enterprise) {
      const msg = `${call.name} requires an Enterprise license (Exploitation tools).`;
      await record(sessionId, { role: "event", tool: call.name, content: msg }, io);
      messages.push({ role: "user", content: `Tool result (${call.name}): ${msg}` });
      await saveMessages(sessionId, messages);
      await setStatus(sessionId, "idle", io);
      return;
    }

    // Scope gate for targeted active/intrusive tools.
    if (tool.risk !== "passive" && tool.targetArg) {
      const target = String(call.arguments[tool.targetArg] ?? "");
      const decision = checkScope(scopeState, target);
      if (!decision.allowed) {
        const msg = `BLOCKED by scope gate: ${decision.reason}`;
        await record(sessionId, { role: "event", tool: call.name, content: msg }, io);
        messages.push({ role: "user", content: `Tool result (${call.name}): ${msg}` });
        await saveMessages(sessionId, messages);
        await setStatus(sessionId, "idle", io);
        return;
      }
    }

    // Confirmation gate for every check/attack (active + intrusive). Passive info
    // tools (dns, save_finding, report…) run immediately.
    if (tool.risk !== "passive") {
      const approval = await Approval.create({
        session: sessionId,
        tool: call.name,
        args: call.arguments,
        rationale: result.text.slice(0, 500),
      });
      const approvalId = String(approval._id);
      await setStatus(sessionId, "waiting_approval", io);
      await record(
        sessionId,
        { role: "event", tool: call.name, content: "Awaiting operator confirmation", meta: { approvalId, args: call.arguments } },
        io
      );
      io.to(`session:${sessionId}`).emit("approval", {
        approvalId,
        tool: call.name,
        args: call.arguments,
        rationale: result.text.slice(0, 500),
      });

      const approved = await awaitApproval(approvalId);
      if (!approved) {
        await record(sessionId, { role: "event", tool: call.name, content: "Operator cancelled this action." }, io);
        messages.push({ role: "user", content: `Tool result (${call.name}): operator cancelled — not run.` });
        await saveMessages(sessionId, messages);
        await setStatus(sessionId, "idle", io);
        return;
      }
    }

    // Execute — the tool output is the log of this check/attack.
    await setStatus(sessionId, "running", io);
    let output: string;
    try {
      output = await tool.run(call.arguments, {
        engagementId: String(engagement._id),
        engagementSlug: engagement.slug,
        sessionId,
        worker,
      });
    } catch (e) {
      output = `error: ${(e as Error).message}`;
    }
    await record(sessionId, { role: "tool", tool: call.name, content: output, meta: { args: call.arguments } }, io);
    messages.push({ role: "user", content: `Tool result (${call.name}): ${output}` });
    await saveMessages(sessionId, messages);
    await setStatus(sessionId, "idle", io);
  } catch (e) {
    log.error("chat turn error", e);
    await record(sessionId, { role: "event", content: `Error: ${(e as Error).message}` }, io);
    await setStatus(sessionId, "idle", io);
  }
}
