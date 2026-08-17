# Global Top Group – Financial Management Dashboard

Finance uploads Excel workbooks or a ZIP of them; the system reads them,
recalculates every figure from the underlying records, compares the period with
the last one, and shows the result as an executive dashboard.

The governing rule is that **a new reporting round needs no code change**.
Project names, header spellings and workbook layouts are all configuration held
in the database, not literals in the engine.

---

## Getting started

```bash
npm install
npm run seed     # creates the database, seeds projects/templates and an admin
npm run dev      # http://localhost:3000
```

`npm run seed` prints a generated admin password once. Set your own with:

```bash
GTG_ADMIN_EMAIL=you@example.com GTG_ADMIN_PASSWORD='…' npm run seed
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build` / `npm start` | production build and server |
| `npm test` | unit and integration tests (90) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:reset` | delete the local database and uploads, then re-seed |

The database and uploaded originals live in `data/` and are git-ignored.
Override the location with `GTG_DATA_DIR`.

---

## Architecture

The four layers are kept strictly apart, so a change in one cannot silently
alter another:

```
Excel file
   │  workers/excel-parse.worker.mjs        ← isolated worker thread
   ▼
Raw imported data      src/lib/excel/       untouched grid, cells and formulas
   │  detect → map → normalize
   ▼
Normalized data        src/lib/normalize/   typed records, each with a source cell
   │  calculate
   ▼
Calculation logic      src/lib/calc/        KPIs, cash flow, reconciliation
   │
   ▼
Dashboard presentation src/app/, src/components/
```

### Import pipeline

`src/lib/import/pipeline.ts` runs: validate type → expand ZIP → read workbook →
detect project and sheets → apply mapping → normalize → (persist) calculate →
validate → snapshot.

Nothing reaches the financial tables until the user confirms the preview. The
staged originals are re-read at confirm time, so a mapping correction made in
the preview genuinely changes the imported data rather than only relabelling it.

**Source files are opened read-only and never written to.**

### Why parsing runs in a worker thread

The npm-published SheetJS build carries prototype-pollution and ReDoS
advisories with no published fix on npm (the fixed releases are only on the
vendor's own CDN, which is not reachable from this environment). Rather than
accept them, parsing runs in a throwaway worker:

* a separate V8 isolate has its own `Object.prototype`, so pollution cannot
  reach the server's realm;
* the parent applies a hard timeout and `terminate()`, so a pathological file
  cannot wedge the request thread;
* CPU-bound parsing stays off the main thread, which is what requirement 31
  asks for anyway.

ZIP expansion is bounded by entry count and uncompressed size, and archive
entry names are flattened so an archive cannot write outside its directory.

### Three-level mapping

Cell positions are never the only strategy (requirement 25). Strongest
evidence first:

1. **Manual override** — what the user chose in the import preview.
2. **Header/label detection** — `src/config/field-synonyms.ts` maps header text,
   English or Thai, to canonical fields. The header row is *found* by scoring,
   not assumed.
3. **Template hints** — `template_mappings` fills fields detection could not
   resolve. A template can never overrule the file itself.
4. **Cell addresses** — last resort, for known layouts only.

Sheets are classified from their name *and* their headers *and* which canonical
fields resolved, so a renamed sheet still classifies correctly and sheet
position is never an input.

### Dashboards

`/financial` is the executive landing page: KPI tiles flanking a net-profit-margin
dial, an income-versus-expense combo chart with budget-utilisation dials beside
it, and a cash line with the income statement beneath. Every tile opens its
formula and the records behind it.

The remaining pages — Executive Overview, Project, Receivable, BOQ, Cash Flow,
Ledger & Advances, Reconciliation and the Data Inspector — sit under the same
global filters, so a project chosen anywhere stays chosen everywhere.

Two figures are honestly out of reach of the source workbooks:

* **Budget** does not appear in any exported sheet, so the utilisation dials
  read from a budget entered under Settings → Budget. With none entered the
  dial says so rather than inventing a denominator.
* **Profit-and-loss lines** need income or expense records. A balance-sheet
  ledger has none, so those panels explain what to import instead of showing
  a misleading zero line.

A snapshot imported before a metric existed will not carry it. The dashboard
degrades to "not available" and points at Recalculate, which regenerates the
missing figures from the stored records without re-reading a file.

### Calculation

Every KPI is recomputed from normalized records. A cached Excel formula result
is never trusted as a figure — it is kept only so reconciliation can compare it
with ours. Each metric carries its formula, its inputs and the source cells
behind it, which is what makes "View calculation" and "Drill down" work without
a second code path.

Cash flow is a genuine running balance:

```
Month 1  closing = opening bank balance + net cash flow
Month n  closing = previous closing     + net cash flow
```

Percentage change returns **N/A** rather than dividing by zero.

### Reconciliation

Rules state what a figure should be from first principles and report the gap.
They never modify data. Bad input degrades rather than failing: a bad cell
becomes a warning, a bad sheet is skipped, and only an unreadable file fails —
that file alone.

---

## Supported inputs

The engine reads the shapes these companies actually produce:

* **General ledger** — the accounting system's "Posted and Unposted GL Report".
  The Thai company name in the preamble identifies the entity; the reporting
  period comes from the `Date : … - …` range, **not** the print timestamp; the
  `BF` line is the opening balance and the `Total A/C` / `Grand Total` footers
  are captured for reconciliation rather than imported as transactions.
* **Receivable** — long form (one row per receivable) and wide form (a column
  per category), including per-category received and outstanding columns.
* **Bank** — per-account tables and labelled summary layouts.
* **WIP**, **BOQ** (item lists and month-per-column matrices), **cash flow**,
  income and expense sheets.

Thai text is handled throughout: month names, Buddhist-era years (2569 → 2026),
`(1,234)` as negative, `฿` and thousands separators inside text cells.

Ledger detail is stored for the audit trail while a derived account-level
summary feeds the KPIs, so a ledger is never counted twice.

---

## Configuration, not code

| What | Where | Editable at runtime |
|---|---|---|
| Projects and their aliases | `projects`, `project_aliases` | Settings → Projects |
| Workbook templates | `template_mappings` | Settings → Template Mapping |
| Header spellings | `src/config/field-synonyms.ts` | code, but data-shaped |
| Sheet classification rules | `src/config/detection-rules.ts` | code, but data-shaped |
| Seed projects | `src/config/projects.default.ts` | first run only |

No project name is hard-coded in the engine — detection asks the registry.
Aliases are unique on a normalised key, so two projects can never claim the same
spelling and silently misroute data.

---

## Roles

| Role | Can |
|---|---|
| Admin | everything, including user management |
| Finance | upload, mapping, edit, recalculate |
| Management | view dashboards and export |
| Viewer | read only |

Enforced server-side on every route; the navigation filter is convenience only.

---

## Tests

```bash
npm test
```

90 tests covering text normalisation and alias resolution, header detection and
sheet classification, every normalizer, the KPI and cash-flow engines,
comparison arithmetic, reconciliation rules, the income statement and liquidity
ratios, budget utilisation and THB formatting.

`tests/samples.test.ts` runs the **real** client workbooks end to end when
`samples/` is present, and asserts that our independently computed closing
balances match the accounting system's own printed Grand Totals. Those files
contain live financial data and are git-ignored; the suite skips cleanly
without them.

---

## Deployment

```bash
export GTG_DOMAIN=finance.yourcompany.com
./deploy/deploy.sh
```

Deploys to Google Cloud as a single VM with the database on a persistent disk,
behind Caddy for automatic HTTPS. Cloud SQL was rejected on cost — it has no
free tier and is the expensive part of a Cloud Run design, while the compute is
nearly free either way. [`docs/DEPLOY.md`](docs/DEPLOY.md) sets out the
comparison, the region trade-off between cost and data residency, and what has
and has not been verified.

---

## Further reading

* [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploying to Google Cloud, and the cost reasoning
* [`docs/DATABASE.md`](docs/DATABASE.md) — schema and the PostgreSQL migration path
* [`docs/DESIGN.md`](docs/DESIGN.md) — the chart palette and its validation record
