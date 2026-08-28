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
  /* Optional account expiry, as YYYY-MM-DD. Past this date the account cannot
     sign in and existing sessions stop being accepted. NULL means no expiry. */
  expires_at    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  -- Which company this session is working in. Held server-side rather than in
  -- the cookie or the browser, so the scope of every query is decided by
  -- something the user cannot edit.
  active_company_id TEXT REFERENCES companies(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- Failed sign-in attempts, kept so the form can stop answering a guesser.
--
-- Recorded against the address that was typed and against the caller's own
-- address, because either one alone is easy to work around: a guesser who
-- varies the address defeats the first, and one behind a changing address
-- defeats the second.
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id           TEXT PRIMARY KEY,
  -- Either 'email:<lowercased address>' or 'client:<ip>'.
  identifier   TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sign_in_attempts
  ON sign_in_attempts(identifier, attempted_at);

-- Who changed what.
--
-- The import tables already name the person who ran an import, but a role
-- change, a grant, a company rename, a password reset and a rollback left
-- nothing behind at all. Written from the request, where the actor is known,
-- rather than from the repositories, which are also called by the seed and by
-- the command-line tools and have no actor to name.
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  -- The account is kept by id and by address: the id survives a rename, the
  -- address survives the account being deleted.
  actor_id    TEXT,
  actor_email TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  -- The company the actor was working in, where there was one.
  company_id  TEXT REFERENCES companies(id),
  -- What was done, as a stable key: 'user.create', 'import.rollback'.
  action      TEXT NOT NULL,
  -- What it was done to.
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  -- A short human sentence, and the changed fields as JSON where they help.
  summary     TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_company ON audit_log(company_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, at DESC);

-- ------------------------------------------------------------------ projects
-- ----------------------------------------------------------------- companies
-- A company owns projects; a project owns financial data. The two are separate
-- columns everywhere and never collapsed into one field, because a company
-- with two projects and a project that moves between companies both have to be
-- expressible.
CREATE TABLE IF NOT EXISTS companies (
  id           TEXT PRIMARY KEY,
  company_code TEXT NOT NULL UNIQUE,
  legal_name   TEXT NOT NULL,
  display_name TEXT NOT NULL,
  logo         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Which companies a user may see. Absence of a row is absence of access: the
-- selection screen lists what is granted here and nothing else, and every
-- company-scoped query is checked against it on the server. A user with no
-- rows sees no companies rather than all of them.
CREATE TABLE IF NOT EXISTS user_companies (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  company    TEXT,
  company_id TEXT REFERENCES companies(id),
  sort_order INTEGER NOT NULL DEFAULT 100,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- The index on company_id is created by the migration step, not here. On a
-- database that already has a projects table, CREATE TABLE IF NOT EXISTS is a
-- no-op and the column arrives via ALTER — so an index named here would run
-- against a column that does not exist yet and fail the whole schema.

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
  company_id  TEXT REFERENCES companies(id),
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
  company_id  TEXT REFERENCES companies(id),
  report_date TEXT NOT NULL,
  label       TEXT,
  -- Exactly one snapshot per COMPANY per report date is the "live" one;
  -- replacing an import flips this rather than deleting history.
  --
  -- The company is part of that rule, not decoration. Scoped by date alone,
  -- one company importing 20 August retired another company's 20 August, and
  -- a rollback then promoted whichever snapshot happened to be newest across
  -- the whole group.
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
  company_id     TEXT REFERENCES companies(id),
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
  company_id     TEXT REFERENCES companies(id),
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
  company_id     TEXT REFERENCES companies(id),
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
  company_id     TEXT REFERENCES companies(id),
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
  company_id     TEXT REFERENCES companies(id),
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

-- Accounts payable.
--
-- The liquidity ratios used to divide by certified-but-unpaid construction
-- plus pending bank payments, and called the result Accounts Payable. That is
-- a real obligation and it is not the company's payables: it says nothing
-- about a vendor invoice sitting unpaid, when it falls due, or how far past
-- due it already is.
CREATE TABLE IF NOT EXISTS payable_records (
  id              TEXT PRIMARY KEY,
  snapshot_id     TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id       TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  company_id      TEXT REFERENCES companies(id),
  report_date     TEXT NOT NULL,
  vendor          TEXT,
  invoice_no      TEXT,
  description     TEXT,
  category        TEXT,
  /* When the invoice was raised, and when it falls due. */
  invoice_date    TEXT,
  due_date        TEXT,
  invoice_amount  NUMERIC NOT NULL DEFAULT 0,
  paid_amount     NUMERIC NOT NULL DEFAULT 0,
  /* What the file itself states is left. Recomputed rather than trusted, and
     compared with the recomputation as a reconciliation check. */
  stated_outstanding NUMERIC,
  source_ref_id   TEXT REFERENCES source_references(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payable_snapshot ON payable_records(snapshot_id, project_id);
CREATE INDEX IF NOT EXISTS idx_payable_vendor ON payable_records(snapshot_id, vendor);
CREATE INDEX IF NOT EXISTS idx_payable_due ON payable_records(snapshot_id, due_date);

CREATE TABLE IF NOT EXISTS wip_records (
  id              TEXT PRIMARY KEY,
  snapshot_id     TEXT NOT NULL REFERENCES financial_snapshots(id) ON DELETE CASCADE,
  import_id       TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  company_id     TEXT REFERENCES companies(id),
  report_date     TEXT NOT NULL,
  account_code    TEXT,
  account_name    TEXT,
  current_period  NUMERIC NOT NULL DEFAULT 0,
  ytd             NUMERIC NOT NULL DEFAULT 0,
  advance_payment NUMERIC NOT NULL DEFAULT 0,
  /* Closing balance printed by the source system, kept only so reconciliation
     can compare it with our own recomputed figure. */
  stated_closing  NUMERIC,
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
  company_id     TEXT REFERENCES companies(id),
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
  company_id     TEXT REFERENCES companies(id),
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
  company_id     TEXT REFERENCES companies(id),
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
  /* NULL means a shipped default, shared by every company. A company's own
     template carries its id and is invisible to the others. */
  company_id        TEXT REFERENCES companies(id) ON DELETE CASCADE,
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

-- One company enabling or disabling a SHARED template, without touching it.
--
-- The shipped defaults belong to no company, so a company that disabled one
-- would disable it for all six. This records the choice per company instead;
-- a company's own templates are switched on the template row itself.
CREATE TABLE IF NOT EXISTS template_company_state (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES template_mappings(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  active      INTEGER NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (template_id, company_id)
);

-- Customer Card reports that have been produced, so Finance can find one
-- again without re-running it against a card they may no longer have.
--
-- The workbook itself stays on disk: it runs to megabytes and putting it in a
-- column would make every listing query drag it along. The row records where
-- it is, what it was made from, and what it said.
CREATE TABLE IF NOT EXISTS customer_card_reports (
  id                TEXT PRIMARY KEY,
  /* Not nullable. A report belongs to the company it was run for, and one
     without a company would be visible to all of them. */
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_label     TEXT NOT NULL,
  report_date       TEXT NOT NULL,
  completion_date   TEXT NOT NULL,
  max_uplift        NUMERIC NOT NULL,
  /* What it was made from, so a figure can be traced back to a file. */
  source_file_name  TEXT NOT NULL,
  source_hash       TEXT NOT NULL,
  source_rows       INTEGER NOT NULL,
  sheet_name        TEXT,
  header_row        INTEGER,
  /* Path under the data directory. Never inside the repository or an image. */
  stored_path       TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  contracts         INTEGER NOT NULL,
  units             INTEGER NOT NULL,
  total_sale_price  NUMERIC NOT NULL,
  total_expected    NUMERIC NOT NULL,
  total_plan        NUMERIC NOT NULL,
  total_paid        NUMERIC NOT NULL,
  total_outstanding NUMERIC NOT NULL,
  total_interest    NUMERIC NOT NULL,
  ok_count          INTEGER NOT NULL,
  check_count       INTEGER NOT NULL,
  error_count       INTEGER NOT NULL,
  /* The per-unit reconciliation and the issues, as produced. Kept so the
     detail view reads what the run said rather than re-deriving it from a
     source file that may since have changed. */
  checks_json       TEXT NOT NULL,
  issues_json       TEXT NOT NULL,
  confirm_json      TEXT NOT NULL,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_reports_company
  ON customer_card_reports(company_id, created_at DESC);

-- Staged parse results awaiting user confirmation (requirement 14).
CREATE TABLE IF NOT EXISTS import_previews (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  /* The company the files were parsed FOR. Confirming under a different one is
     refused: the preview on screen names a company, and the rows must land
     where that screen said they would. */
  company_id   TEXT REFERENCES companies(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_previews_expiry ON import_previews(expires_at);

-- Budget figures entered by Finance. There is no budget in the source
-- workbooks, so the budget-utilisation dials read from here; without a row the
-- dials say so rather than inventing a denominator.
-- The two figures a percentage-of-completion calculation needs and no
-- spreadsheet export carries: what the whole project is expected to sell for,
-- and what it is expected to cost.
--
-- Revenue recognised is contracted sales times completion. The cost recognised
-- against it is only the cost of the units actually sold, and the share of the
-- project that has been sold cannot be worked out from the sales ledger alone
-- — it needs the project's total sale value to divide by. Without these the
-- system reports recognised revenue and says gross profit is not calculable,
-- rather than reporting a margin it cannot support.
CREATE TABLE IF NOT EXISTS project_financials (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id),
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  /* Expected sale value of every unit in the project, sold or not. */
  total_sale_value   NUMERIC,
  /* Approved cost budget for the whole project, and the current revision. */
  cost_budget        NUMERIC,
  revised_cost_budget NUMERIC,
  /* Cost committed by signed contract but not yet incurred. */
  committed_cost     NUMERIC,
  updated_by         TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_financials
  ON project_financials(company_id, project_id);

CREATE TABLE IF NOT EXISTS budgets (
  id             TEXT PRIMARY KEY,
  /* YYYY-MM. A NULL project_id means every project OF THIS COMPANY — the
     company is never null on a budget entered through the application. */
  month          TEXT NOT NULL,
  company_id     TEXT REFERENCES companies(id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
  income_budget  NUMERIC,
  expense_budget NUMERIC,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
/* The unique index on (company, month, project) is created in applyMigrations:
   it names company_id, which an upgraded database only gains there. */

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
