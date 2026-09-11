# Pulling the sales ledger out of Mango RE

The sales ledger lives in Mango RE (`chaithanin.mangoanywhere.com/production.re`),
and until now the only way it reached this dashboard was that somebody exported a
workbook and uploaded it. It does not have to arrive that way. Mango is an
ASP.NET application whose screens are drawn by Vue from its own JSON endpoints,
so the data can simply be read — there is no browser to drive and no export to
wait for.

```bash
npm run mango:pull -- --company GTG --dry-run     # look
npm run mango:pull -- --company GTG               # and then write
```

Run the dry run first. It signs in, fetches, checks the schema, maps everything
and prints what it would have written, but touches no database — which is also
how you find out whether the account can see the whole company before a short
pull becomes a wrong figure on a screen.

---

## The account

Mango filters every response by the rights of whoever signed in, so **a pull is
only ever as complete as its account**. The account used for the September 2026
survey could see three projects; a pull with that account would have produced a
receivable total that looked plausible and was missing most of the company.

Ask IT for a **service account with read rights to every project**, and do not
use a person's own login. Two reasons, and the second is the one people forget:
Mango writes an audit entry every time a user opens a menu, so a nightly pull
under somebody's name fills their audit trail with machine traffic and makes the
real question — what did this person look at — unanswerable.

The run prints the project list it can see before it does anything else. A short
list is meant to be noticed there.

## Credentials

They go in the environment, never in the repository:

```
MANGO_BASE_URL=https://chaithanin.mangoanywhere.com/production.re
MANGO_USER=…
MANGO_PASS=…
```

`.env` and `.env*.local` are git-ignored. On the deployment VM these belong in
the container's environment (`/opt/gtg/run.sh`) rather than baked into the image.

## Flags

| Flag | What it does |
|---|---|
| `--company <code>` | which company in the dashboard the data belongs to; required unless `--dry-run` |
| `--projects a,b` | limit to these Mango project codes (default: everything the account can see) |
| `--date YYYY-MM-DD` | the report date to file the pull under (default: today) |
| `--dry-run` | fetch, map and report; write nothing |
| `--save <file>` | also write the raw bundle to disk, for inspection |
| `--force` | proceed past a schema failure, and import a pull that is a duplicate of one already held |

`--force` exists for the evening when a figure is needed and the alternative is
nothing at all. It is not a way past a schema failure — see below for what that
failure actually means.

---

## What lands, and what does not

A pull produces the same records an upload produces and goes through the same
`persistImport`, so it gets the same validation, duplicate check, snapshot, audit
entry and rollback as any workbook. Re-running an identical pull is recognised as
the duplicate it is, by the SHA-256 of what Mango returned — not by the filename,
which would be the same every day regardless.

Three of the mapping decisions are accounting decisions rather than plumbing, and
each is the kind that would otherwise sit invisible inside a type coercion.

**A cancelled booking is not a receivable.** Mango keeps cancelled rows in the
same list with `cancel_status` set. Summing the list without looking reports money
nobody owes.

**What has been collected is the receipts.** The transaction list carries no
"received" column at all, so reading one would put zero against every contract.
Collected is the sum of the receipts (`transaction_detail`) filed against each
contract — which is also why a receipt whose contract is not in the pull is
reported as an issue rather than quietly counted or quietly dropped.

**The receipts are not written into the income ledger.** Mango is one ledger where
this system has two: the transactions are the receivables and the details are the
payments against them. Writing both would report revenue as the contracts *plus*
the payments for those same contracts, which is exactly the double count the
income-overlap reconciliation rule exists to catch. The monthly collection figure
is real and is returned for reporting under a name that says what it is, rather
than being posted as income.

One thing the pull gives away for free: summing the **active** price list gives
what a project expects to sell for, which is the board figure revenue recognition
needs and which somebody has been typing into Settings by hand. The pull sets it,
leaving the cost budget fields alone. A unit that has been repriced counts at its
revised price, and a unit no longer flagged active does not count at all — the
price list carries the history as well as the current position.

Dates arrive in three formats and sometimes in Buddhist years. A Buddhist year
left alone puts every due date 543 years out, and an ageing report then shows
nothing overdue on a ledger that is months behind.

## Matching projects

Mango's project codes are resolved against the aliases each project already
carries, which is the same resolution an uploaded workbook goes through — so a
project recognised in a spreadsheet is recognised here without further setup.

Codes that match nothing are named at the end of the run. Their records are still
kept and still belong to the company; they simply sit under no project until the
code is added as an alias in **Settings › Projects & Aliases**. Nothing is
discarded for want of a match.

## When the schema check stops the run

These are undocumented internal endpoints. Mango has made no promise not to
rename a column, and a renamed column arrives as `undefined`, coerces to zero and
becomes a figure that is confidently wrong. So every pull compares what came back
against what the September 2026 survey recorded, and a missing table or column
stops the run:

```
── Mango has changed since this was written
   missing_column  "transaction" no longer carries "netamount". …
```

Find the new name rather than forcing past it: open the screen in Chrome, F12 →
Network → filter Fetch/XHR, and read the response the page itself receives. Then
update `src/lib/sources/mango/types.ts` and the mapper, and extend
`tests/fixtures/mango-bundle.ts` so the old shape and the new one are both
covered.

An `empty_table` finding is a warning rather than a stop: either there is
genuinely nothing there, or this account has no rights to it — which is worth
knowing, and is the same symptom as a service account that was set up with too
little.

## Testing it without touching live data

```bash
node --import ./scripts/register-ts.mjs scripts/mango-stub.mjs   # port 4310
MANGO_BASE_URL=http://127.0.0.1:4310/production.re \
MANGO_USER=svc.dashboard MANGO_PASS=stub-password \
  npm run mango:pull -- --dry-run
```

The stub answers in the shape the survey recorded, including the anti-forgery
token the real login form requires, so it exercises the real client — form
parsing, cookies, the envelope, the schema check — rather than pretending the
data is real. `tests/mango-source.test.ts` runs against the same fixture.

The live service is not reachable from the development container: the egress
proxy refuses the host. That is also why the first error the client can raise is
worded the way it is — the login page is public, so a refusal *there*, before any
credentials are sent, is something between the machine and Mango saying no, not a
rejected sign-in and not a moved endpoint.

## Staying a guest

Only read endpoints are called. Nothing in this client posts to a save or update
action, and it should stay that way: this system reports on Mango's data, it is
not a second way to edit it. Tell Mango Consultant that the connection exists, so
a nightly pull is not read as anomalous traffic.

There is also an official API — `rex_settings/api_tokens` already holds one
active token — but no published documentation for it. Worth asking for in
parallel: if it arrives, only the authentication layer here changes and
everything downstream of it stays as written.
