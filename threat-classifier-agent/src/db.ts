// db.ts — the single Postgres connection this agent opens, shared by the
// conversation store (server-held memory, x-aep.memory.type: "server") and
// the classification log (the CLASSIFICATION business record). Both live in
// classification-db: it is the only postgres-cnpg dependency this component
// declares, so it is what backs both.
//
// pg.Pool does not connect eagerly, so constructing it here at module load
// is safe even when the component boots with these values unset (the
// component contract's "no required env vars at startup") — nothing is
// attempted against the database until the first query.
import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  host: config.classificationDbHost,
  port: Number(config.classificationDbPort ?? 5432),
  database: config.classificationDbName,
  user: config.classificationDbUser,
  password: config.classificationDbPassword,
});
