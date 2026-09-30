// config.ts — every env var this component reads, read once, by name, here
// and nowhere else. Nothing is required for the process to start (the
// component contract); a value that is genuinely required for a /chat turn
// to succeed (the model connection, the classification-db connection) is
// simply reported by /healthz's `missing` when unset, never used to refuse
// to boot.

export interface Config {
  port: number;

  // Model access — an ai-agent component's own env vars, no dependency
  // declared for them. See agent-building's "Model access".
  modelEndpoint?: string;
  modelName?: string;
  modelApiKey?: string;
  modelApiFormat?: string;
  modelApiAuthScheme?: string;
  modelApiKeyHeader?: string;

  // classification-db — the platform-resource dependency wired in
  // design.json's dependencies[].wiring.envBindings. These exact names, and
  // no others: CLASSIFICATION_DB_DBNAME (not *_NAME), _HOST, _PASSWORD,
  // _PORT, _USER.
  classificationDbHost?: string;
  classificationDbPort?: string;
  classificationDbName?: string;
  classificationDbUser?: string;
  classificationDbPassword?: string;

  // Tracing — set by the platform only in a governed environment. Absent
  // anywhere else, and tracing.ts stays inert when they are.
  ampOtelEndpoint?: string;
  ampAgentApiKey?: string;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 9090),

  modelEndpoint: process.env.MODEL_ENDPOINT,
  modelName: process.env.MODEL_NAME,
  modelApiKey: process.env.MODEL_API_KEY,
  modelApiFormat: process.env.MODEL_API_FORMAT,
  modelApiAuthScheme: process.env.MODEL_API_AUTH_SCHEME,
  modelApiKeyHeader: process.env.MODEL_API_KEY_HEADER,

  classificationDbHost: process.env.CLASSIFICATION_DB_HOST,
  classificationDbPort: process.env.CLASSIFICATION_DB_PORT,
  classificationDbName: process.env.CLASSIFICATION_DB_DBNAME,
  classificationDbUser: process.env.CLASSIFICATION_DB_USER,
  classificationDbPassword: process.env.CLASSIFICATION_DB_PASSWORD,

  ampOtelEndpoint: process.env.AMP_OTEL_ENDPOINT,
  ampAgentApiKey: process.env.AMP_AGENT_API_KEY,
};

// From agent.afm.md's front matter (`max_iterations: 4`).
export const MAX_ITERATIONS = 4;

// Names of the required env vars that are currently unset — what
// /healthz's `missing` reports. MODEL_* has no fallback (agent-building,
// "Model access"). CLASSIFICATION_DB_* has none either here: unlike the
// generic optional conversation-memory dependency, this agent's business
// record (the CLASSIFICATION entity) has no in-memory substitute — every
// submission must durably land in classification-db, so its connection is
// as required as the model's.
export function missingRequiredEnv(): string[] {
  const missing: string[] = [];
  if (!config.modelEndpoint) missing.push("MODEL_ENDPOINT");
  if (!config.modelName) missing.push("MODEL_NAME");
  if (!config.modelApiKey) missing.push("MODEL_API_KEY");
  if (!config.modelApiFormat) missing.push("MODEL_API_FORMAT");
  if (!config.classificationDbHost) missing.push("CLASSIFICATION_DB_HOST");
  if (!config.classificationDbPort) missing.push("CLASSIFICATION_DB_PORT");
  if (!config.classificationDbName) missing.push("CLASSIFICATION_DB_DBNAME");
  if (!config.classificationDbUser) missing.push("CLASSIFICATION_DB_USER");
  if (!config.classificationDbPassword) missing.push("CLASSIFICATION_DB_PASSWORD");
  return missing;
}
