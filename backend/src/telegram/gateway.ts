import { getIntegrations } from "../integrations/service.js";
import { decideApproval } from "../approvals/registry.js";
import { Approval } from "../db/mongo.js";
import { audit } from "../audit/service.js";
import { log } from "../lib/log.js";

const TG = "https://api.telegram.org";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tg(method: string, botToken: string, body: unknown, timeoutMs = 35_000): Promise<any> {
  const res = await fetch(`${TG}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

/** Plain outbound notification (session events, etc.). No-op when disabled. */
export async function notify(text: string): Promise<void> {
  const { telegram } = await getIntegrations();
  if (!telegram.enabled || !telegram.botToken || !telegram.chatId) return;
  try {
    await tg("sendMessage", telegram.botToken, { chat_id: telegram.chatId, text, parse_mode: "HTML" });
  } catch (e) {
    log.error("telegram notify failed", e);
  }
}

/** Send an approval request with inline Approve/Reject buttons. */
export async function notifyApproval(a: {
  approvalId: string;
  tool: string;
  args: unknown;
  rationale: string;
}): Promise<void> {
  const { telegram } = await getIntegrations();
  if (!telegram.enabled || !telegram.botToken || !telegram.chatId) return;
  const text =
    `🛡️ <b>Approval required</b>\n` +
    `Tool: <code>${escapeHtml(a.tool)}</code>\n` +
    `Args: <code>${escapeHtml(JSON.stringify(a.args)).slice(0, 500)}</code>\n\n` +
    `${escapeHtml(a.rationale).slice(0, 800)}`;
  try {
    await tg("sendMessage", telegram.botToken, {
      chat_id: telegram.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${a.approvalId}` },
            { text: "⛔ Reject", callback_data: `reject:${a.approvalId}` },
          ],
        ],
      },
    });
  } catch (e) {
    log.error("telegram approval notify failed", e);
  }
}

/** Send a test message; returns an error string or "" on success. */
export async function sendTest(): Promise<string> {
  const { telegram } = await getIntegrations();
  if (!telegram.botToken || !telegram.chatId) return "bot token and chat id required";
  try {
    const r = await tg("sendMessage", telegram.botToken, {
      chat_id: telegram.chatId,
      text: "✅ Aegis Telegram gateway connected.",
    });
    return r?.ok ? "" : r?.description ?? "telegram rejected the message";
  } catch (e) {
    return (e as Error).message;
  }
}

async function handleCallback(botToken: string, cb: any): Promise<void> {
  const [action, id] = String(cb.data ?? "").split(":");
  let outcome = "no longer pending";
  if ((action === "approve" || action === "reject") && id) {
    const approval = await Approval.findById(id).catch(() => null);
    if (approval && approval.status === "pending") {
      const approved = action === "approve";
      const who0 = cb.from?.username ? `@${cb.from.username}` : String(cb.from?.id ?? "?");
      if ((await decideApproval(id, approved, `telegram:${who0}`)) === "ok") {
        outcome = approved ? "✅ Approved" : "⛔ Rejected";
        const who = cb.from?.username ? `@${cb.from.username}` : String(cb.from?.id ?? "?");
        await audit({
          actor: `telegram:${who}`,
          action: `approval.${action}`,
          target: id,
          detail: approval.tool,
        });
      } else {
        outcome = "session no longer waiting";
      }
    }
  }
  await tg("answerCallbackQuery", botToken, { callback_query_id: cb.id, text: outcome }).catch(() => {});
  if (cb.message) {
    await tg("editMessageText", botToken, {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: `${cb.message.text}\n\n→ ${outcome}`,
    }).catch(() => {});
  }
}

let running = false;
let offset = 0;

/** Long-poll Telegram for button presses. Idle-loops while the gateway is off. */
export function startTelegramPolling(): void {
  if (running) return;
  running = true;
  void (async () => {
    while (running) {
      try {
        const { telegram } = await getIntegrations();
        if (!telegram.enabled || !telegram.botToken) {
          await sleep(5000);
          continue;
        }
        const res = await tg(
          "getUpdates",
          telegram.botToken,
          { offset, timeout: 30, allowed_updates: ["callback_query"] },
          40_000
        );
        for (const u of (res?.result ?? []) as any[]) {
          offset = u.update_id + 1;
          if (u.callback_query) await handleCallback(telegram.botToken, u.callback_query);
        }
      } catch (e) {
        log.error("telegram poll error", e);
        await sleep(5000);
      }
    }
  })();
}
