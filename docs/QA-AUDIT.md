# End-to-end QA audit

_Run: 24 August 2026 · `npm run test:e2e` · 235 checks · 234 passed · 1 open_

## What was actually done

Every finding below comes from a system that was running. `scripts/e2e-audit.mjs`
builds the production bundle, starts it, seeds three companies and eight
accounts, and then uses the system the way a person does: it signs in through
the form, chooses a company, fills in forms, uploads, rolls back, downloads,
and reads the database afterwards to see whether what the screen said had
happened actually happened.

Two forms cannot be reached over HTTP at all. They live inside client
components behind an Edit button, and their server actions carry encrypted
bound arguments that only the page itself can produce — a synthesised POST
fails while decrypting and the action never runs. Chromium drives those.

Nothing here was concluded by reading code alone.

| Module | What it covers | Checks | Result |
|---|---|---:|---|
| M1 | Authentication & session | 10 | pass |
| M2 | Company selection | 4 | pass |
| M3 | Every page, for every role | 76 | pass |
| M4 | Every API, for every role | 15 | pass |
| M5 | CRUD through the real forms | 18 | pass |
| M5b | Forms that need a browser | 16 | 15 pass, 1 improvement |
| M6 | Import workflow | 19 | pass |
| M7 | Customer Card report | 8 | pass |
| M8 | Dashboard figures against the database | 6 | pass |
| M9 | Data integrity | 17 | pass |
| M11 | A company with no data | 12 | pass |
| M12 | Security posture & concurrency | 31 | pass |
| M10 | Errors | 3 | pass |

Alongside it: 251 unit tests, and 30 adversarial isolation checks that fire
every read with another company's snapshot, import and project ids.

## Findings

### Fixed during this audit

**QA-01 · Sign-in accepted unlimited guesses — High**

_Symptom._ Twenty wrong passwords against a known address were all answered
normally, in 954 ms — about 48 ms each. Nothing counted them, nothing delayed
them, nothing locked.

_Root cause._ `signIn` verified the password and returned; there was no
attempt store and no limit anywhere in the path.

_Affected._ `/login`, and through it every company's records.

_Fix._ `src/lib/auth/throttle.ts` and the `sign_in_attempts` table. Failures
are counted against the address typed **and** the caller's address, both
inside a 15-minute window; either one over its limit refuses the next attempt
for 15 minutes, measured from the most recent failure so guessing through a
lockout extends it. The two limits differ on purpose — 8 per address, 40 per
caller — because a whole office can share one address through NAT, and one
colleague's eight mistakes must not stop the floor working.

_Regression scope._ Sign-in for every role; the correct password during a
lockout; a bystander at the same address; the audit's own sessions.
8 unit tests, 5 live checks.

**QA-02 · Nothing recorded who changed what — High**

_Symptom._ No audit table existed. Imports and stored reports named their
user; a role change, a grant, a company rename, a password reset and a
rollback left nothing at all.

_Root cause._ Not built. The system could say what a figure was but not who
made it that.

_Affected._ Users, companies, projects, aliases, templates, budgets, imports,
rollbacks, recalculations, Customer Card reports, sign-in and sign-out.

_Fix._ The `audit_log` table, `src/lib/db/repositories/audit.ts`,
`src/lib/audit/index.ts`, and **Settings › Activity Log** (admin only). Every
mutating action writes an entry naming the person, their role, the company in
session and their address. Passwords are never written — only that one was
replaced, by whom, and for whom. Nothing edits or deletes an entry: the
repository exports no function that could, and a test holds it to that.

_Note._ Two entries are written directly rather than through the
request-scoped helper. Replacing a password revokes every session including
the writer's own, so the helper would find nobody signed in and drop the entry
in silence.

_Regression scope._ 7 unit tests, 17 live checks covering all thirteen action
kinds, one per mutating screen.

**QA-03 · Two settings pages threw at request time — High (introduced and caught in this run)**

While adding the log I declared a naming helper inside the page component. The
server actions below it closed over the helper, a captured function cannot be
serialised, and `/settings/projects` and `/settings/companies` threw on every
request — with a green build and a clean typecheck. The harness caught it
because a page that throws still answers 200; the check looks for a marker
that only a fully rendered page contains, plus the streamed error entry.
Both helpers moved to module scope. This is the second time this exact trap
has appeared in this codebase.

### Open

**QA-04 · A company cannot be added without database access — Improvement**

`/settings/companies` registers four actions — upload logo, remove logo,
update details — and the page has no add form. The six companies exist because
the seed created them. Adding a seventh subsidiary today means writing to the
database by hand.

Not a defect in anything that exists, and not a release blocker for a group
whose company list is fixed. It becomes one the first time the group acquires
something.

### Recorded, not blocking

- **Performance targets are compiled in.** `src/config/targets.ts` holds the
  net-margin, quick-ratio and current-ratio targets the dashboard measures
  against. Finance cannot change what "good" means without a deploy. The
  file's own comment already says a settings screen is intended.
- **`npm run lint` is not usable.** `next lint` is deprecated in Next 15.5 and
  the project has no ESLint configuration, so the script drops into an
  interactive prompt. CI does not run it — it runs typecheck, tests and build —
  so nothing is silently skipped, but the script should either be configured
  or removed.
- **The audit harness is not in CI.** `npm run test:e2e` and
  `npm run test:adversarial` are run by hand. Both are worth a job.

## The mock-data hunt

No mock, demo, placeholder or hardcoded figure reaches a production screen.

- No `mock`, `dummy`, `fake`, `lorem`, `TODO` or `FIXME` anywhere in `src/`.
- The only matches for "sample" are the importer sampling raw rows for the
  inspector, which is what it says.
- The only large literals in the UI are two `placeholder="e.g. 5000000"`
  attributes on the budget form, which are hints in an empty input.
- Seeding creates master data only — projects, companies, templates. It writes
  no financial record.

Proved rather than argued: **M11** gives a company an account and nothing else,
then renders `/`, `/financial`, `/projects`, `/receivable`, `/boq`,
`/cashflow`, `/ledger` and `/reconciliation` and asserts that no grouped
number anywhere on any of them is non-zero. A placeholder, a demo dataset or a
figure left over from another company would appear there. None did.

## Reconciliation

**M8** takes a stored KPI, sums the records behind it directly in SQL, calls
the drill-down API, and reads the figure off the rendered overview. All four
agree. The drill-down lists every contributing record, and a truncated
drill-down still reports the true total rather than the total of what it
returned. Receivable outstanding reconciles the same way.

## Concurrency

- Two people saving the same budget month at the same moment leave one row,
  holding one of the two figures.
- Rolling the same import back from two places at once succeeds exactly once;
  the other gets 409 and the import is left fully rolled back, not half.
- `PRAGMA integrity_check` and `foreign_key_check` are clean afterwards.

## Data integrity

No row in any of eleven fact tables is without a company. No alias is claimed
twice, no email is registered twice, and there is exactly one live snapshot per
company per report date. Rollback cascades to all nine record tables and leaves
the other company's rows untouched.

## Verdict

**READY FOR PRODUCTION**, with QA-04 recorded as follow-up work.

Both High findings are fixed, verified live, and covered by tests that will
fail if either regresses. No Critical or High finding is open. The one open
item is an Improvement: a company list that can only be extended by hand.

This verdict covers what was tested. It does not cover load and performance
under real volume, backup and restore rehearsal, monitoring and alerting, or
multi-factor authentication — none of which were in scope for this run, and
each of which is worth its own before the system carries a year of records.
