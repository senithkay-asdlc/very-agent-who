// classifications.ts — the CLASSIFICATION business record
// (specs/design/domain-model.md): one row per submitted sentence, pairing
// the exact text as received with the label this agent produced for it and
// when it was submitted. Rows are write-once — this module exposes no
// update or delete path, on purpose, ever.
import { pool } from "./db.js";

export type Label = "threatening" | "not threatening";

const INIT = `CREATE TABLE IF NOT EXISTS classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sentence text NOT NULL,
  label text NOT NULL CHECK (label IN ('threatening', 'not threatening')),
  submitted_at timestamptz NOT NULL DEFAULT now()
)`;

export function initClassifications(): Promise<void> {
  return pool.query(INIT).then(() => undefined);
}

// One INSERT, no ON CONFLICT, no UPDATE anywhere in this file — a
// classification record is created once and never revisited.
export async function recordClassification(sentence: string, label: Label): Promise<void> {
  await pool.query(
    "INSERT INTO classifications (sentence, label) VALUES ($1, $2)",
    [sentence, label],
  );
}
