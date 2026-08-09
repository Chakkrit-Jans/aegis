/**
 * Extension points the (optional) Enterprise overlay plugs into. In a Community
 * build these keep their no-op defaults, so core code runs unchanged; when the
 * `ee/` modules load at boot they overwrite these with real implementations.
 */
import type { ReportBranding } from "../report/html.js";

export const eeHooks: {
  effectiveBranding: () => Promise<ReportBranding | null>;
  auditForward: (event: Record<string, unknown>) => Promise<void>;
} = {
  effectiveBranding: async () => null,
  auditForward: async () => {},
};
