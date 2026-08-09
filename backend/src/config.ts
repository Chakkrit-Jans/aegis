import "dotenv/config";

export type ProviderName = "deepseek" | "anthropic" | "openai-compatible";

export const config = {
  port: Number(process.env.PORT ?? 8080),
  mongoUrl: process.env.MONGO_URL ?? "mongodb://localhost:27017/aegis",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim()),
  ai: {
    provider: (process.env.AI_PROVIDER ?? "deepseek") as ProviderName,
    deepseekKey: process.env.DEEPSEEK_API_KEY ?? "",
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    baseUrl: process.env.AI_BASE_URL ?? "",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "",
  },
  worker: {
    url: process.env.WORKER_URL ?? "http://worker:7000",
    token: process.env.WORKER_TOKEN ?? "",
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "",
    tokenTtlHours: Number(process.env.TOKEN_TTL_HOURS ?? 12),
    adminEmail: process.env.ADMIN_EMAIL ?? "admin",
    adminPassword: process.env.ADMIN_PASSWORD ?? "admin1234",
  },
};

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  deepseek: "deepseek-reasoner",
  anthropic: "claude-sonnet-5",
  "openai-compatible": "gpt-4o-mini",
};

export function activeModel(): string {
  return config.ai.model || DEFAULT_MODELS[config.ai.provider];
}
