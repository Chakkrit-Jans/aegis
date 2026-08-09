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
}
