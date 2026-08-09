/**
 * The scope gate — single chokepoint deciding whether an active action against
 * a target is permitted. Mirrors the Pentest Copilot design:
 *   1. the engagement must have recorded authorization, AND
 *   2. the target must match an include rule and no exclude rule.
 */

export interface ScopeState {
  authorization: { granted: boolean };
  scope: { include: string[]; exclude: string[] };
}

export interface ScopeDecision {
  allowed: boolean;
  reason: string;
}

/** Normalize a target (host or URL) down to a bare hostname for matching. */
export function targetHost(target: string): string {
  let t = target.trim().toLowerCase();
  try {
    if (t.includes("://")) t = new URL(t).hostname;
  } catch {
    /* fall through — treat as raw host */
  }
  // strip port / path if still present
  t = t.split("/")[0].split(":")[0];
  return t;
}

/** A rule matches if it equals the host or is a parent domain suffix.
 * The rule is normalized the same way as the target, so a scope entry written
 * with a scheme/port/path (e.g. "juiceshop:3000" or "http://juiceshop:3000/")
 * still matches a bare-host target ("juiceshop"). Scope is host-based; the port
 * on a rule is documentation only and is not enforced. */
function matches(rule: string, host: string): boolean {
  const r = targetHost(rule);
  if (!r) return false;
  if (r === host) return true;
  // wildcard / domain suffix: "acme.test" matches "app.acme.test"
  return host.endsWith(`.${r}`);
}

export function checkScope(state: ScopeState, target: string): ScopeDecision {
  if (!state.authorization.granted) {
    return {
      allowed: false,
      reason: "No recorded authorization for this engagement. Run `auth` first.",
    };
  }
  const host = targetHost(target);
  if (!host) return { allowed: false, reason: "Empty/invalid target." };

  if (state.scope.exclude.some((r) => matches(r, host))) {
    return { allowed: false, reason: `Target ${host} is explicitly EXCLUDED from scope.` };
  }
  if (!state.scope.include.some((r) => matches(r, host))) {
    return { allowed: false, reason: `Target ${host} is not within the engagement scope.` };
  }
  return { allowed: true, reason: `Target ${host} is authorized and in scope.` };
}
