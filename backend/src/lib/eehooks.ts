/**
 * Extension points the (optional) Enterprise overlay plugs into. In a Community
 * build these keep their no-op defaults, so core code runs unchanged; when the
 * `ee/` modules load at boot they overwrite these with real implementations.
 */
import type { ReportBranding } from "../report/html.js";
import type { ToolDef } from "../ai/tools.js";

export const eeHooks: {
  effectiveBranding: () => Promise<ReportBranding | null>;
  auditForward: (event: Record<string, unknown>) => Promise<void>;
  /** Enterprise-only agent tools merged into the registry (empty in Community). */
  extraTools: Record<string, ToolDef>;
} = {
  effectiveBranding: async () => null,
  auditForward: async () => {},
  extraTools: {},
};
