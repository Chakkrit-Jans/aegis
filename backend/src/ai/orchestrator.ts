import type { Server } from "socket.io";
import { Engagement, Session, Approval } from "../db/mongo.js";
import { checkScope } from "../engagement/scope.js";
import { makeProvider, type ChatMessage } from "./providers.js";
import { getActiveAiConfig } from "./settings.js";
import { TOOLS, toolSchemas } from "./tools.js";
import { awaitApproval } from "../approvals/registry.js";
import { isStopRequested, clearStop } from "../sessions/control.js";
import { notifyApproval } from "../telegram/gateway.js";
import { getWorkerRef } from "../workers/registry.js";
import { log } from "../lib/log.js";

export { decideApproval } from "../approvals/registry.js";

const SYSTEM_PROMPT = `You are Aegis, an autonomous penetration-testing orchestrator operating under a
signed, AUTHORIZED engagement. You plan and drive the assessment through these
phases, in order, and narrate which phase you are in:

1. RECON — map the target: dns_lookup, http_probe, tcp_scan, nmap_scan, dir_enum.
2. VULN SCAN — identify weaknesses: web_vuln_scan, exploit_search.
3. CREDENTIAL TESTING — check for weak/default logins: cred_test (intrusive).
4. EXPLOITATION — for confirmed, exploitable issues, propose the exact validation
   step. You may use run_command (a single shell command on the worker) to verify
   a finding — but it is INTRUSIVE and the operator must approve each command and
   confirm it stays in scope. Prefer minimal proof-of-concept over full compromise;
   do not chain destructive actions.
5. REPORTING — record each confirmed issue with save_finding, then generate_report.
   Set a confidence on every finding (certain = proven/exploited, firm = strong
   evidence, tentative = suspected). Reuse the SAME title for the same issue type
   seen on different assets so the report groups them (one row per affected asset).
6. REMEDIATION — every finding you save MUST include, in its detail: evidence,
   impact, a concrete fix, and incident-response guidance (what to do if this was
   already exploited: contain, collect logs/evidence, what data to request).

Rules of engagement:
- Only act toward the objective and only against in-scope targets.
- Always run passive recon before active steps.
- Every ACTIVE or INTRUSIVE tool call is reviewed by a human operator before it
  runs. Explain your rationale clearly so they can approve or reject.
- Give methodology-level reasoning. Do not produce target-specific exploit code,
  evasion/anti-forensics tooling, denial-of-service, or mass/untargeted scanning.
- When enough is gathered or you are blocked, save findings, generate the report,
  and stop calling tools.

Think step by step. Call one tool at a time.`;

const MAX_STEPS = 20;

async function record(sessionId: string, entry: Record<string, unknown>, io: Server) {
  const at = new Date();
  await Session.updateOne({ _id: sessionId }, { $push: { transcript: { ...entry, at } } });
  io.to(`session:${sessionId}`).emit("transcript", { ...entry, at });
}

async function setStatus(sessionId: string, status: string, io: Server) {
  await Session.updateOne({ _id: sessionId }, { $set: { status } });
  io.to(`session:${sessionId}`).emit("status", { status });
}

/** Persist the provider-facing conversation so a restart can resume the loop. */
async function saveMessages(sessionId: string, messages: ChatMessage[]) {
  await Session.updateOne({ _id: sessionId }, { $set: { messages } });
}

/** Resume any sessions that were mid-run when this process last stopped. */
export function resumeSession(sessionId: string, io: Server): Promise<void> {
  return runSession(sessionId, io, { resume: true });
}

/** Run the agent loop for a session until it stops, errors, or hits MAX_STEPS. */
export async function runSession(
  sessionId: string,
  io: Server,
  opts: { resume?: boolean } = {}
): Promise<void> {
  const session = await Session.findById(sessionId).lean();
  if (!session) throw new Error("session not found");
  const engagement = await Engagement.findById(session.engagement).lean();
  if (!engagement) throw new Error("engagement not found");

  const worker = await getWorkerRef(engagement.worker);
  const scopeState = {
    authorization: { granted: engagement.authorization?.granted ?? false },
    scope: {
      include: engagement.scope?.include ?? [],
      exclude: engagement.scope?.exclude ?? [],
    },
  };

  const aiConfig = await getActiveAiConfig();
  if (!aiConfig.apiKey && aiConfig.provider !== "openai-compatible") {
    await record(
      sessionId,
      { role: "event", content: "No AI API key configured. Set it in Settings → AI Provider." },
      io
    );
    await setStatus(sessionId, "error", io);
    return;
  }
  const provider = makeProvider(aiConfig);
  // Resume from the persisted conversation if one exists; otherwise start fresh.
  const stored = (session.messages as ChatMessage[] | undefined) ?? [];
  const messages: ChatMessage[] =
    opts.resume && stored.length
      ? stored
      : [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Engagement: ${engagement.name} (client: ${engagement.client || "n/a"})
Scope include: ${scopeState.scope.include.join(", ") || "(none)"}
Scope exclude: ${scopeState.scope.exclude.join(", ") || "(none)"}
Objective: ${session.objective || "(none given)"}`,
          },
        ];
  if (!opts.resume) await saveMessages(sessionId, messages);
  if (opts.resume) await record(sessionId, { role: "event", content: "Resumed after backend restart." }, io);

  // Forced REPORTING phase. The agent tends to explore endlessly and end with an
  // empty report; here we restrict the toolset to save_finding/generate_report and
  // make it commit findings from the evidence already gathered before finishing.
  async function finalizeAndFinish(): Promise<void> {
    const already = await Engagement.findById(engagement!._id).select("findings").lean();
    const have = already?.findings?.length ?? 0;
    messages.push({
      role: "user",
      content:
        "REPORTING PHASE — the assessment is over; do NOT run any more scans or probes. " +
        "Using ONLY the evidence already gathered above, call save_finding once for EACH distinct " +
        "issue you observed (e.g. missing security headers like HSTS/CSP, permissive CORS, exposed or " +
        "sensitive endpoints, default/weak credentials, outdated components, information disclosure, " +
        "verbose errors). Each save_finding must include the concrete evidence, business impact, a " +
        "severity (info|low|medium|high|critical), and a specific remediation. " +
        (have > 0 ? `${have} finding(s) are already saved — do NOT duplicate those. ` : "") +
        "After saving every remaining finding, call generate_report. If there is genuinely nothing " +
        "noteworthy, call generate_report now. You may ONLY call save_finding or generate_report.",
    });
    for (let i = 0; i < 12; i++) {
      if (isStopRequested(sessionId)) break;
      const result = await provider.chat(messages, toolSchemas(["save_finding", "generate_report"]));
      if (result.text.trim()) {
        await record(sessionId, { role: "assistant", content: result.text }, io);
        messages.push({ role: "assistant", content: result.text });
      }
      if (result.toolCalls.length === 0) break;
      const call = result.toolCalls[0];
      const tool = TOOLS[call.name];
      if (!tool) {
        messages.push({ role: "user", content: `Tool result (${call.name}): unknown tool` });
        continue;
      }
      let output: string;
      try {
        output = await tool.run(call.arguments, {
          engagementId: String(engagement!._id),
          engagementSlug: engagement!.slug,
          sessionId,
          worker,
        });
      } catch (e) {
        output = `error: ${(e as Error).message}`;
      }
      await record(sessionId, { role: "tool", tool: call.name, content: output, meta: { args: call.arguments } }, io);
      messages.push({ role: "user", content: `Tool result (${call.name}): ${output}` });
      await saveMessages(sessionId, messages);
      if (call.name === "generate_report") break;
    }
    await setStatus(sessionId, "done", io);
  }

  await setStatus(sessionId, "running", io);

  try {
    // On resume, first settle any approval that was pending when we stopped: wait
    // for the (durable) decision, run or reject that tool, then continue the loop.
    if (opts.resume) {
      const pending = await Approval.findOne({ session: sessionId, status: "pending" }).lean();
      if (pending) {
        const approvalId = String(pending._id);
        await setStatus(sessionId, "waiting_approval", io);
        io.to(`session:${sessionId}`).emit("approval", {
          approvalId,
          tool: pending.tool,
          args: pending.args,
          rationale: pending.rationale,
        });
        const approved = await awaitApproval(approvalId);
        if (isStopRequested(sessionId)) {
          clearStop(sessionId);
          await record(sessionId, { role: "event", content: "Session stopped by operator." }, io);
          await setStatus(sessionId, "stopped", io);
          return;
        }
        if (!approved) {
          const msg = "Operator REJECTED this action. Choose a different approach or stop.";
          await record(sessionId, { role: "event", tool: pending.tool, content: msg }, io);
          messages.push({ role: "user", content: `Tool result (${pending.tool}): ${msg}` });
        } else {
          const tool = TOOLS[pending.tool];
          let output: string;
          if (!tool) output = `Unknown tool: ${pending.tool}`;
          else {
            try {
              output = await tool.run(pending.args as Record<string, unknown>, {
                engagementId: String(engagement._id),
                engagementSlug: engagement.slug,
                sessionId,
                worker,
              });
            } catch (e) {
              output = `error: ${(e as Error).message}`;
            }
          }
          await record(sessionId, { role: "tool", tool: pending.tool, content: output, meta: { args: pending.args } }, io);
          messages.push({ role: "user", content: `Tool result (${pending.tool}): ${output}` });
        }
        await saveMessages(sessionId, messages);
        await setStatus(sessionId, "running", io);
      }
    }

    for (let step = 0; step < MAX_STEPS; step++) {
      if (isStopRequested(sessionId)) {
        clearStop(sessionId);
        await record(sessionId, { role: "event", content: "Session stopped by operator." }, io);
        await setStatus(sessionId, "stopped", io);
        return;
      }
      const result = await provider.chat(messages, toolSchemas());

      if (result.text.trim()) {
        await record(sessionId, { role: "assistant", content: result.text }, io);
        messages.push({ role: "assistant", content: result.text });
      }
      await saveMessages(sessionId, messages);

      if (result.toolCalls.length === 0) {
        // The agent stopped calling tools. Force the reporting phase so it records
        // findings from the evidence gathered instead of ending with an empty report.
        await record(sessionId, { role: "event", content: "Entering reporting phase — recording findings and generating the report." }, io);
        await finalizeAndFinish();
        return;
      }

      // Process the first tool call this step (one tool at a time).
      const call = result.toolCalls[0];
      const tool = TOOLS[call.name];
      if (!tool) {
        const msg = `Unknown tool: ${call.name}`;
        await record(sessionId, { role: "tool", tool: call.name, content: msg }, io);
        messages.push({ role: "user", content: `Tool result (${call.name}): ${msg}` });
        continue;
      }

      // Scope + approval gate for ACTIVE and INTRUSIVE tools.
      if (tool.risk !== "passive") {
        // Tools that name a specific target are scope-checked automatically.
        // Freeform tools (e.g. shell) skip the auto-check and rely on the
        // operator to verify scope when approving.
        if (tool.targetArg) {
          const target = String(call.arguments[tool.targetArg] ?? "");
          const decision = checkScope(scopeState, target);
          if (!decision.allowed) {
            const msg = `BLOCKED by scope gate: ${decision.reason}`;
            await record(sessionId, { role: "event", tool: call.name, content: msg }, io);
            messages.push({ role: "user", content: `Tool result (${call.name}): ${msg}` });
            continue;
          }
        }

        // If a stop was requested while the model was thinking, don't enter the
        // approval wait — let the loop top finalize the stop.
        if (isStopRequested(sessionId)) continue;

        if (session.autoApprove) {
          // Auto-approve mode: scope gate still enforced above; skip the human wait.
          await Approval.create({
            session: sessionId,
            tool: call.name,
            args: call.arguments,
            rationale: result.text.slice(0, 500),
            status: "approved",
            decidedBy: "auto-approve",
          });
          await record(
            sessionId,
            { role: "event", tool: call.name, content: "Auto-approved (auto-approve mode)", meta: { args: call.arguments } },
            io
          );
        } else {
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
            { role: "event", tool: call.name, content: "Awaiting operator approval", meta: { approvalId, args: call.arguments } },
            io
          );
          io.to(`session:${sessionId}`).emit("approval", {
            approvalId,
            tool: call.name,
            args: call.arguments,
            rationale: result.text.slice(0, 500),
          });
          void notifyApproval({
            approvalId,
            tool: call.name,
            args: call.arguments,
            rationale: result.text.slice(0, 500),
          });

          const approved = await awaitApproval(approvalId);

          if (!approved) {
            if (isStopRequested(sessionId)) continue; // stop is handled at the loop top
            await setStatus(sessionId, "running", io);
            const msg = "Operator REJECTED this action. Choose a different approach or stop.";
            await record(sessionId, { role: "event", tool: call.name, content: msg }, io);
            messages.push({ role: "user", content: `Tool result (${call.name}): ${msg}` });
            continue;
          }
          await setStatus(sessionId, "running", io);
        }
      }

      // Execute the tool.
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
    }

    // Hit the step limit — still force a reporting phase so the work isn't lost.
    await record(sessionId, { role: "event", content: `Reached step limit (${MAX_STEPS}) — entering reporting phase.` }, io);
    await finalizeAndFinish();
  } catch (e) {
    log.error("orchestrator error", e);
    await record(sessionId, { role: "event", content: `Error: ${(e as Error).message}` }, io);
    await setStatus(sessionId, "error", io);
  }
}
