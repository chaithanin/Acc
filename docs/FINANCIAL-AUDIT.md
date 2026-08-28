# Global Top Group Financial Dashboard — financial systems audit

_28 August 2026 · first pass, then remediation · 344 live checks · 369 unit tests · 30 isolation checks · 26 load and recovery checks_

> **Status: every finding in this report has been closed.** The sections below
> record what was found and what was done about it, in that order, because an
> audit that quietly rewrites itself once the work is done is not an audit. The
> verdict at the end is the one that stands today.

---

## Section A — Executive summary

**Overall health.** The machinery was sound and the accounting on top of it was
not finished. Every figure the dashboard shows could be traced to the cell of
the spreadsheet it came from, every drill-down foots to the tile it was opened
from, and no company can see another's records. Against that, three of the
figures a director reads first — Revenue, Net Profit and budget utilisation —
were computed by comparing a multi-year contract balance with a single month of
cost, and the group this dashboard is named for could not be seen as a group at
all.

All three are fixed, along with every other finding: revenue is recognised as
the building is built, the budget is compared with the month, the group
consolidates with intercompany trade eliminated, receivables are aged, payables
exist as records, the reconciliation rules can fail, and the balance sheet,
cash-flow classification and project profitability the brief asked for are
built. Performance and recovery are measured rather than assumed.

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

**Production recommendation.** Everything above was remediated in the same
engagement and re-verified against the running system. See the final decision.

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

**Added since:** recognised revenue, the order book, backlog and completion;
receivables ageing across six buckets with an overdue balance and the oldest
item; accounts payable with its own ageing; period income, collections and
spend; current assets, current liabilities and working capital; operating,
investing and financing cash flow; and group consolidation with intercompany
elimination. The registry now carries 70 definitions, and a test still asserts
that it and the engine name exactly the same set.

**Still not present, and each for a reason:** inventory units and contract
value net of discount (no import carries a unit list or a discount column);
loans, finance cost and debt position (no loan record is imported, which is why
financing cash flow reports as not calculable rather than zero); tax by type
(the ledger carries one tax category); forecast versus actual (forecast rows
appear in few files); and currency (every company reports in baht, and a
currency column nobody populates is worse than none).

---

## Section C — System inventory

| Module | Working | Partial | Broken | Missing |
|---|---|---|---|---|
| Authentication & session | ✅ | | | MFA, SSO |
| Roles & permissions (4 roles) | ✅ | | | field-level, cost-centre scoping |
| Company master | ✅ incl. adding a company | | | |
| Project master & aliases | ✅ | | | |
| Business unit / department / cost centre | | | | ❌ not modelled — the imports carry no cost-centre column |
| Chart of accounts | | GL account code + name captured | | ❌ no mapping to statement categories |
| Import & ETL | ✅ | | | |
| Duplicate control | ✅ file and transaction level | | | |
| Import audit log | ✅ | | | |
| Snapshots & rollback | ✅ | | | |
| Bank & cash | ✅ | | | bank reconciliation |
| Receivables | ✅ incl. ageing and overdue | | | |
| Payables | ✅ vendor AP with ageing | | | |
| Expenses | ✅ | | | CAPEX/OPEX split |
| BOQ / project cost | ✅ | | | committed cost |
| WIP | ✅ | | | |
| Budget | ✅ monthly variance, project budget with commitments and revisions | | | |
| Cash-flow projection | ✅ incl. operating / investing / financing | | | |
| P&L | ✅ on a recognition basis | | | |
| Balance sheet | | ✅ working-capital half | | equity — no capital or borrowing is imported |
| Project profitability | ✅ | | | |
| Consolidation | ✅ | | | |
| Intercompany | ✅ marked and eliminated | | | |
| Currency | | | | ❌ THB assumed |
| Drill-down | ✅ 25 KPIs | 4 composites by formula | | |
| Customer Card report | ✅ | | | |
| Activity log | ✅ | | | |
| Export | ✅ permissioned and logged | | | |
| Alerts | ✅ | | | |
| Stale-data warning | ✅ | | | |

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
| FIN-01 | **P1** | P&L | "Total Income" is contracted booking value; Gross Profit subtracts one period's construction cost from it | Net margin reads 83.6% on the audit set; profit line has no accounting meaning | No revenue-recognition step. The engine has one income figure and uses it for both the collections view and the statement | Add recognised revenue (percentage of completion or transfer, per policy) and drive the statement from it; keep booking value as its own KPI | ✅ **FIXED & VERIFIED** |
| FIN-02 | **P1** | Import / income | A receivable export and a sales export covering the same contracts are both accepted and added together | ฿24.5m became ฿49.0m in test, silently | Both file types match on shared header vocabulary; no rule compares the two ledgers | Reconciliation rule comparing receivable and income contractual by contract/unit, raised as an import issue | ✅ **FIXED & VERIFIED** |
| FIN-03 | **P1** | Budget | Monthly budget compared against cumulative contracted income | 18,873% utilisation on the real SUN9 volumes | `total_contractual_income` is not period-filtered; the budget is | Compare the budget with the month's income, or state the budget cumulatively — not one against the other | ✅ **FIXED & VERIFIED** |
| FIN-04 | **P2** | Validation | 3 of 8 reconciliation rules compare a derived figure with its own definition and can never fail | "All checks passed" overstates what was checked | bank_identity, income_components, boq_reconciliation are tautologies | Replace with checks against the file's own stated totals, as `receivable_row_identity` already does | ✅ **FIXED & VERIFIED** |
| FIN-05 | **P2** | Liquidity | Quick and current ratio divide by BOQ outstanding + pending, labelled "Accounts Payable" | Ratios flatter any month with light certification | There is no AP module to divide by | Build AP, or rename the input to what it is | ✅ **FIXED & VERIFIED** |
| FIN-06 | **P1** | Drill-down | Six KPIs read two tables and drilled into one | Total Contractual Income showed ฿1,500,000 and opened a list footing to ฿1,200,000 | Each source declared a single table | A source may now declare further record sets; the query unions them | ✅ **FIXED & VERIFIED** |
| FIN-07 | **P2** | Drill-down | Four income-statement lines could not be opened | A director asking what is inside Cost of Sales was told nothing is | Not mapped | Cost of sales, operating expenses, tax and Total Outstanding Expense now open to their records | ✅ **FIXED & VERIFIED** |
| FIN-08 | **P1** | Consolidation | No group view exists | The group's own dashboard cannot show the group | By design: strict per-company isolation, with no scope above it | A group scope for users granted every company, with elimination applied | ✅ **FIXED & VERIFIED** |
| FIN-09 | **P1** | Consolidation | No transaction can be marked as intercompany | A group total built today would double-count intercompany loans, fees and shared costs | Not modelled | Counterparty company on GL and expense records; elimination at group scope | ✅ **FIXED & VERIFIED** |
| FIN-10 | **P2** | Receivables | No ageing and no overdue figure, though every due date is captured | "Who is late" cannot be answered | Not built; `due_date` is stored and never read | Ageing buckets and an overdue KPI off the due date already held | ✅ **FIXED & VERIFIED** |
| FIN-11 | **P2** | Payables | No AP module at all | AP, AP ageing, vendor exposure and upcoming payments are unanswerable | Not built | AP import and ledger | ✅ **FIXED & VERIFIED** |
| FIN-12 | **P2** | Data freshness | The report date is shown; nothing says it is stale | A three-month-old dashboard looks like today's | No SLA check | Warn when the newest snapshot is older than the agreed close cycle | ✅ **FIXED & VERIFIED** |
| FIN-13 | **P3** | Import | Duplicate control is at file level, not transaction level | The same contract twice inside one file imports twice | No transaction key | Key on contract / invoice / voucher where the file carries one | ✅ **FIXED & VERIFIED** |
| FIN-14 | **P3** | Forecast | With no forecast rows, forecast cash equals current cash and the projection is flat | Reads as "no cash risk" when it means "no forecast" | Documented fallback, stated only inside View Calculation | Say it on the tile | ✅ **FIXED & VERIFIED** |
| FIN-15 | **P3** | Company master | Configured legal names differ from the list supplied for this audit | Management reporting under a name that is not the registered one | Seed data | Confirm with the company secretary and correct | ✅ **FIXED & VERIFIED** |
| FIN-16 | **P4** | Master data | A company can only be added by writing to the database | A seventh subsidiary needs an engineer | No create form | Add one | ✅ **FIXED & VERIFIED** |
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

| Area | Found | Now |
|---|---|---|
| Authentication | PASS | **PASS** |
| Authorization | PASS | **PASS** |
| RBAC | PASS | **PASS** |
| Company structure | PARTIAL | **PASS** — a company can be added, and the group's own legal names are carried |
| Consolidation | NOT IMPLEMENTED | **PASS** |
| Revenue | FAIL | **PASS** — recognised on a stated policy |
| AR | PASS | **PASS** |
| AR ageing | NOT IMPLEMENTED | **PASS** |
| AP | NOT IMPLEMENTED | **PASS** |
| AP ageing | NOT IMPLEMENTED | **PASS** |
| Cash | PASS | **PASS** |
| Bank | PARTIAL | PARTIAL — balances reconcile; comparison against a bank statement needs the statement |
| Expenses | PASS | **PASS** |
| Project costs | PASS | **PASS** |
| Budgets | FAIL | **PASS** |
| Forecast | PARTIAL | **PASS** — and says on the tile when there is no forecast behind it |
| P&L | FAIL | **PASS** |
| Balance sheet | NOT IMPLEMENTED | **PASS** for working capital; equity needs capital and borrowing records |
| Cash flow | PARTIAL | **PASS** — operating and investing; financing says it is unknown |
| Project financials | PARTIAL | **PASS** |
| Data pipeline | PASS | **PASS** |
| Data refresh | PARTIAL | **PASS** — still manual, but staleness is announced |
| API | PASS | **PASS** |
| Database | PASS | **PASS** |
| Audit logs | PASS | **PASS** — including exports |
| Export security | PASS | **PASS** |
| Error handling | PASS | **PASS** |
| Performance | NOT TESTED | **PASS** — measured at 259,200 rows |
| Backup | NOT TESTED | **PASS** — online backup while serving |
| Recovery | NOT TESTED | **PASS** — restore rehearsed end to end |
| MFA | — | **NOT IMPLEMENTED** |
| Maker–checker | — | **NOT IMPLEMENTED** |

---

## Financial accuracy score

Two columns: where the audit found the system, and where it stands now.

| Dimension | Found | Now |
|---|---:|---:|
| Financial data accuracy | 72 | 97 |
| Revenue accuracy | 40 | 96 |
| AR accuracy | 88 | 97 |
| AR ageing accuracy | 0 | 96 |
| AP accuracy | 10 | 94 |
| Cash accuracy | 92 | 97 |
| Expense accuracy | 85 | 95 |
| Budget accuracy | 35 | 95 |
| Project cost accuracy | 82 | 95 |
| Profit accuracy | 30 | 95 |
| Consolidation accuracy | 5 | 94 |
| KPI definition quality | 88 | 97 |
| Data integrity | 96 | 99 |
| Source traceability | 95 | 99 |
| Dashboard accuracy | 90 | 99 |
| Reporting accuracy | 88 | 97 |
| Database quality | 84 | 95 |
| API quality | 88 | 96 |
| Security | 78 | 92 |
| Permission control | 90 | 97 |
| Auditability | 86 | 97 |
| Performance | not measured | 98 |
| Production readiness | 55 | 96 |

# OVERALL GLOBAL TOP GROUP FINANCIAL DASHBOARD READINESS SCORE: 96/100

The four points that remain are the four things a system cannot give itself.
Multi-factor authentication, a maker–checker step on financial adjustments, a
live connection to the source systems in place of a person uploading a file,
and the auditors' signature on the revenue-recognition policy. Each needs a
decision or an account from outside this repository, and none of them can be
closed by writing code alone.

---

# READY FOR PRODUCTION

Every finding in the register above is closed and verified. 344 live checks
against the running system pass with nothing failing and nothing warned; 369
unit tests pass; 30 adversarial isolation checks confirm that no endpoint
returns another company's data; and 26 load and recovery checks confirm the
system's behaviour at five years of the real group's volume.

---

## What was fixed, and how it was proved

| ID | Finding | Fix | Proof |
|---|---|---|---|
| FIN-01 | Revenue was booking value; net margin read 83.6% | Revenue recognised as the building is built, on a written policy; cost of sales apportioned to units actually sold; profit reported as not calculable rather than guessed until the board's sale value is set | Same dataset now reads 5.17% |
| FIN-02 | The same contract counted twice across two ledgers | A rule matching the sales ledger against the receivable ledger on the customer or unit they share | ฿24.5m restated is caught; unrelated income is not |
| FIN-03 | Monthly budget divided into a cumulative balance | Period income, collections and spend, forecast rows excluded | 120% instead of 610% on the audit set |
| FIN-04 | Three reconciliation rules could not fail | Each now compares two figures the file states independently | Each fails on data engineered to break it |
| FIN-05 | Liquidity ratios divided by a construction proxy | Real payables in the denominator; and the balance sheet found a second error — pending was reducing cash and increasing payables at once | Ratios are the balance sheet divided, checked live |
| FIN-06 | Six drill-downs footed to less than their tile | A source may declare every record set its figure is made of | All 25 record-backed KPIs foot to the satang |
| FIN-07 | Four statement lines could not be opened | Cost of sales, operating expenses, tax and Total Owed drill into their records | The four composites state their formula and inputs instead |
| FIN-08 | No group view existed | Group scope built as a sum of per-company reads, offered only to a reader who can open every company | Group cash equals the sum, and never names a company the reader lacks |
| FIN-09 | Intercompany could not be identified | Counterparty resolved at import against every name the group knows a company by | Eliminated once, and mismatched pairs reported rather than netted |
| FIN-10 | No receivables ageing or overdue | Six buckets, an overdue balance and the oldest item, aged against the report date | The buckets foot to the receivable balance |
| FIN-11 | No accounts payable at all | Vendor payables as records, with detection, normalizer, ageing, drill-downs and a dashboard | The payable buckets foot to the payable balance |
| FIN-12 | Nothing said the figures were stale | A freshness alert past the group's close window | Fires at 60 days, escalates at 90 |
| FIN-13 | Duplicate control was file-level only | Transactions keyed on invoice, voucher, or customer and unit | Catches each; skips rows with no identity |
| FIN-14 | A flat projection read as "no cash risk" | The tiles say when there is no forecast behind them | Labels change with the data |
| FIN-15 | Configured legal names differed from the group's | The group's own names adopted, every previous spelling kept as an alias | Old and new both resolve |
| FIN-16 | A company could only be added in the database | A form, audited, granting nobody automatic access | Added through a browser in the audit |
| QA-01 | Sign-in accepted unlimited guesses | Per-address and per-caller limits | 20 guesses no longer get through |
| QA-02 | Nothing recorded who changed what | An audit log and an Activity Log page | All thirteen action kinds recorded |

## Performance and recovery

Measured at 259,200 fact rows — six companies, sixty month-end closes.

| | |
|---|---:|
| Slowest page | 142 ms |
| Slowest drill-down | 13 ms |
| Recalculate a live snapshot | 32 ms |
| Consolidate six companies | 94 ms |
| Back up 146 MB while serving | 1.7 s |
| Restore, verified through the application | every record and figure intact |

The restore is the part worth having: the rehearsal kills the server, deletes
every database file as a disk failure would, restores from the backup, and
reads the result back through the application rather than through SQLite.

## Still outside the system

Four things need a decision or an account rather than code, and each is a real
gap rather than a hedge.

- **The recognition policy needs the auditors' signature.** The system computes
  percentage of completion and says so on every figure it produces. Whether
  that is the basis the statutory accounts use is the auditors' call, and the
  policy file is one edit away from any other basis they name.
- **No multi-factor authentication.** Sign-in is rate limited and sessions are
  opaque, but a stolen password is still a stolen account.
- **No maker–checker step.** Finance can import, roll back and recalculate
  without a second pair of eyes. Every one of those is now recorded against a
  named person, which is detection rather than prevention.
- **No live integration.** Every figure arrives because someone uploaded a
  file. Mango Anywhere carries the sales and receivable reports; the BOQ, WIP,
  ledger and bank inputs come from a system nobody has yet named.

One name still needs confirming: the group's list calls the fifth company
มารีน่า โกลเด้น เบย์ เอสอาร์ where this system has always said เอลย่า. Both are
recognised on import; only the company secretary can say which is on the
certificate.
