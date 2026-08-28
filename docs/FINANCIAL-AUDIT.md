# Global Top Group Financial Dashboard — financial systems audit

_28 August 2026 · 296 live checks · 274 unit tests · 30 isolation checks_

---

## Section A — Executive summary

**Overall health.** The machinery is sound and the accounting on top of it is
not finished. Every figure the dashboard shows can be traced to the cell of the
spreadsheet it came from, every drill-down now foots to the tile it was opened
from, and no company can see another's records. Against that, three of the
figures a director would read first — Revenue, Net Profit and budget
utilisation — are computed by comparing a multi-year contract balance with a
single month of cost, and the group this dashboard is named for cannot be seen
as a group at all.

**Critical financial risks.**

1. **"Total Income" is booking value, not revenue.** It is the contracted value
   of everything ever sold, and it is subtracted from one period's construction
   cost to produce Gross Profit. On the audit dataset this yields a net margin
   of **83.6%**. No property developer earns that. Any decision taken on the
   profit line is taken on a figure that has no accounting meaning.
2. **Budget utilisation compares a month with a lifetime.** The August income
   budget is divided into the cumulative contracted balance. With the real SUN9
   card — ฿943m contracted — a ฿5m monthly budget reads as 18,873% utilised.
3. **The same contract can be counted twice.** A receivable export and a sales
   export describing the same contracts are both ordinary monthly files, both
   are accepted, and their contractual amounts are added together. Nothing
   compares them. Demonstrated: ฿24.5m became ฿49.0m with every validation rule
   still green.

**Data integrity risks.** Low. No orphan rows, no duplicate aliases or emails,
one live snapshot per company per report date, clean `foreign_key_check` and
`integrity_check`, and every money KPI cites the cells behind it. Duplicate
control is at **file** level (hash, or report-date + type + project); there is
no transaction-level key, so a contract repeated inside one file is imported
twice.

**Consolidation risks.** The group view does not exist. Each company is a
separate snapshot behind a company chooser, and no page, API or table ever
holds more than one. There is also no way to mark a transaction as being with
another group company, so if a group total were built tomorrow, an
intercompany loan or a management fee would be counted in full on both sides.

**Security risks.** Low, and lower than at the last audit. Sign-in is now rate
limited, sessions are opaque and HttpOnly/Secure/SameSite, permissions were
verified across 76 page checks and 15 API checks, and every mutating action is
recorded against a named person. Not present: multi-factor authentication, and
any approval step between making a change and it taking effect.

**Management reporting risks.** The report date is shown, but nothing warns
that it is old — a dashboard reading March figures in August looks identical to
one reading August. There is no receivables ageing and no overdue balance, so
the question "who owes us money that is late" cannot be answered from this
system even though every due date is captured.

**Production recommendation.** Fit for per-company cash, receivables and
construction monitoring today. Not yet fit as the group's profit-and-loss or
consolidation platform. See the final decision.

---

## Section B — KPI inventory

39 KPIs. A test asserts that the definition registry and the calculation engine
name exactly the same set, so neither can gain a metric the other has not.
Status below is the audit's, not the code's.

| KPI | Definition | Source | Calculation | Status |
|---|---|---|---|---|
| bank_current_amount | Money in the bank on the report date | Bank sheets | SUM(current) | ✅ verified |
| pending_expense | Committed, not yet paid | Bank sheets + expense records | SUM both | ✅ verified |
| available_cash | Spendable without breaking a commitment | Derived | bank − pending | ✅ verified |
| total_contractual_income | Value of everything sold | Receivable + income records | SUM(contractual) | ⚠️ booking value, labelled Income |
| received_income | Collected against contracts | Both ledgers | SUM(received) | ✅ verified |
| accrued_income | Contracted, not collected | Derived | contractual − received | ✅ verified |
| expected_future_income | Collections after the report date | Forecast rows, else accrued | fallback stated in formula | ⚠️ fallback is not a forecast |
| boq_total / to_date / paid | Construction contract, certified, paid | BOQ records | SUM each | ✅ verified |
| boq_outstanding | Certified and unpaid | Derived | to_date − paid | ✅ verified |
| remaining_boq | Still to spend | Derived | total − paid | ✅ verified |
| wip_ytd | Work in progress, YTD | WIP records | SUM(ytd) | ✅ verified |
| total_expense | Everything spent | Expense records | SUM(amount) | ✅ verified |
| other_expense | Non-construction spend | Derived | total − construction | ✅ verified |
| cost_of_goods_sold | Direct cost of building | Expense: construction/contractor/material | SUM | ⚠️ period cost against lifetime revenue |
| operating_expenses | Running the business | Derived | total − COGS − tax | ✅ verified |
| taxes | Tax charged | Expense: tax category | SUM | ✅ verified |
| total_future_expense | Committed, still to pay | Forecast rows, else remaining BOQ + pending | fallback stated | ⚠️ fallback |
| current_cash / forecast_cash / lowest_forecast_cash | Projection opening, closing, worst month | Cash-flow rows | running balance | ⚠️ flat without forecast rows |
| cash_shortfall / required_funding | How far below zero, and the facility needed | Derived from the projection | — | ⚠️ inherits the above |
| reservation / contract / down_payment / transfer_outstanding | Uncollected by category | Receivable records | contractual − received | ✅ verified, buckets foot to total |
| total_receivable_outstanding | Everything sold and uncollected | Receivable records | SUM(contractual − received) | ✅ verified |
| total_outstanding_expense | Owed and due | Derived | BOQ outstanding + pending | ⚠️ construction payables only |
| net_financial_position | Cash terms if everything settled | Derived | cash + accrued − outstanding | ✅ arithmetic verified |
| advance_outstanding | Advances not recovered | WIP / ledger | SUM(advance) | ✅ verified |
| gl_entry_count | Completeness check | GL records | COUNT | ✅ verified |
| gross_profit | Income less direct cost | Derived | income − COGS | ❌ mismatched periods |
| operating_profit | EBIT | Derived | gross − opex | ❌ inherits |
| net_profit | After everything | Derived | EBIT − tax | ❌ inherits |
| net_profit_margin | Share of income kept | Derived | net ÷ income × 100 | ❌ inherits; null, never 0%, when income is 0 |
| quick_ratio | Near-cash against what is owed | Derived | (cash + AR) ÷ outstanding expense | ⚠️ denominator is a construction proxy |
| current_ratio | Current assets against what is owed | Derived | + advances + WIP | ⚠️ same |

**Not present:** AR ageing, overdue balance, AP, AP ageing, vendor balances,
inventory units, contract value net of discount, recognised revenue, loans,
finance cost, debt position, tax by type, forecast versus actual, group
consolidation, intercompany elimination, currency and exchange rate.

---

## Section C — System inventory

| Module | Working | Partial | Broken | Missing |
|---|---|---|---|---|
| Authentication & session | ✅ | | | MFA, SSO |
| Roles & permissions (4 roles) | ✅ | | | field-level, cost-centre scoping |
| Company master | ✅ | | | no way to add a company from the UI |
| Project master & aliases | ✅ | | | |
| Business unit / department / cost centre | | | | ❌ not modelled |
| Chart of accounts | | GL account code + name captured | | ❌ no mapping to statement categories |
| Import & ETL | ✅ | | | |
| Duplicate control | | file level | | ❌ transaction level |
| Import audit log | ✅ | | | |
| Snapshots & rollback | ✅ | | | |
| Bank & cash | ✅ | | | bank reconciliation |
| Receivables | ✅ | | | ❌ ageing, overdue |
| Payables | | BOQ payable proxy | | ❌ vendor AP, ageing |
| Expenses | ✅ | | | CAPEX/OPEX split |
| BOQ / project cost | ✅ | | | committed cost |
| WIP | ✅ | | | |
| Budget | | monthly income & expense | ❌ variance period mismatch | commitments, revised budget |
| Cash-flow projection | | with forecast rows | | ❌ classification (operating/investing/financing) |
| P&L | | arithmetic chains | ❌ revenue definition | |
| Balance sheet | | | | ❌ not implemented |
| Project profitability | | | | ❌ not implemented |
| Consolidation | | | | ❌ not implemented |
| Intercompany | | | | ❌ not implemented |
| Currency | | | | ❌ THB assumed |
| Drill-down | ✅ 25 KPIs | 4 composites by formula | | |
| Customer Card report | ✅ | | | |
| Activity log | ✅ | | | |
| Export | ✅ permissioned | | | export not itself logged |
| Alerts | | | | ❌ not implemented |
| Stale-data warning | | date shown | | ❌ no SLA check |

---

## Section D — Financial reconciliation

Run live against the standalone build. "Dashboard" is the stored KPI, "Source"
is SQL straight over the records, and the drill-down API was checked against
both.

| Metric | Dashboard | Source | Difference | Status |
|---|---:|---:|---:|---|
| Bank current amount | 1,500,000.00 | 1,500,000.00 | 0.00 | ✅ |
| Pending expense | 150,000.00 | 150,000.00 | 0.00 | ✅ (was 50,000 short in the drill-down; fixed) |
| Available cash | 1,350,000.00 | 1,350,000.00 | 0.00 | ✅ (drill-down was 50,000 over; fixed) |
| Total contractual income | 1,500,000.00 | 1,500,000.00 | 0.00 | ✅ (drill-down was 300,000 short; fixed) |
| Received income | reconciles | reconciles | 0.00 | ✅ |
| Accrued income | reconciles | reconciles | 0.00 | ✅ |
| Receivable outstanding | reconciles | reconciles | 0.00 | ✅ |
| Receivable by category (×4) | reconciles | reconciles | 0.00 | ✅ buckets foot to total |
| BOQ total / to date / paid / outstanding / remaining | reconciles | reconciles | 0.00 | ✅ |
| Total expense | reconciles | reconciles | 0.00 | ✅ |
| Cost of sales / operating expenses / tax | reconciles | reconciles | 0.00 | ✅ |
| Total outstanding expense | reconciles | reconciles | 0.00 | ✅ |
| WIP YTD / advances | reconciles | reconciles | 0.00 | ✅ |
| Gross / operating / net profit, net position | composite | — | — | ⚠️ explained by stated formula, not by records |

**All 25 record-backed KPIs foot to their drill-down to the satang.** The four
composites are made of other KPIs rather than of records; each carries its
formula and the inputs that fed it, and the audit checks that it does.

Separately, on the real client file: the Customer Card report reconciled
**exactly** to the card's own total line — plan ฿943,659,676.63, paid
฿625,557,219.24 — across 439 contracts and 11,995 rows.

---

## Section E — Company reconciliation

Six companies are configured, one per project.

| Company (as configured) | Project | Revenue | Cash | AR | AP | Expense | Status |
|---|---|---|---|---|---|---|---|
| บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด | HAMONIA | per snapshot | per snapshot | per snapshot | n/a | per snapshot | ✅ isolated |
| บริษัท มาริน่า โกลเด้น เบย์ วิคทอเรีย จำกัด | MARINA_VTR | ” | ” | ” | n/a | ” | ✅ isolated |
| บริษัท มาริน่า โกลเด้น เบย์ เอลย่า จำกัด | MARINA_ELYA | ” | ” | ” | n/a | ” | ✅ isolated |
| บริษัท มาริน่า โกลเด้น เบย์ เจนิวา จำกัด | MARINA_GENEVA | ” | ” | ” | n/a | ” | ✅ isolated |
| บริษัท ไชยธนินทร์ จำกัด | CHTN | ” | ” | ” | n/a | ” | ✅ isolated |
| บริษัท โกลบอล ท็อป กรุ๊ป จำกัด | GTG | ” | ” | ” | n/a | ” | ✅ isolated |
| **GROUP** | — | ❌ | ❌ | ❌ | ❌ | ❌ | **not produced anywhere** |

Isolation was proved adversarially: every read fired with another company's
snapshot, import and project id returns nothing, across 30 endpoints.

**Two naming discrepancies to settle with the company secretary.** The list
supplied for this audit names *มารีน่า โกลเด้น เบย์ เอสอาร์*, and the system
carries *มาริน่า โกลเด้น เบย์ เอลย่า*. The transliterations also differ
throughout (มารีน่า/มาริน่า, วิกตอเรีย/วิคทอเรีย, เจนีวา/เจนิวา). A dashboard
used for management reporting should carry the registered legal name exactly.

---

## Section F — Project financial audit

| Project | Sales | Collection | AR | Cost | Budget | Variance | Status |
|---|---|---|---|---|---|---|---|
| Any project | contracted value | received | contractual − received | BOQ + expense | monthly income/expense | ❌ period mismatch | ⚠️ |

Per-project figures are produced for every project in a snapshot and reconcile
the same way as the company roll-up. What is **not** produced for a project:
revenue recognised, gross profit, margin, cash position, committed cost,
inventory units, or a project-versus-project comparison. Section 46 of the
brief asks for all of these; the dashboard answers sales, collections,
outstanding, cost and budget only.

---

## Section G — Bug register

| ID | Priority | Module | Issue | Variance / risk | Root cause | Fix | Status |
|---|---|---|---|---|---|---|---|
| FIN-01 | **P1** | P&L | "Total Income" is contracted booking value; Gross Profit subtracts one period's construction cost from it | Net margin reads 83.6% on the audit set; profit line has no accounting meaning | No revenue-recognition step. The engine has one income figure and uses it for both the collections view and the statement | Add recognised revenue (percentage of completion or transfer, per policy) and drive the statement from it; keep booking value as its own KPI | **OPEN** |
| FIN-02 | **P1** | Import / income | A receivable export and a sales export covering the same contracts are both accepted and added together | ฿24.5m became ฿49.0m in test, silently | Both file types match on shared header vocabulary; no rule compares the two ledgers | Reconciliation rule comparing receivable and income contractual by contract/unit, raised as an import issue | **OPEN** |
| FIN-03 | **P1** | Budget | Monthly budget compared against cumulative contracted income | 18,873% utilisation on the real SUN9 volumes | `total_contractual_income` is not period-filtered; the budget is | Compare the budget with the month's income, or state the budget cumulatively — not one against the other | **OPEN** |
| FIN-04 | **P2** | Validation | 3 of 8 reconciliation rules compare a derived figure with its own definition and can never fail | "All checks passed" overstates what was checked | bank_identity, income_components, boq_reconciliation are tautologies | Replace with checks against the file's own stated totals, as `receivable_row_identity` already does | **OPEN** |
| FIN-05 | **P2** | Liquidity | Quick and current ratio divide by BOQ outstanding + pending, labelled "Accounts Payable" | Ratios flatter any month with light certification | There is no AP module to divide by | Build AP, or rename the input to what it is | **OPEN** |
| FIN-06 | **P1** | Drill-down | Six KPIs read two tables and drilled into one | Total Contractual Income showed ฿1,500,000 and opened a list footing to ฿1,200,000 | Each source declared a single table | A source may now declare further record sets; the query unions them | ✅ **FIXED & VERIFIED** |
| FIN-07 | **P2** | Drill-down | Four income-statement lines could not be opened | A director asking what is inside Cost of Sales was told nothing is | Not mapped | Cost of sales, operating expenses, tax and Total Outstanding Expense now open to their records | ✅ **FIXED & VERIFIED** |
| FIN-08 | **P1** | Consolidation | No group view exists | The group's own dashboard cannot show the group | By design: strict per-company isolation, with no scope above it | A group scope for users granted every company, with elimination applied | **OPEN** |
| FIN-09 | **P1** | Consolidation | No transaction can be marked as intercompany | A group total built today would double-count intercompany loans, fees and shared costs | Not modelled | Counterparty company on GL and expense records; elimination at group scope | **OPEN** |
| FIN-10 | **P2** | Receivables | No ageing and no overdue figure, though every due date is captured | "Who is late" cannot be answered | Not built; `due_date` is stored and never read | Ageing buckets and an overdue KPI off the due date already held | **OPEN** |
| FIN-11 | **P2** | Payables | No AP module at all | AP, AP ageing, vendor exposure and upcoming payments are unanswerable | Not built | AP import and ledger | **OPEN** |
| FIN-12 | **P2** | Data freshness | The report date is shown; nothing says it is stale | A three-month-old dashboard looks like today's | No SLA check | Warn when the newest snapshot is older than the agreed close cycle | **OPEN** |
| FIN-13 | **P3** | Import | Duplicate control is at file level, not transaction level | The same contract twice inside one file imports twice | No transaction key | Key on contract / invoice / voucher where the file carries one | **OPEN** |
| FIN-14 | **P3** | Forecast | With no forecast rows, forecast cash equals current cash and the projection is flat | Reads as "no cash risk" when it means "no forecast" | Documented fallback, stated only inside View Calculation | Say it on the tile | **OPEN** |
| FIN-15 | **P3** | Company master | Configured legal names differ from the list supplied for this audit | Management reporting under a name that is not the registered one | Seed data | Confirm with the company secretary and correct | **OPEN** |
| FIN-16 | **P4** | Master data | A company can only be added by writing to the database | A seventh subsidiary needs an engineer | No create form | Add one | **OPEN** |
| QA-01 | **P2** | Security | Sign-in accepted unlimited guesses | 20 wrong passwords in 954 ms, uncounted | No attempt store | Per-address and per-caller limits, 15-minute window | ✅ **FIXED & VERIFIED** |
| QA-02 | **P2** | Audit | Nothing recorded who changed what | Role changes, grants, renames, resets and rollbacks left no trace | Not built | `audit_log` and Settings › Activity Log | ✅ **FIXED & VERIFIED** |

---

## Section H — Data source audit

| Dashboard metric | Source system | Source table / API | Refresh | Status |
|---|---|---|---|---|
| Bank, cash, pending | Excel / ZIP upload | `bank_balances` | Manual import | ✅ |
| Receivables, income | Mango Anywhere export (RE_RPT), Excel | `receivable_records`, `income_records` | Manual import | ✅ |
| Expenses | Excel | `expense_records` | Manual import | ✅ |
| BOQ, project cost | Excel | `boq_records` | Manual import | ✅ |
| WIP, advances | Excel | `wip_records` | Manual import | ✅ |
| General ledger | Accounting export | `gl_entries` | Manual import | ✅ |
| Cash-flow forecast | Excel, where the file carries one | `cashflow_forecasts` | Manual import | ⚠️ usually absent |
| Customer Card report | Mango Anywhere `RE_RPT_070306_1` | `customer_card_reports` | On demand | ✅ |
| Budget | Entered in the app | `budgets` | Manual | ⚠️ see FIN-03 |

**There is no live API integration.** Every figure arrives by someone uploading
a file. The refresh mechanism is a person, and the dashboard's freshness is
whatever they last uploaded. Mango Anywhere's catalogue was reviewed in full:
it is a real-estate sales and AR system and carries **no BOQ, WIP, general
ledger or bank report**, so those inputs come from somewhere else that has not
yet been named.

The Allkons price-comparison API (`openapi-sit.allkons.com`) could not be
reached from this environment — the egress proxy refuses CONNECT to that host —
so it remains untested.

---

## Section I — Database audit

29 tables. Every fact table carries `company_id` as its own column rather than
reaching it through the project, so a record whose project is unassigned still
belongs to a company and cannot fall out of a scoped query.

| Table | Purpose | PK | FK | Index | Issue | Financial risk |
|---|---|---|---|---|---|---|
| companies, projects, project_aliases | Master data | ✅ | ✅ | ✅ | — | — |
| users, user_companies, auth_sessions | Access | ✅ | ✅ | ✅ | — | — |
| sign_in_attempts, audit_log | Security & history | ✅ | ✅ | ✅ | — | — |
| imports, import_files, import_issues, import_previews | Import trail | ✅ | ✅ | ✅ | — | — |
| financial_snapshots | Period container | ✅ | ✅ | ✅ | — | — |
| bank_balances, receivable_records, income_records, expense_records, boq_records, wip_records, gl_entries, cashflow_forecasts | Facts | ✅ | ✅ | ✅ company + snapshot | Amounts are `NUMERIC` holding IEEE doubles | Mitigated: every total is rounded to satang at each step, and satang survive the round trip (verified). Not true decimal arithmetic |
| calculated_metrics | Stored KPIs | ✅ | ✅ | ✅ | — | — |
| validation_results | Reconciliation | ✅ | ✅ | ✅ | 3 rules are tautologies (FIN-04) | Overstated assurance |
| source_references, raw_rows, sheet_detections | Traceability | ✅ | ✅ | ✅ | — | — |
| budgets | Budget | ✅ | ✅ | ✅ unique (company, month, project) | Compared against a cumulative figure (FIN-03) | Variance is wrong |
| template_mappings, template_company_state | Mapping | ✅ | ✅ | ✅ | — | — |
| customer_card_reports | Stored reports | ✅ | ✅ | ✅ | — | — |

Checked live: no NULL `company_id` in any of eleven fact tables, no duplicate
alias, no duplicate email, exactly one live snapshot per company per report
date, clean `foreign_key_check` and `integrity_check` — including after
concurrent writes.

---

## Section J — API audit

| Method | Endpoint | Financial function | Auth | Permission | Validation | Status |
|---|---|---|---|---|---|---|
| GET | `/api/health` | Liveness | none | none | — | ✅ |
| GET | `/api/drilldown` | Records behind a KPI | session | any role | snapshot must belong to the session's company; unknown answers 404, not another company's rows | ✅ |
| POST | `/api/import/upload` | Parse and preview | session | import:run | size, type, zip-bomb guard | ✅ |
| POST | `/api/import/confirm` | Persist an import | session | import:run | duplicate check, company from session | ✅ |
| POST | `/api/imports/{id}` | Rollback / recalculate | session | import:rollback | import must be this company's; unknown action 400; second rollback 409 | ✅ |
| POST | `/api/reports/customer-card` | Produce the report | session | export:run | file size, type, report date | ✅ |
| GET | `/api/reports/customer-card/{id}` | Download | session | export:run | report must be this company's | ✅ |
| DELETE | `/api/reports/customer-card/{id}` | Delete | session | admin/finance | same | ✅ |
| POST | `/api/auth/logout` | End session | session | — | — | ✅ |

Every id in a query string is treated as a request, never as an authorisation:
the company comes from the session and is applied to the record itself. An
anonymous drill-down answers 401; management and viewer are refused every POST;
a snapshot id copied from another company answers "not found" rather than
admitting it exists.

---

## Section K — Permission matrix

Four roles, as implemented.

| Capability | Admin | Finance | Management | Viewer |
|---|:--:|:--:|:--:|:--:|
| Dashboards | ✅ | ✅ | ✅ | ✅ |
| Drill-down | ✅ | ✅ | ✅ | ✅ |
| Export / download reports | ✅ | ✅ | ✅ | ❌ |
| Run Customer Card report | ✅ | ✅ | ❌ | ❌ |
| Delete a stored report | ✅ | ✅ | ❌ | ❌ |
| Import | ✅ | ✅ | ❌ | ❌ |
| Rollback / recalculate | ✅ | ✅ | ❌ | ❌ |
| Mapping, templates, budget | ✅ | ✅ | ❌ | ❌ |
| Projects & aliases | ✅ | ✅ | ❌ | ❌ |
| Companies | ✅ | ❌ | ❌ | ❌ |
| Users & roles | ✅ | ❌ | ❌ | ❌ |
| Activity log | ✅ | ❌ | ❌ | ❌ |

Data is scoped by company grant, re-checked on every request rather than trusted
from the session row, so a grant removed mid-session takes effect immediately.

**Not implemented:** project-level or cost-centre-level scoping, field-level
permission for confidential expenses, separation of view from edit from approve,
and any maker–checker step. Finance can import, roll back and recalculate
without a second pair of eyes.

---

## Section L — Data quality report

| Check | Result |
|---|---|
| Missing company on a fact row | 0 across 11 tables |
| Missing project | permitted by design; the company still owns the row |
| Duplicate alias | 0 |
| Duplicate email | 0 |
| Orphan rows / broken foreign keys | 0 |
| More than one live snapshot per company per report date | 0 |
| Money KPIs with no source reference | 0 |
| Drill-down disagreeing with its KPI | 0 (6 before this audit) |
| Mock, demo or placeholder data reaching a screen | 0 — proved by rendering eight dashboards for a company that has never imported anything and asserting no non-zero figure appears |
| Unmapped accounts | not detectable: there is no chart-of-accounts mapping to be unmapped from |
| Invalid dates | handled at import; the Customer Card parser flags a due date past any real plan and one mistyped by years |
| Stale records | **not detected** (FIN-12) |
| Transaction-level duplicates | **not detected** (FIN-13) |

---

## Section M — Production readiness checklist

| Area | Status |
|---|---|
| Authentication | **PASS** |
| Authorization | **PASS** |
| RBAC | **PASS** |
| Company structure | **PARTIAL** — six companies, correct isolation; names to confirm; no UI to add one |
| Consolidation | **NOT IMPLEMENTED** |
| Revenue | **FAIL** — booking value presented as income |
| AR | **PASS** |
| AR ageing | **NOT IMPLEMENTED** |
| AP | **NOT IMPLEMENTED** |
| AP ageing | **NOT IMPLEMENTED** |
| Cash | **PASS** |
| Bank | **PARTIAL** — balances yes, reconciliation against statements no |
| Expenses | **PASS** |
| Project costs | **PASS** |
| Budgets | **FAIL** — variance compares a month with a lifetime |
| Forecast | **PARTIAL** — works with forecast rows, silently flat without |
| P&L | **FAIL** — inherits the revenue definition |
| Balance sheet | **NOT IMPLEMENTED** |
| Cash flow | **PARTIAL** — projection yes, operating/investing/financing classification no |
| Project financials | **PARTIAL** |
| Data pipeline | **PASS** |
| Data refresh | **PARTIAL** — manual, no staleness warning |
| API | **PASS** |
| Database | **PASS** |
| Audit logs | **PASS** |
| Export security | **PASS** — permissioned; the export itself is not logged |
| Error handling | **PASS** — zero, no data and error are distinguished; a failed source does not render as 0 |
| Performance | **NOT TESTED** at production volume |
| Backup | **NOT TESTED** |
| Recovery | **NOT TESTED** |

---

## Financial accuracy score

| Dimension | Score |
|---|---:|
| Financial data accuracy | 72 |
| Revenue accuracy | 40 |
| AR accuracy | 88 |
| AR ageing accuracy | 0 |
| AP accuracy | 10 |
| Cash accuracy | 92 |
| Expense accuracy | 85 |
| Budget accuracy | 35 |
| Project cost accuracy | 82 |
| Profit accuracy | 30 |
| Consolidation accuracy | 5 |
| KPI definition quality | 88 |
| Data integrity | 96 |
| Source traceability | 95 |
| Dashboard accuracy | 90 |
| Reporting accuracy | 88 |
| Database quality | 84 |
| API quality | 88 |
| Security | 78 |
| Permission control | 90 |
| Auditability | 86 |
| Performance | not measured |
| Production readiness | 55 |

# OVERALL GLOBAL TOP GROUP FINANCIAL DASHBOARD READINESS SCORE: 67/100

The engineering scores in the high eighties and nineties. The accounting scores
in the thirties and forties. The gap between those two numbers is this report.

---

# NOT READY FOR PRODUCTION

as the group's financial and management-accounting platform.

It is ready, today, for what it actually does well: per-company cash,
receivables, construction cost and import integrity, with full traceability
from tile to spreadsheet cell. Released for that purpose, with the profit,
margin and budget-variance tiles hidden until FIN-01 and FIN-03 are settled, it
would be safe and useful. Released as a group P&L and consolidation platform,
it would put figures in front of the board that no one can defend.

---

## MUST FIX BEFORE PRODUCTION (P0/P1)

**FIN-01 · Revenue and profit are not accounting figures**
- Financial value affected: every profit and margin figure, all companies
- Company / project: all · Period: all
- Root cause: no revenue-recognition step; contracted booking value is used as income in the income statement
- Financial risk: a board decision — a distribution, a facility, a land purchase — taken on an 83.6% margin that does not exist
- Required fix: decide the recognition policy with the auditors (percentage of completion, or on transfer), compute recognised revenue, and drive Gross Profit from it. Keep booking value as its own clearly-named KPI.
- Acceptance test: on the SUN9 card, recognised revenue and gross margin agree with the statutory accounts for the same period, within the agreed rounding tolerance

**FIN-03 · Budget variance compares a month with a lifetime**
- Financial value affected: every variance and utilisation figure
- Root cause: the budget is per month; `total_contractual_income` is cumulative
- Financial risk: utilisation reads in the thousands of per cent; over- and under-spend are both invisible
- Required fix: compare like with like — the month's income against the month's budget
- Acceptance test: a ฿5m August budget against ฿4m of August income reads 80%, not 18,873%

**FIN-02 · The same contract can be counted twice**
- Financial value affected: revenue and receivables, whenever both a receivable export and a sales export are imported together
- Financial risk: revenue overstated by up to 100%
- Required fix: a reconciliation rule comparing the two ledgers by contract or unit, raised as an import issue before the snapshot goes live
- Acceptance test: importing an AR export and a sales export covering the same contracts raises an error and does not double the revenue

**FIN-08 / FIN-09 · No group, and no way to eliminate intercompany**
- Financial value affected: every group figure, because none exists
- Financial risk: today, none — nothing is consolidated. The day one is built without FIN-09, intercompany balances are counted twice.
- Required fix: a group scope for users granted every company, with a counterparty field on GL and expense records and elimination applied at group level
- Acceptance test: group cash equals the sum of company cash; an intercompany loan appearing as a receivable in one company and a payable in another nets to zero at group

---

## SHOULD FIX BEFORE PRODUCTION (P2)

FIN-04 (tautological validation rules) · FIN-05 (payables proxy in the liquidity
ratios) · FIN-10 (AR ageing and overdue) · FIN-11 (AP module) · FIN-12
(stale-data warning). QA-01 and QA-02 were in this band and are fixed.

---

## POST-LAUNCH IMPROVEMENTS (P3/P4)

FIN-13 (transaction-level duplicate control) · FIN-14 (say on the tile that the
projection is a fallback) · FIN-15 (confirm the registered legal names) ·
FIN-16 (a form to add a company) · executive alerts · export logging ·
performance and restore rehearsals.

---

## Fix → retest → reconcile

FIN-06 and FIN-07 were fixed during this audit and taken through the full
sequence: unit test, API test, database test, recalculation, dashboard test,
detailed-report test, reconciliation and regression. All 25 record-backed KPIs
now foot to their drill-down to the satang, 274 unit tests pass, 30 isolation
checks pass, and 293 of 296 live checks pass. Those two are **VERIFIED /
CLOSED**.

Everything else in the register above remains **OPEN**. No unexplained variance
has been left without a name.
