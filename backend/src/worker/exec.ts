/**
 * Low-level client for a Kali worker's token-gated exec agent. Every call names
 * the specific worker to run on (url + token), so the platform can drive several
 * workers in parallel. Only whitelisted binaries may run (the worker enforces
 * its own allow-list too — defense in depth).
 */
export interface WorkerRef {
  url: string;
  token: string;
}

export const ALLOWED_BINS = new Set([
  "nmap",
  "nuclei",
  "nikto",
  "whatweb",
  "ffuf",
  "gobuster",
  "hydra",
  "searchsploit",
  "dig",
  "sqlmap",
  "commix",
  "dalfox",
  "msfconsole",
]);

export interface ExecStatus {
  reachable: boolean; // did the worker respond at all
  code: number; // the tool's exit code (-1 if unknown)
  output: string;
}

export interface ShellResult {
  code: number;
  output: string;
}

export async function workerExec(worker: WorkerRef, bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const r = await workerExecStatus(worker, bin, args, timeoutMs);
  return r.output || "(no output)";
}

export async function workerExecStatus(worker: WorkerRef, bin: string, args: string[], timeoutMs = 120_000): Promise<ExecStatus> {
  if (!ALLOWED_BINS.has(bin)) return { reachable: true, code: -1, output: `error: tool '${bin}' is not on the allow-list.` };
  try {
    const res = await fetch(`${worker.url}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${worker.token}` },
      body: JSON.stringify({ bin, args, timeout: Math.ceil(timeoutMs / 1000) }),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    });
    if (res.status === 401) return { reachable: true, code: -1, output: "worker error: unauthorized (token mismatch)." };
    if (!res.ok) return { reachable: false, code: -1, output: `worker error: HTTP ${res.status}` };
    const data = (await res.json()) as { code?: number; output?: string };
    return { reachable: true, code: data.code ?? -1, output: (data.output || "").slice(0, 8000) };
  } catch (e) {
    return { reachable: false, code: -1, output: `worker offline/unreachable: ${(e as Error).message}` };
  }
}

/** Run an arbitrary shell command on a worker. Callers MUST gate this (approval + audit). */
export async function workerShell(worker: WorkerRef, command: string, cwd = "/root", timeoutMs = 120_000): Promise<ShellResult> {
  try {
    const res = await fetch(`${worker.url}/shell`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${worker.token}` },
      body: JSON.stringify({ command, cwd, timeout: Math.ceil(timeoutMs / 1000) }),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    });
    if (res.status === 401) return { code: -1, output: "worker error: unauthorized (token mismatch)." };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { code: -1, output: body.error ? `worker error: ${body.error}` : `worker error: HTTP ${res.status}` };
    }
    const data = (await res.json()) as ShellResult;
    return { code: data.code ?? -1, output: (data.output ?? "").slice(0, 16000) };
  } catch (e) {
    return { code: -1, output: `worker offline/unreachable: ${(e as Error).message}` };
  }
}

/** Quick health probe for a worker. */
export async function workerHealth(worker: WorkerRef): Promise<{ ok: boolean; tools?: string[]; error?: string }> {
  try {
    const res = await fetch(`${worker.url}/health`, {
      headers: { Authorization: `Bearer ${worker.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; tools?: string[] };
    return { ok: Boolean(data.ok), tools: data.tools };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
