/** In-memory stop flags. The orchestrator loop checks these each step to allow
 * the operator to cancel a running session. */
const stopRequests = new Set<string>();

export function requestStop(sessionId: string): void {
  stopRequests.add(sessionId);
}
export function isStopRequested(sessionId: string): boolean {
  return stopRequests.has(sessionId);
}
export function clearStop(sessionId: string): void {
  stopRequests.delete(sessionId);
  steerQueues.delete(sessionId); // drop any un-consumed live instructions when the session ends
}

/** In-memory per-session queue of live operator "chat" instructions. The
 * orchestrator drains these at the top of each step and feeds them to the agent
 * as additional user guidance (active tools still pass the normal approval gate). */
const steerQueues = new Map<string, string[]>();

export function pushSteer(sessionId: string, text: string): void {
  const q = steerQueues.get(sessionId) ?? [];
  q.push(text);
  steerQueues.set(sessionId, q);
}
export function drainSteer(sessionId: string): string[] {
  const q = steerQueues.get(sessionId);
  if (!q || q.length === 0) return [];
  steerQueues.delete(sessionId);
  return q;
}
