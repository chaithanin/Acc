-- ============================================================================
-- Global Top Group – Financial Management Dashboard
-- Schema v1
--
-- Portability notes (SQLite today, PostgreSQL later):
--   * All primary keys are application-generated UUID TEXT — no AUTOINCREMENT
--     or SERIAL, so the DDL moves across engines unchanged.
--   * Timestamps are ISO-8601 TEXT in UTC.
--   * Booleans are INTEGER 0/1.
--   * Money is NUMERIC. On PostgreSQL switch this to NUMERIC(20,4) for exact
--     decimal arithmetic; SQLite treats it as numeric affinity.
--
-- Design rule (requirement 17): summary numbers are NEVER the only thing
-- stored. Raw rows, normalized records and calculated metrics are separate
-- layers so every figure can be recalculated without re-uploading a file.
-- ============================================================================

-- ------------------------------------------------------------------ security
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'finance', 'management', 'viewer')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- ------------------------------------------------------------------ projects
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  company    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Alias table is what keeps project naming out of the code (requirement 2).
CREATE TABLE IF NOT EXISTS project_aliases (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  -- Normalised match key (lowercased, punctuation stripped). Unique so two
  -- projects can never claim the same spelling.
  alias_key  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id);

-- ------------------------------------------------------------------- imports
CREATE TABLE IF NOT EXISTS imports (
  id            TEXT PRIMARY KEY,
  report_date   TEXT NOT NULL,
  label         TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rolled_back')),
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  file_count    INTEGER NOT NULL DEFAULT 0,
  row_count     INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  -- Set when this import replaced an earlier snapshot for the same report date.
  replaces_import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_imports_report_date ON imports(report_date);
CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);

CREATE TABLE IF NOT EXISTS import_files (
  id             TEXT PRIMARY KEY,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  file_name      TEXT NOT NULL,
  original_name  TEXT NOT NULL,
  -- Path of the untouched original. Source files are read-only, always.
  stored_path    TEXT,
  file_hash      TEXT NOT NULL,
  file_size      INTEGER NOT NULL DEFAULT 0,
  file_type      TEXT NOT NULL,
  -- Name of the ZIP this file was extracted from, when applicable.
  container_file TEXT,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  detected_project_label TEXT,
  report_type    TEXT,
  report_date    TEXT,
  sheet_count    INTEGER NOT NULL DEFAULT 0,
  row_count      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_files_import ON import_files(import_id);
CREATE INDEX IF NOT EXISTS idx_import_files_hash ON import_files(file_hash);

-- Every detected sheet, kept for the Data Inspector (requirement 34).
CREATE TABLE IF NOT EXISTS sheet_detections (
  id              TEXT PRIMARY KEY,
  import_id       TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  import_file_id  TEXT NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  sheet_name      TEXT NOT NULL,
  sheet_index     INTEGER NOT NULL,
  report_type     TEXT NOT NULL,
  confidence      NUMERIC NOT NULL DEFAULT 0,
  header_row      INTEGER,
  column_map_json TEXT,
  detected_headers_json TEXT,
  scores_json     TEXT,
  template_id     TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0,
  parsed_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sheet_detections_file ON sheet_detections(import_file_id);

-- Raw grid as read from the workbook — the un-interpreted layer.
CREATE TABLE IF NOT EXISTS raw_rows (
  id             TEXT PRIMARY KEY,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  import_file_id TEXT NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  sheet_name     TEXT NOT NULL,
  row_number     INTEGER NOT NULL,
  cells_json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_rows_file_sheet ON raw_rows(import_file_id, sheet_name);

-- --------------------------------------------------------------- traceability
-- One row per distinct pointer back into a source workbook (requirement 18).
CREATE TABLE IF NOT EXISTS source_references (
  id             TEXT PRIMARY KEY,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  import_file_id TEXT REFERENCES import_files(id) ON DELETE CASCADE,
  source_file    TEXT NOT NULL,
  source_sheet   TEXT,
  source_row     INTEGER,
  source_col     INTEGER,
  source_cell    TEXT,
  /* Formula text when the value came from one, so reviewers can see that the
     imported number was Excel-calculated rather than typed. */
  source_formula TEXT,
  raw_value      TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_refs_import ON source_references(import_id);
CREATE INDEX IF NOT EXISTS idx_source_refs_file ON source_references(import_file_id);

-- --------------------------------------------------------------- snapshots
CREATE TABLE IF NOT EXISTS financial_snapshots (
  id          TEXT PRIMARY KEY,
  import_id   TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  label       TEXT,
  -- Exactly one snapshot per report date is the "live" one; replacing an
  -- import flips this rather than deleting history.
  is_current  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_report_date ON financial_snapshots(report_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_current ON financial_snapshots(is_current);

-- ------------------------------------------------------- normalized records
-- Every fact table carries snapshot_id + project_id + report_date so the
-- dashboard can filter without joining, and source_ref_id so every number
-- drills back to a cell.

CREATE TABLE IF NOT EXISTS bank_balances (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date    TEXT NOT NULL,
  bank_name      TEXT,
  account_no     TEXT,
  current_amount NUMERIC NOT NULL DEFAULT 0,
  pending_expense NUMERIC NOT NULL DEFAULT 0,
  source_ref_id  TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_snapshot ON bank_balances(snapshot_id, project_id);

CREATE TABLE IF NOT EXISTS income_records (
  id                 TEXT PRIMARY KEY,
  snapshot_id        TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id          TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date        TEXT NOT NULL,
  category           TEXT NOT NULL,
  description        TEXT,
  month              TEXT,
  contractual_amount NUMERIC NOT NULL DEFAULT 0,
  received_amount    NUMERIC NOT NULL DEFAULT 0,
  accrued_amount     NUMERIC NOT NULL DEFAULT 0,
  is_forecast        INTEGER NOT NULL DEFAULT 0,
  source_ref_id      TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_income_snapshot ON income_records(snapshot_id, project_id);
CREATE INDEX IF NOT EXISTS idx_income_category ON income_records(snapshot_id, category);

CREATE TABLE IF NOT EXISTS expense_records (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date    TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT,
  month          TEXT,
  amount         NUMERIC NOT NULL DEFAULT 0,
  paid_amount    NUMERIC NOT NULL DEFAULT 0,
  pending_amount NUMERIC NOT NULL DEFAULT 0,
  is_forecast    INTEGER NOT NULL DEFAULT 0,
  source_ref_id  TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_snapshot ON expense_records(snapshot_id, project_id);
CREATE INDEX IF NOT EXISTS idx_expense_category ON expense_records(snapshot_id, category);

CREATE TABLE IF NOT EXISTS receivable_records (
  id                 TEXT PRIMARY KEY,
  snapshot_id        TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id          TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date        TEXT NOT NULL,
  category           TEXT NOT NULL,
  customer           TEXT,
  unit               TEXT,
  contractual_amount NUMERIC NOT NULL DEFAULT 0,
  receive_amount     NUMERIC NOT NULL DEFAULT 0,
  /* As stated in the file. May disagree with contractual - receive, which is
     exactly what the reconciliation report surfaces. */
  accrue_amount      NUMERIC NOT NULL DEFAULT 0,
  /* Recomputed by our own engine, never trusted from the sheet. */
  computed_accrue    NUMERIC NOT NULL DEFAULT 0,
  due_date           TEXT,
  source_ref_id      TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_receivable_snapshot ON receivable_records(snapshot_id, project_id);
CREATE INDEX IF NOT EXISTS idx_receivable_category ON receivable_records(snapshot_id, category);

CREATE TABLE IF NOT EXISTS boq_records (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date    TEXT NOT NULL,
  account_code   TEXT,
  description    TEXT,
  contractor     TEXT,
  cost_category  TEXT,
  month          TEXT,
  boq_amount     NUMERIC NOT NULL DEFAULT 0,
  boq_to_date    NUMERIC NOT NULL DEFAULT 0,
  paid_amount    NUMERIC NOT NULL DEFAULT 0,
  pending_amount NUMERIC NOT NULL DEFAULT 0,
  source_ref_id  TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_boq_snapshot ON boq_records(snapshot_id, project_id);
CREATE INDEX IF NOT EXISTS idx_boq_month ON boq_records(snapshot_id, month);

CREATE TABLE IF NOT EXISTS wip_records (
  id              TEXT PRIMARY KEY,
  snapshot_id     TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id       TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date     TEXT NOT NULL,
  account_code    TEXT,
  account_name    TEXT,
  current_period  NUMERIC NOT NULL DEFAULT 0,
  ytd             NUMERIC NOT NULL DEFAULT 0,
  advance_payment NUMERIC NOT NULL DEFAULT 0,
  source_ref_id   TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_wip_snapshot ON wip_records(snapshot_id, project_id);

-- Transaction-level general-ledger detail. Kept for the audit trail and
-- drill-down; the KPI sums read the account-level rows in wip_records instead,
-- so a ledger is never counted twice.
CREATE TABLE IF NOT EXISTS gl_entries (
  id            TEXT PRIMARY KEY,
  snapshot_id   TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id     TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date   TEXT NOT NULL,
  account_code  TEXT,
  account_name  TEXT,
  entry_date    TEXT,
  voucher_no    TEXT,
  vendor        TEXT,
  description   TEXT,
  cost_code     TEXT,
  module        TEXT,
  job           TEXT,
  debit         NUMERIC NOT NULL DEFAULT 0,
  credit        NUMERIC NOT NULL DEFAULT 0,
  balance       NUMERIC,
  is_opening    INTEGER NOT NULL DEFAULT 0,
  source_ref_id TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_gl_snapshot ON gl_entries(snapshot_id, project_id);
CREATE INDEX IF NOT EXISTS idx_gl_account ON gl_entries(snapshot_id, account_code);
CREATE INDEX IF NOT EXISTS idx_gl_date ON gl_entries(snapshot_id, entry_date);

CREATE TABLE IF NOT EXISTS cashflow_forecasts (
  id               TEXT PRIMARY KEY,
  snapshot_id      TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id        TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
  report_date      TEXT NOT NULL,
  month            TEXT NOT NULL,
  opening_balance  NUMERIC,
  expected_income  NUMERIC NOT NULL DEFAULT 0,
  expected_expense NUMERIC NOT NULL DEFAULT 0,
  net_cashflow     NUMERIC,
  closing_balance  NUMERIC,
  /* 1 when the running balance was derived by our engine rather than read
     from the sheet. */
  is_computed      INTEGER NOT NULL DEFAULT 1,
  source_ref_id    TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cashflow_snapshot ON cashflow_forecasts(snapshot_id, project_id, month);

-- ------------------------------------------------------------- calculations
CREATE TABLE IF NOT EXISTS calculated_metrics (
  id           TEXT PRIMARY KEY,
  snapshot_id  TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id    TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  /* NULL project_id means the group-wide roll-up. */
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  report_date  TEXT NOT NULL,
  metric_key   TEXT NOT NULL,
  label        TEXT NOT NULL,
  section      TEXT NOT NULL,
  value        NUMERIC,
  unit         TEXT NOT NULL DEFAULT 'THB',
  /* Human-readable formula + the inputs it consumed, so any KPI can show its
     own derivation on screen (requirement 27). */
  formula      TEXT,
  inputs_json  TEXT,
  source_ref_ids_json TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_lookup ON calculated_metrics(snapshot_id, project_id, metric_key);
CREATE INDEX IF NOT EXISTS idx_metrics_key ON calculated_metrics(metric_key);

CREATE TABLE IF NOT EXISTS validation_results (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  rule_key       TEXT NOT NULL,
  label          TEXT NOT NULL,
  scope          TEXT NOT NULL,
  expected_value NUMERIC,
  imported_value NUMERIC,
  difference     NUMERIC,
  status         TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'error', 'skipped')),
  severity       TEXT NOT NULL DEFAULT 'info',
  message        TEXT,
  source_ref_id  TEXT REFERENCES source_references(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_validation_snapshot ON validation_results(snapshot_id, status);

-- Non-fatal problems found while parsing (requirement 3 & 28). A bad cell
-- produces a row here instead of failing the import.
CREATE TABLE IF NOT EXISTS import_issues (
  id             TEXT PRIMARY KEY,
  import_id      TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  import_file_id TEXT REFERENCES import_files(id) ON DELETE CASCADE,
  severity       TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  code           TEXT NOT NULL,
  message        TEXT NOT NULL,
  source_file    TEXT,
  source_sheet   TEXT,
  source_row     INTEGER,
  source_cell    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_import ON import_issues(import_id, severity);

-- --------------------------------------------------------- template mapping
-- Known layouts auto-map (requirement 26); unknown ones fall through to the
-- manual mapping UI.
CREATE TABLE IF NOT EXISTS template_mappings (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  report_type       TEXT NOT NULL,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  description       TEXT,
  /* { fileNamePatterns, sheetNamePatterns, requiredHeaders } */
  match_rules_json  TEXT NOT NULL,
  /* { canonicalField: headerLabel } column hints */
  column_map_json   TEXT,
  /* { canonicalField: "Sheet!A1" } — fallback only, never the sole strategy. */
  cell_map_json     TEXT,
  priority          INTEGER NOT NULL DEFAULT 100,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Staged parse results awaiting user confirmation (requirement 14).
CREATE TABLE IF NOT EXISTS import_previews (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_previews_expiry ON import_previews(expires_at);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
