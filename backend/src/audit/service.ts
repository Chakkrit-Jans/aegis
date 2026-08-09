import { Audit } from "../db/mongo.js";
import { log } from "../lib/log.js";
import { eeHooks } from "../lib/eehooks.js";

export interface AuditEntry {
  actor?: string;
  actorRole?: string;
  action: string;
  target?: string;
  detail?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

/** Append an immutable audit record. Never throws into the caller's path. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const doc = await Audit.create({
      actor: entry.actor ?? "system",
      actorRole: entry.actorRole ?? "",
      action: entry.action,
      target: entry.target ?? "",
      detail: entry.detail ?? "",
      meta: entry.meta ?? {},
      ip: entry.ip ?? "",
    });
    // Enterprise (if the ee/ overlay is present): stream to SIEM. Fire-and-forget
    // — never blocks or fails the audited action; a no-op in Community.
    void eeHooks.auditForward({
      at: doc.createdAt,
      actor: doc.actor,
      actorRole: doc.actorRole,
      action: doc.action,
      target: doc.target,
      detail: doc.detail,
      ip: doc.ip,
    }).catch(() => {});
  } catch (e) {
    log.error("audit write failed", e);
  }
}
