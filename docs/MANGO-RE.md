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

## Reading the warnings

A receipt whose contract is not in the receivable list has several causes and
only one of them matters. A refund against a cancelled booking belongs outside
the list; so does a payment against a booking that was replaced. But a receipt
filed against a contract that is **absent from the pull entirely** means
somebody paid against a contract this account cannot see — the pull is short,
and so is every figure taken from it.

The run separates them, and raises the last as an error of its own
(`MANGO_INCOMPLETE_PULL`) rather than as a line in a tally. It is the symptom
that the service account's project rights are too narrow, and it is the only
place that symptom shows.

An overpayment warning on **one** contract — receipts exceeding the contract
value — is usually either a contract revised down after payment or a receipt
filed against the wrong contract. Both are worth a look and neither is this
system's to fix.

Across the **whole pull** it is a different finding and is raised as an error.
The first live run collected 2.71bn against contracts of 2.59bn and reported
an outstanding balance of minus 118 million, as though the company's customers
were owed money. Not every receipt filed against a contract is a payment of it:
transfer fees, common area charges and tax are filed the same way. The run
therefore prints the receipts broken down by the kind Mango files them under,
and which of those count as payment of the contract price is an accounting
decision for somebody to make — not a coercion for this code to guess at.

The live pull returned six kinds, named by single letters:

```
   D   10,222   1,518,604,776
   C    1,666     546,579,511
   T      793     259,128,421
   R    3,287     242,198,674
   B    1,086     168,805,568
   O        1             910
```

The run does the arithmetic that turns that list into a question worth asking:
leave one kind out, and say what the outstanding balance becomes. Exactly one
of them turns the negative balance positive, which makes the question "is that
kind a payment of the contract price?" — answerable by the accounts department
in a sentence — rather than "why is this figure negative?".

Counting `B,C,D,T` gives an outstanding balance of 123,686,942 against
contracts of 2,593,767,505 — 4.8%, which is the shape a real figure has — and
drops the overpayment findings from about 749 to about 217. `T` averages
326,769 across 793 receipts, which is the size of a transfer instalment rather
than a fee, and `R` averages 73,675 across 3,287, more than three per contract,
which is the shape of a recurring charge. **That is a reading of the numbers,
not an answer**: only the accounts department can say which letters are
instalments.

Once answered, record it in the command:

```bash
npm run mango:pull -- --payment-kinds B,C,D,T --dry-run
```

Even then about a fifth of contracts still take more than they were for, which
is its own question and is reported as one — and the overages are not small.
Contracts appear that have taken three to six times their value, which no
schedule of fees explains.

The first thing to rule out is this system's own arithmetic. Receipts are
matched to contracts **on the document number alone**, so a number carried by
two live contracts credits both with the whole set of receipts: the same money
counted twice, both contracts reading as overpaid, and the collected total
inflated by the duplicates. Mango's document numbers look like a sequence and a
year — `0013912017` — which is exactly the shape that repeats across projects.

The run checks for it and says so plainly if it finds any. If it does, the
matching needs a second key and the totals need no other explanation; if it
does not, the overpayments are real and belong to the accounts department.

Every kind is still reported, including the ones left out, because excluding a
kind that *is* an instalment overstates what is still owed — the same error in
the other direction, and just as tidy-looking.

One column has already been misread this way. `revise` sits beside
`asking_price` and reads like a revised price; it is the revision number.
Preferring it priced 1,839 units at 24,035 baht in total — about thirteen baht
each — and published that as what the project expects to sell for. The price
list is read from `asking_price` alone now, and a sale value that averages
below 50,000 a unit is refused rather than reported, because that is not a
cheap project, it is the wrong column.

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

Two namespaces live under the service and they are not interchangeable:
`Anywhere/Center/*` holds the navigation, and **`anywhereAPI/Dashboard/*` holds
the figures**. The endpoints below were read off the finance dashboard as it
loaded, which settled in one page what several rounds of surveying could not:

| Endpoint | What it holds |
|---|---|
| `anywhereAPI/Dashboard/balanceArReadList` | receivable balances by counterparty |
| `anywhereAPI/Dashboard/balanceApReadList` | payable balances by counterparty |
| `anywhereAPI/Dashboard/viewArRead?type=MONTH\|QUARTER` | receivables by period |
| `anywhereAPI/Dashboard/viewApRead?type=MONTH\|QUARTER` | payables by period |
| `anywhereAPI/Dashboard/BarchartArRead` · `BarchartAPRead` | the ageing buckets |
| `anywhereAPI/Dashboard/yearDetailARRead` · `yearDetailAPRead` | the year to date |
| `anywhereAPI/Dashboard/view_bank_all_v2?bank_guarantee=N\|Y&company_code=` | bank balances — **`Y` is guarantees, which are not cash** |
| `api/public/LoginCompaniesByUserID?userid=` | which companies an account may open |

That list is most of what this dashboard currently gets by having somebody
export a workbook.

Three observed calls are deliberately **not** made by the probe: the chat
poller, which says nothing about finance and repeats forever; the print
service's warm-up, which exists to have an effect; and
`API/Public/UserInsertLogs`, which writes to somebody's audit trail. A survey
has no business calling any of them.

These figures are **scoped to a company**, and signing in does not settle
which. The sign-in sets the company for the estate module; the service keeps
its own, and the front end points it at one before asking for anything —
`anywhere/center/Maincomp?maincode=…`, alongside a layout config and two
authentication calls. Skip that and the service is signed in and aimed at
nothing: every endpoint answers 200, `success: true`, and an empty list. It
looks exactly like a company with no receivables.

`api/public/LoginCompaniesByUserID?userid=…` lists the companies an account may
open, and answers with the group itself:

| Code | Company |
|---|---|
| MG1 | บริษัท ไชยธนินทร์ จำกัด |
| MG2 | บริษัท เดอะ ซัน ไลท์ เรสซิเด้นซ์ 9 จำกัด |
| MG3 | บริษัท มาริน่า โกลเด้น เบย์ วิคทอเรีย จำกัด |
| MG4 | บริษัท โกลบอล ท็อป กรุ๊ป จำกัด |
| MG5 | บริษัท มาริน่า โกลเด้น เบย์ เอลย่า จำกัด |
| MG6 | บริษัท มาริน่า โกลเด้น เบย์ เจนีวา จำกัด |

Which company a figure belongs to is the first thing to know about it, and
these codes are the same ones the sign-in takes as `maincode`. They line up
with the estate module's projects — MG3 is the company behind Marina Golden
Bay Victoria — so the two sources can be reconciled company by company rather
than by name matching.

Not all of the service answers on cookies alone. The split is by namespace:
`api/public/*` and `API/UserOnline/*` answer signed in, while `Anywhere/Center/*`
and `anywhere/center/*` want the `x-mango-auth` header and refuse with 403
without it. That refusal includes `Maincomp` — so without the token the company
is never switched, and the figures below are empty for that reason rather than
for a real one.

The token appears to be minted during the bootstrap itself rather than at
sign-in, which makes the order circular: the call that switches company is
refused before the call that hands over the token has been made. The probe runs
the sequence, keeps any token any step hands over, and asks the refused ones
again.

Not every endpoint needs the `x-mango-auth` header — `api/public/*` answers on
cookies alone. What the service does need is the **full** cookie set, and part
of it is only issued once the front end has been visited. Asking the service
before ever opening the front end is answered with 403 for everything, which
reads as a rights problem and is not one; the probe therefore reads the front
end first and asks afterwards.

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
