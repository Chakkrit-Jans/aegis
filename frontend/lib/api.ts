export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const TOKEN_KEY = "aegis_token";
let token: string | null = null;

export function loadToken(): string | null {
  if (token) return token;
  if (typeof window !== "undefined") token = window.localStorage.getItem(TOKEN_KEY);
  return token;
}
export function setToken(t: string | null): void {
  token = t;
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Thrown on 401 so the UI can drop back to the login gate. */
export class AuthError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const t = loadToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    throw new AuthError("unauthorized");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const get = <T>(path: string) => req<T>(path);

/** Fetch a plain-text response (e.g. a Markdown report) with auth. */
async function getText(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const t = loadToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 401) {
    setToken(null);
    throw new AuthError("unauthorized");
  }
  if (!res.ok) throw new Error(res.statusText);
  return res.text();
}

/** Fetch a binary response (e.g. an export download) with auth. */
async function getBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const t = loadToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 401) {
    setToken(null);
    throw new AuthError("unauthorized");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.blob();
}

/* --------------------------------------------------------------- types */

export interface Engagement {
  _id: string;
  slug: string;
  name: string;
  client: string;
  worker: string;
  authorization: { granted: boolean; by: string; ref: string };
  scope: { include: string[]; exclude: string[] };
  findings: { title: string; severity: string; asset: string; detail: string }[];
}

export interface WorkerRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  isDefault: boolean;
  tokenSet: boolean;
}

export interface Session {
  _id: string;
  objective: string;
  status: string;
  transcript: TranscriptEntry[];
}

export interface SessionSummary {
  _id: string;
  objective: string;
  status: string;
  createdAt: string;
  entries: number;
}

export interface TranscriptEntry {
  role: string;
  content: string;
  tool?: string;
  meta?: Record<string, unknown>;
  at?: string;
}

export interface FeedRun {
  ok: boolean;
  at: string;
  summary: string;
}
export interface FeedSource {
  id: string;
  label: string;
  description: string;
}
export interface FeedWorker {
  id: string;
  name: string;
}
export interface UpdatesInfo {
  sources: FeedSource[];
  workers: FeedWorker[];
  runs: Record<string, Record<string, FeedRun>>; // runs[workerId][sourceId]
  autoEnabled: boolean;
  intervalHours: number;
}

export interface Me {
  email: string;
  role: string;
}

export interface TemplateLevels {
  basic: string;
  medium: string;
  advanced: string;
}
export interface CustomTemplate {
  id: string;
  name: string;
  levels: TemplateLevels;
}

export interface ShellResult {
  code: number;
  output: string;
}

export interface FeatureRow {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}
export interface Entitlements {
  edition: "community" | "enterprise";
  org: string | null;
  expires: number | null;
  licenseError: string | null;
  features: FeatureRow[];
  limits: { aiProviders: number | null; workers: number | null };
}
export interface LicenseInfo {
  edition: string;
  org: string | null;
  expires: number | null;
  error: string | null;
}

export interface Branding {
  companyName: string;
  logoDataUrl: string;
  primaryColor: string;
  footer: string;
}
export interface BrandingResponse {
  branding: Branding;
  enabled: boolean;
}

export interface AuditExportConfig {
  siemEnabled: boolean;
  siemUrl: string;
  siemTokenSet: boolean;
}
export interface AuditExportResponse {
  config: AuditExportConfig;
  enabled: boolean;
}
export interface SiemTestResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface OrgTemplate {
  id: string;
  name: string;
  levels: TemplateLevels;
  addedBy: string;
  addedAt: string;
}
export interface OrgTemplatesResponse {
  templates: OrgTemplate[];
  enabled: boolean;
}
export interface OrgImportResult {
  ok: boolean;
  imported?: number;
  fingerprint?: string;
  error?: string;
}

export interface AboutInfo {
  app: { name: string; version: string; git: string; description: string };
  edition: string;
  license: { org: string | null; expires: number | null; error?: string } | null;
  runtime: { node: string; platform: string; uptimeSec: number };
  services: { mongodb: string; redis: string };
  components: { name: string; version: string }[];
}
export interface WorkerToolsInfo {
  worker: string | null;
  tools: { name: string; version: string }[];
  error?: string;
}

export interface SsoStatus {
  enabled: boolean;
  label: string;
}
export interface SsoConfigPublic {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  buttonLabel: string;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: string;
}
export interface SsoConfigResponse {
  config: SsoConfigPublic;
  enabled: boolean;
}

export interface Integrations {
  proxy: { enabled: boolean; url: string; label: string };
  telegram: { enabled: boolean; chatId: string; botTokenSet: boolean };
}

export interface AiProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeySet: boolean;
  isDefault: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  role: string;
  createdAt?: string;
}

export interface AuditRow {
  _id: string;
  actor: string;
  actorRole: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  createdAt: string;
}

/* --------------------------------------------------------------- api */

export const api = {
  // auth
  login: (email: string, password: string) => post<{ token: string }>("/api/auth/login", { email, password }),
  me: () => get<Me>("/api/auth/me"),
  changePassword: (current: string, next: string) =>
    post<{ ok: boolean }>("/api/auth/change-password", { current, next }),

  // engagements
  listEngagements: () => get<Engagement[]>("/api/engagements"),
  createEngagement: (name: string, client: string) =>
    post<Engagement>("/api/engagements", { name, client }),
  deleteEngagement: (slug: string) =>
    req<{ ok: boolean }>(`/api/engagements/${slug}`, { method: "DELETE" }),
  auth: (slug: string, by: string, ref: string) =>
    post<Engagement>(`/api/engagements/${slug}/auth`, { by, ref }),
  scope: (slug: string, body: { add?: string; exclude?: string; remove?: string }) =>
    post<Engagement>(`/api/engagements/${slug}/scope`, body),
  setEngagementWorker: (slug: string, worker: string) =>
    post<Engagement>(`/api/engagements/${slug}/worker`, { worker }),

  // workers (admin)
  listWorkers: () => get<{ workers: WorkerRow[]; defaultId: string }>("/api/workers"),
  createWorker: (body: { name?: string; url: string; token?: string; enabled?: boolean }) =>
    post<{ id: string }>("/api/workers", body),
  updateWorker: (id: string, body: { name?: string; url?: string; token?: string; enabled?: boolean }) =>
    req<{ ok: boolean }>(`/api/workers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteWorker: (id: string) => req<{ ok: boolean }>(`/api/workers/${id}`, { method: "DELETE" }),
  setDefaultWorker: (id: string) => post<{ ok: boolean }>(`/api/workers/${id}/default`),
  workerHealth: (id: string) => get<{ ok: boolean; tools?: string[]; error?: string }>(`/api/workers/${id}/health`),

  // sessions
  createSession: (engagementSlug: string, objective: string, autoApprove: boolean) =>
    post<Session>("/api/sessions", { engagementSlug, objective, autoApprove }),
  listSessions: (engagementSlug: string) =>
    get<SessionSummary[]>(`/api/sessions?engagement=${encodeURIComponent(engagementSlug)}`),
  getSession: (id: string) => get<Session>(`/api/sessions/${id}`),
  stopSession: (id: string) => post<{ ok: boolean }>(`/api/sessions/${id}/stop`),
  getReport: (slug: string) => getText(`/api/engagements/${slug}/report`),
  getReportHtml: (slug: string) => getText(`/api/engagements/${slug}/report.html`),
  decide: (sessionId: string, approvalId: string, decision: "approve" | "reject") =>
    post<{ ok: boolean }>(`/api/sessions/${sessionId}/approvals/${approvalId}`, { decision }),

  // updates
  getUpdates: () => get<UpdatesInfo>("/api/updates"),
  runUpdate: (id: string) => post<Record<string, FeedRun>>(`/api/updates/${id}/run`),
  runAllUpdates: () => post<Record<string, Record<string, FeedRun>>>("/api/updates/run-all"),
  setSchedule: (autoEnabled: boolean, intervalHours: number) =>
    post<UpdatesInfo>("/api/updates/schedule", { autoEnabled, intervalHours }),

  // shell (operator live shell)
  shellRun: (engagementSlug: string, command: string, sessionId?: string, cwd?: string) =>
    post<ShellResult>("/api/shell", { engagementSlug, command, sessionId, cwd }),

  // AI provider profiles (admin)
  listAiProfiles: () => get<{ profiles: AiProfile[]; defaultId: string }>("/api/integrations/ai/profiles"),
  createAiProfile: (body: { name?: string; provider: string; apiKey?: string; baseUrl?: string; model?: string }) =>
    post<{ id: string }>("/api/integrations/ai/profiles", body),
  updateAiProfile: (id: string, body: { name?: string; provider?: string; apiKey?: string; baseUrl?: string; model?: string }) =>
    req<{ ok: boolean }>(`/api/integrations/ai/profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAiProfile: (id: string) => req<{ ok: boolean }>(`/api/integrations/ai/profiles/${id}`, { method: "DELETE" }),
  setDefaultAiProfile: (id: string) => post<{ ok: boolean }>(`/api/integrations/ai/profiles/${id}/default`),
  testAiProfile: (id: string) =>
    post<{ ok: boolean; provider: string; model: string; reply: string }>(`/api/integrations/ai/profiles/${id}/test`),
  listAiProfileModels: (id: string) => get<{ provider: string; models: string[] }>(`/api/integrations/ai/profiles/${id}/models`),

  // integrations (admin)
  getIntegrations: () => get<Integrations>("/api/integrations"),
  setProxy: (body: { enabled?: boolean; url?: string; label?: string }) =>
    post<Integrations>("/api/integrations/proxy", body),
  setTelegram: (body: { enabled?: boolean; botToken?: string; chatId?: string }) =>
    post<Integrations>("/api/integrations/telegram", body),
  testTelegram: () => post<{ ok: boolean }>("/api/integrations/telegram/test"),

  // users (admin)
  listUsers: () => get<UserRow[]>("/api/users"),
  createUser: (email: string, password: string, role: string) =>
    post<{ ok: boolean }>("/api/users", { email, password, role }),
  deleteUser: (id: string) => req<{ ok: boolean }>(`/api/users/${id}`, { method: "DELETE" }),

  // audit
  getAudit: () => get<AuditRow[]>("/api/audit"),

  // about / versions
  getAbout: () => get<AboutInfo>("/api/about"),
  getWorkerTools: () => get<WorkerToolsInfo>("/api/about/worker-tools"),

  // edition / licensing
  getEntitlements: () => get<Entitlements>("/api/edition"),
  getLicenseInfo: () => get<LicenseInfo>("/api/edition/license"),
  applyLicense: (license: string) =>
    post<{ edition: string; org: string | null; expires: number | null }>("/api/edition/license", { license }),
  removeLicense: () => req<{ ok: boolean }>("/api/edition/license", { method: "DELETE" }),

  // report branding (enterprise)
  getBranding: () => get<BrandingResponse>("/api/branding"),
  setBranding: (b: Branding) => post<BrandingResponse>("/api/branding", b),

  // audit export & SIEM (enterprise)
  getAuditExportConfig: () => get<AuditExportResponse>("/api/audit/export/config"),
  setAuditExportConfig: (body: { siemEnabled?: boolean; siemUrl?: string; siemToken?: string }) =>
    post<AuditExportResponse>("/api/audit/export/config", body),
  testAuditSiem: () => post<SiemTestResult>("/api/audit/export/test"),
  downloadAudit: (format: "json" | "csv" | "ndjson") => getBlob(`/api/audit/export?format=${format}`),

  // SSO / OIDC (enterprise)
  getSsoStatus: () => get<SsoStatus>("/api/auth/sso/status"), // public
  getSsoConfig: () => get<SsoConfigResponse>("/api/auth/sso/config"),
  setSsoConfig: (body: Partial<SsoConfigPublic> & { clientSecret?: string }) =>
    post<SsoConfigResponse>("/api/auth/sso/config", body),
  ssoLoginUrl: () => `${API}/api/auth/sso/login`,

  // org template library (enterprise)
  listOrgTemplates: () => get<OrgTemplatesResponse>("/api/org-templates"),
  addOrgTemplate: (name: string, levels: TemplateLevels) => post<OrgTemplate>("/api/org-templates", { name, levels }),
  removeOrgTemplate: (id: string) => req<{ ok: boolean }>(`/api/org-templates/${id}`, { method: "DELETE" }),
  exportOrgTemplates: () => getBlob("/api/org-templates/export"),
  importOrgTemplates: (bundle: unknown) => post<OrgImportResult>("/api/org-templates/import", bundle),

  // custom objective templates
  listTemplates: () => get<CustomTemplate[]>("/api/templates"),
  createTemplate: (name: string, levels: TemplateLevels) =>
    post<CustomTemplate>("/api/templates", { name, levels }),
  updateTemplate: (id: string, body: { name?: string; levels?: TemplateLevels }) =>
    req<{ ok: boolean }>(`/api/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTemplate: (id: string) => req<{ ok: boolean }>(`/api/templates/${id}`, { method: "DELETE" }),
  importTemplates: (templates: { name: string; levels: TemplateLevels }[], replace: boolean) =>
    post<{ imported: number }>("/api/templates/import", { templates, replace }),
};
