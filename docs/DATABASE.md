# Database

SQLite today, PostgreSQL when the deployment needs it. The schema is written so
that move is a driver change rather than a redesign.

Schema: [`src/lib/db/schema.sql`](../src/lib/db/schema.sql).

## Layers

Summary numbers are never the only thing stored (requirement 17). Three layers
are persisted independently:

| Layer | Tables | Why it exists |
|---|---|---|
| Raw | `raw_rows`, `sheet_detections` | what the file actually said, for the Data Inspector |
| Normalized | `bank_balances`, `receivable_records`, `income_records`, `expense_records`, `boq_records`, `wip_records`, `gl_entries`, `cashflow_forecasts` | typed records the calculation engine consumes |
| Derived | `calculated_metrics`, `validation_results` | KPI values with their formula and inputs |

Because the normalized layer is stored, **Recalculate** re-runs the calculation
and reconciliation engines without re-reading a single file.

`raw_rows` is sampled at 500 rows per sheet — enough to inspect a parse, not
enough to double the database. The originals remain on disk as the record of
truth.

## Traceability

`source_references` holds one row per distinct pointer into a workbook: file,
sheet, row, column, cell address, the formula when the cell had one, and the
displayed text. Every fact table carries `source_ref_id`, so any figure on any
dashboard resolves to the cell it came from.

## Snapshots

One `financial_snapshots` row per import. Exactly one snapshot per report date
carries `is_current = 1`; importing again for the same date retires the previous
one rather than deleting it, so history stays intact and any earlier period can
still be selected for comparison.

Rolling back deletes the snapshot (records cascade), marks the import
`rolled_back` and promotes the most recent surviving snapshot for that date.
The uploaded originals are kept either way.

## Conventions

| Concern | Choice | Reason |
|---|---|---|
| Primary keys | application-generated UUID `TEXT` | no `AUTOINCREMENT` / `SERIAL` divergence |
| Timestamps | ISO-8601 `TEXT`, UTC | identical across engines |
| Booleans | `INTEGER` 0/1 | SQLite has no boolean type |
| Money | `NUMERIC` | see below |
| JSON columns | `TEXT`, read through `parseJson` | never throws on bad data |

## Moving to PostgreSQL

1. **Money.** Change `NUMERIC` to `NUMERIC(20,4)`. SQLite treats `NUMERIC` as
   an affinity and stores doubles; PostgreSQL will then give exact decimal
   arithmetic. The engine already rounds every total to two decimals
   (`round2` in `src/lib/calc/aggregate.ts`), so behaviour will not shift —
   it only becomes exact rather than exact-enough.
2. **Booleans.** Either keep `INTEGER` columns, or switch to `BOOLEAN` and
   change `toDbBool` / `fromDbBool` in `src/lib/db/index.ts`. Those two
   functions are the only place the convention is expressed.
3. **Driver.** Replace `src/lib/db/index.ts` and the repositories under
   `src/lib/db/repositories/`. Nothing outside that directory issues SQL, so
   the rest of the codebase is untouched. The queries are ordinary ANSI SQL
   with `?` placeholders; the main dialect edits are `?` → `$n` and dropping
   the `PRAGMA` calls.
4. **Concurrency.** The SQLite connection uses WAL and a busy timeout because
   it is single-writer. PostgreSQL needs neither; the `transaction()` helper
   keeps the same shape.

`getDb()` applies `schema.sql` on every start and every statement is
`CREATE TABLE IF NOT EXISTS`, so the file doubles as the initial migration.
Once there is production data to preserve, add a numbered migration directory
and record the applied version in `schema_meta`, which exists for that purpose.
