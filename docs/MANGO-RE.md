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
MANGO_USER=<service account username>
MANGO_PASS=<service account password>
MANGO_MAINCODE=MG1     # optional; MG1 is Chaithanin Co., Ltd.
```

**The company is part of the sign-in.** Mango serves several companies — MG1 to
MG6 — and the login carries the code alongside the username. Leave it wrong and
the sign-in fails exactly as a wrong password does, which is why the run reads
the company list off the login page and names the valid codes instead.

The angle brackets are deliberate. A value copied straight out of an example is
the ordinary way this goes wrong, and the run refuses to start on one rather
than letting it through to fail later as a rejected sign-in — which would send
somebody to reset a password that was never the problem.

`.env` and `.env*.local` are git-ignored. On the deployment VM these belong in
the container's environment (`/opt/gtg/run.sh`) rather than baked into the image.

## How the sign-in works, and why it matters

The login page is **Vue, not an ASP.NET form**. It renders nothing useful to
scrape and posts its own JSON:

```
POST /authentication/login_do
{ "userid": "…", "userpass": "…", "maincode": "MG1" }
```

Reading it as a form — which is the obvious thing to do with an ASP.NET
application, and what this connector did at first — produces a sign-in that
fails with no useful message. Older deployments *are* forms, with an
anti-forgery token to echo back, so the page is asked which kind it is rather
than assumed; both paths are tested.

A session is **several cookies, and some of them are set on the redirect after
the post** rather than on the post itself. Letting `fetch` follow redirects
loses those, and the failure surfaces much later as data endpoints answering
HTML — which reads as a permissions problem and is not one. The redirect chain
is therefore walked by hand, collecting cookies at every hop.

Getting HTML where JSON was expected always means the session lapsed or the
account lacks rights. It never means there is no data.

> This is not guesswork: the Booking system already pulls from the same Mango,
> and this is the mechanism it established. Where the two differ, Booking's
> working integration wins.

## Where to run it from

Not from a development container: the egress policy there refuses
`chaithanin.mangoanywhere.com` outright, so the pull cannot reach Mango at all.
The deployment VM can, and so can Google Cloud Shell, which is the quickest way
to try it against the real service:

```bash
git clone -b claude/global-top-financial-dashboard-2jrq6e \
  https://github.com/chaithanin/Acc.git && cd Acc
npm ci
npm run mango:pull -- --dry-run
```

`npm` reads `package.json` from the directory it is run in, so run it inside the
clone — a fresh shell opens in the home directory, where there is no project and
the error is about a missing `package.json` rather than anything to do with
Mango.

A dry run needs no database and no `--company`, which is what makes it a
reasonable thing to do from a scratch machine: it signs in, reports what the
account can see, and writes nothing anywhere.

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

**A superseded row is not a second contract.** When a unit is rebooked Mango
keeps the old row in the same list, marked `active = N`, rather than removing
it. Summing without checking reports the same unit twice, at a value nobody ever
owed. The rule is *exclude what is marked N* rather than *keep what is marked
Y*: a build that stops sending the column would otherwise retire every row at
once and report a whole company as zero, with no error anywhere.

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

## What this pull does not know: Holding

`All_Transaction_Data` carries no Holding status. A unit a salesperson is
holding therefore appears in this pull as though nothing has happened to it —
Booking found 47 such units in LOVEIT-D alone, reachable only through
`Api/Public/LastTransaction`.

For the figures here that is harmless: a hold is not money owed, and nothing in
the receivable ledger or the price list is affected. It matters for **inventory**
— how many units are actually free to sell — and that is a question the
[Booking API](BOOKING-API.md) answers properly, with its own `HOLDING` status.
So the gap is covered, by the other connector rather than by this one.

Do not build a unit-availability figure on this pull. It will be wrong by
however many units are on hold, and it will look right.

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

## Three applications, one sign-in

Mango is not one application but three, on one host, and knowing which is
which saves a long detour:

| Path | What it is |
|---|---|
| `production.re` | the estate-sales module — serves both its screens and its own data, and is what the pull reads |
| `production.anywhere` | a Vue front end for the accounting system. **Screens only.** Every data path asked of it answers 404, correctly |
| `production.service` | the API that front end calls — `Anywhere/{Area}/{Action}` |

One sign-in covers all three, because the session cookies are set for the host
rather than for a path. The service application wants an `x-mango-auth` header
as well as the cookies; the sign-in hands that token over, so it is picked up
automatically — and `MANGO_AUTH_TOKEN` supplies one by hand if a future build
stops doing that.

`production.service/Anywhere/Center/MenuDisplay?module_=FIN&lang_code=EN` is
what the front end calls to draw its own navigation, which makes it the system
describing itself: one authoritative answer per module instead of guessing at
endpoint names. `npm run mango:probe` asks it for every module in turn.

## The other module

`production.re` is the estate-sales module, and it is the one this pull reads.
The same Mango also serves **`production.anywhere`** — a different module with
its own screens, reached at `/production.anywhere/page/`.

Nothing here reads it yet, and it is worth finding out what it holds, because
the gap it might fill is a real one: the **cost budget, revised budget and
committed cost** of every project are still typed in by hand in Settings. Both
pulls deliberately leave those alone, because neither source knows them. If the
other module holds budgets and commitments, that is the last hand-typed figure
on the page.

```bash
npm run mango:probe
```

The probe surveys it and reports what it found, in a form that can be pasted
back into a conversation. It keeps three rules:

- **It discovers rather than guesses.** Mango's Vue pages name the endpoints
  they call, so the pages are read and those names followed — including one
  level down through the screens the root page links to, and **into the scripts
  each page loads**, which is where most of the names actually are. The module
  is a Vue application: its pages are a few kilobytes of shell and the endpoint
  names live in the bundle. Reading only the HTML finds two names and concludes
  the module holds nothing, which is the wrong conclusion to hand somebody.
  Inventing plausible URLs instead produces a wall of 404s and teaches nothing.
- **It separates what Mango calls from what merely looks like a path.** A string
  inside a `$_get` or `$_post` is an endpoint; a string that happens to contain
  a slash usually is not. Both are followed, the confident ones first, so a
  short list of real answers is not buried in route names.
- **It says what every answer was**, not only the ones that held data. "Nothing
  answered" cannot be told apart from looking in the wrong place or a lapsed
  session unless the refusals and 404s are counted too.
- **It reads and never writes.** Anything whose name suggests it changes
  something is skipped without being called, and listed at the end so the
  skipping is visible rather than silent.
- **It prints structure, not content** — column names and row counts, never the
  values in them. The output is meant to be shared, and this is a live finance
  system.

It signs in exactly as the pull does, so the same service account and
`MANGO_MAINCODE` apply, and the same audit log records it. Point it elsewhere
with `MANGO_ANYWHERE_URL`, and start from a different page with
`--entry <path>` if the root turns out to name nothing.

## Staying a guest

Only read endpoints are called. Nothing in this client posts to a save or update
action, and it should stay that way: this system reports on Mango's data, it is
not a second way to edit it. Tell Mango Consultant that the connection exists, so
a nightly pull is not read as anomalous traffic.

There is also an official API — `rex_settings/api_tokens` already holds one
active token — but no published documentation for it. Worth asking for in
parallel: if it arrives, only the authentication layer here changes and
everything downstream of it stays as written.
