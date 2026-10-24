-- RupeeTrail: one row per group. The ledger document is JSON so a single
-- compare-and-set write keeps expenses, payments and members consistent.
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS groups_code_idx ON groups (code);
