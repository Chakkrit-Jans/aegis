/**
 * Approval registry — the human-in-the-loop chokepoint, made durable.
 *
 * The Approval document in MongoDB is the source of truth for a decision; Redis
 * pub/sub is only the "wake up" signal. This means a decision survives a backend
 * restart and can be delivered to whichever process is running the agent loop:
 *   - decideApproval() writes the decision to the DB and publishes it.
 *   - awaitApproval() resolves from the DB on entry (in case it was decided while
 *     this process was down), subscribes for the instant signal, and polls the DB
 *     as a safety net so a decision is never lost.
 */
import { Approval } from "../db/mongo.js";
import { redisPub, redisSub } from "../lib/redis.js";

const PREFIX = "aegis:approval:";
const channel = (id: string) => PREFIX + id;

// Waiters living in THIS process, keyed by approval id.
const waiters = new Map<string, (approved: boolean) => void>();

redisSub.on("message", (chan: string, payload: string) => {
  if (!chan.startsWith(PREFIX)) return;
  const fn = waiters.get(chan.slice(PREFIX.length));
  if (fn) fn(payload === "approved");
});

/** Suspend until this approval id is decided (durably). */
export async function awaitApproval(id: string): Promise<boolean> {
  const cur = await Approval.findById(id).select("status").lean();
  if (cur && cur.status !== "pending") return cur.status === "approved";

  return new Promise<boolean>((resolve) => {
    let done = false;
    let poll: NodeJS.Timeout;
    const finish = (approved: boolean) => {
      if (done) return;
      done = true;
      waiters.delete(id);
      clearInterval(poll);
      redisSub.unsubscribe(channel(id)).catch(() => {});
      resolve(approved);
    };
    waiters.set(id, finish);
    redisSub.subscribe(channel(id)).catch(() => {});
    // Safety poll: covers a subscribe race or a signal published cross-instance.
    poll = setInterval(async () => {
      const a = await Approval.findById(id).select("status").lean();
      if (a && a.status !== "pending") finish(a.status === "approved");
    }, 3000);
  });
}

/**
 * Record a decision durably and wake any waiter (this process or another).
 * Returns "ok" when a pending approval was decided, or why it couldn't be.
 */
export async function decideApproval(
  id: string,
  approved: boolean,
  decidedBy = ""
): Promise<"ok" | "not_pending" | "not_found"> {
  const appr = await Approval.findById(id);
  if (!appr) return "not_found";
  if (appr.status !== "pending") return "not_pending";
  appr.status = approved ? "approved" : "rejected";
  if (decidedBy) appr.decidedBy = decidedBy;
  await appr.save();
  await redisPub.publish(channel(id), approved ? "approved" : "rejected").catch(() => {});
  const fn = waiters.get(id); // same-process fast path
  if (fn) fn(approved);
  return "ok";
}

export function isPending(id: string): boolean {
  return waiters.has(id);
}
