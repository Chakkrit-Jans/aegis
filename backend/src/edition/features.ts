/**
 * Open-core feature registry — the single source of truth for what belongs to
 * which edition. Everything NOT listed here is Community (free), including every
 * safety feature (scope gate, approval gate, audit): those are never gated.
 */
export type Edition = "community" | "enterprise";

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
}

/** Capabilities that require an Enterprise license. */
export const ENTERPRISE_FEATURES: FeatureDef[] = [
  { key: "ai.multiProvider", label: "Multiple AI providers", description: "Register more than one AI provider profile (routing / fallback / cost control)." },
  { key: "workers.multi", label: "Multiple Kali workers", description: "Run and assign more than one Kali worker (per-client isolation, scale)." },
  { key: "sso", label: "SSO / SAML / OIDC", description: "Enterprise single sign-on and directory-based roles." },
  { key: "report.branding", label: "White-label reports", description: "Custom branding / logo on client reports and exports." },
  { key: "audit.export", label: "Audit export & SIEM", description: "Stream the immutable audit log to a SIEM with retention policies." },
  { key: "feeds.schedule", label: "Scheduled feed updates", description: "Automatic vuln-feed updates across the whole worker fleet." },
  { key: "templates.orgLibrary", label: "Org template library", description: "Shared, signed objective-template library across the team." },
];

/** Numeric caps applied in Community for otherwise-Enterprise capabilities. */
export const COMMUNITY_LIMITS = {
  aiProviders: 1,
  workers: 1,
} as const;

export const isEnterpriseFeature = (key: string): boolean =>
  ENTERPRISE_FEATURES.some((f) => f.key === key);
