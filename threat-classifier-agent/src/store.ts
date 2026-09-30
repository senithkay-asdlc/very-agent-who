// store.ts — server-held conversation memory (x-aep.memory.type: "server").
//
// This agent is anonymous by explicit product decision (design.json): there
// is no gateway-injected x-user-id, so unlike the standard agent-building
// pattern there is no per-user scoping to enforce. A conversation is keyed
// by its id alone.
//
// Two backings implement one interface, exactly as agent-building's
// building.md prescribes for the general case: a real deployment has
// classification-db reachable, so every turn is durable Postgres, shared by
// every replica; the in-memory backing exists only for local runs and
// build-time evaluation, where no database is provisioned for the agent to
// reach.
import type { ModelMessage } from "ai";
import { config } from "./config.js";
import { pool } from "./db.js";
import { initClassifications } from "./classifications.js";

interface ConversationStore {
  init(): Promise<void>;
  load(id: string): Promise<ModelMessage[] | null>;
  save(id: string, messages: ModelMessage[]): Promise<void>;
}

const INIT = `CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  messages jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function postgresStore(): ConversationStore {
  return {
    init: () => pool.query(INIT).then(() => undefined),

    load: async (id) => {
      if (!UUID_RE.test(id)) return null; // malformed = not found, no pg error
      const r = await pool.query(
        "SELECT messages FROM conversations WHERE id = $1",
        [id],
      );
      return r.rowCount ? (r.rows[0].messages as ModelMessage[]) : null;
    },

    // One idempotent statement covers both create and update: generate the
    // id in the app (crypto.randomUUID()), then upsert.
    save: async (id, messages) => {
      await pool.query(
        `INSERT INTO conversations (id, messages)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET messages = $2::jsonb, updated_at = now()`,
        [id, JSON.stringify(messages)],
      );
    },
  };
}

// One process, one Map, nothing durable — see the module comment above.
function memoryStore(): ConversationStore {
  const rows = new Map<string, ModelMessage[]>();
  return {
    init: async () => {}, // nothing to provision: ready the moment it exists
    load: async (id) => rows.get(id) ?? null,
    save: async (id, messages) => {
      rows.set(id, messages);
    },
  };
}

const store: ConversationStore = config.classificationDbHost ? postgresStore() : memoryStore();

// Never await initStore() before listen() — the DB may not be reachable yet
// (classification-db provisions asynchronously). initStore() fires the
// schema init and returns immediately; ensureStore() is what every turn
// awaits, retrying until it succeeds.
let ready = false;
export function isStoreReady(): boolean {
  return ready;
}
export async function ensureStore(): Promise<void> {
  if (ready) return;
  // Both schemas live in the same database: the conversation store's own
  // table, and the classification log's — the business record has no
  // fallback, so its table must exist before any turn can complete.
  await Promise.all([store.init(), initClassifications()]);
  ready = true;
}
export function initStore(): void {
  ensureStore().catch((err) => {
    console.error("store not ready yet:", err);
  });
}

export function loadConversation(id: string): Promise<ModelMessage[] | null> {
  return store.load(id);
}

export function saveConversation(id: string, messages: ModelMessage[]): Promise<void> {
  return store.save(id, messages);
}
