# Reading the accounting figures out of Mango Anywhere

```bash
npm run anywhere:pull -- --dry-run
```

There is an API. The reason this needs a browser is narrower and stranger than
"no API", and worth stating exactly, because it decides what any future
approach has to do.

## Why a browser

Mango is three applications on one host. `production.anywhere` is a Vue front
end and serves screens only. `production.service` is the API behind it, and the
figures are there. Signing in from a script gets cookies the service accepts
for `api/public/*` and refuses, with 403, for `Anywhere/Center/*` — including
`Maincomp`, the call that points the session at a company. Without that call
every figure answers `200`, `success: true`, and an empty list, which looks
exactly like a company with no receivables.

What those endpoints want is an `x-mango-auth` header, and the token is **bound
to the session that minted it**. A token lifted out of somebody's browser is
refused, because it belongs to their session and not to this one — tried, and
that is what happens. What mints it is the front end's own JavaScript.

So this runs the front end, once, to have it authenticate itself.

## What it is not

It is not screen scraping. Nothing here reads a rendered table, waits for a
grid to paint, or clicks through a report to an Excel export. The browser does
one job — sign in, and let the application's start-up mint a token — and the
token is then taken off the application's own network traffic and used to call
the same JSON endpoints the application calls.

That distinction is the difference between a fragile integration and a durable
one. The data arrives as JSON with its column names intact, so a redesigned
screen changes nothing here; only a changed endpoint would.

## What it reads

Every endpoint was observed being called by the finance dashboard itself:

| | |
|---|---|
| `balanceArReadList` · `balanceApReadList` | receivable and payable balances by counterparty |
| `viewArRead` · `viewApRead` | the same, by month |
| `BarchartArRead` · `BarchartAPRead` | the ageing buckets |
| `yearDetailARRead` · `yearDetailAPRead` | year to date |
| `view_bank_all_v2` | bank balances, asked twice — `bank_guarantee=Y` is guarantees, which are **not** cash |

Three observed calls are deliberately not made: the chat poller, which says
nothing about money and repeats forever; the print service's warm-up, which
exists to have an effect; and `API/Public/UserInsertLogs`, which writes to
somebody's audit trail.

## Running it

```
MANGO_USER, MANGO_PASS     a service account, not a person's login
MANGO_MAINCODE             the company to read — MG1..MG6, default MG1
```

Flags: `--company <code>` for the dashboard company, `--date`, `--dry-run`,
`--save <file>` to keep the raw answers, `--headed` to watch it work.

It needs a Chromium, and finding one is where this fails first in practice.

Playwright looks for the exact build its own version shipped with, so a machine
that already has a Chromium usually has the wrong one — that is not a missing
browser, and the error Playwright raises for it sends people to reinstall what
they already have. And `npx playwright install` is itself the first thing to
fail on a machine with a small disk or restricted egress, which is what happens
in Cloud Shell.

So the pull looks in three places, in order: where Playwright keeps its
browsers, then **anything on `PATH`** — `chromium`, `chromium-browser`,
`google-chrome`, Edge — and then Playwright's own default. It prints which it
chose. A Chromium from the distribution's packages loads one page perfectly
well:

```bash
sudo apt-get update && sudo apt-get install -y chromium   # Debian, Ubuntu
sudo dnf install -y chromium                              # Fedora, RHEL
```

`CHROMIUM_PATH=/path/to/chrome` overrides all of it. `npx playwright install
--with-deps chromium` is still the tidiest answer where it works.

Two more things go wrong at this step, both of which announce themselves badly.

Chromium's **sandbox** needs kernel features a hosted shell or a container
often does not grant, and without them it fails as "the browser has been
closed", which says nothing about sandboxes. Dropping the sandbox is a real
reduction in isolation, so it is not the default: the pull tries with it, and
falls back without it while saying so.

On Ubuntu — Cloud Shell included — **`chromium` and `chromium-browser` are
both transitional packages whose binaries are shell scripts handing off to a
Snap**, and a Snap cannot run in a hosted shell. `apt-get install chromium`
reinstalls the same wrapper, so there is no apt route to a real Chromium there
at all.

The pull tells that apart from the ordinary case, which matters because
**Google Chrome's own launcher is a shell script too** — its `.deb` installs
`/usr/bin/google-chrome` as a few lines that exec `/opt/google/chrome/chrome`,
and that is a perfectly good browser. "Is it a script" is therefore the wrong
question; "does it lead to a binary that exists" is the right one.

So the lookup reads a launcher script and follows it, takes the binary it
names, and only reports a dead end when a script leads nowhere — or into
`/snap`, which it names as such. It also looks straight at where the packages
put their binaries (`/opt/google/chrome/chrome` and friends) before consulting
`PATH` at all, since that is the answer rather than a signpost to it.

Google Chrome ships a real binary in a `.deb`:

```bash
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
```

Then run the pull again — `google-chrome` is found on `PATH`. In Cloud Shell
this has to be repeated each session, since the machine is ephemeral; on a real
VM it is installed once.

## Keeping it to itself

This runs inside a company network against a finance system, so the browser is
given nothing to do but the job. Requests to any host but Mango's are refused
at the page level and what was refused is reported, so a page that turns out to
need something external says so rather than failing quietly.

One honest limit: Chromium's own process attempts a couple of Google
connections at start-up — an update check and a connectivity probe — which
neither the launch flags nor page-level interception reliably prevent. They
carry nothing of Mango's, and on a network with restricted egress they simply
fail. If that matters for an audit, the answer is the network policy rather
than a browser flag.

## Testing it without touching live data

```bash
node scripts/anywhere-stub.mjs
MANGO_ANYWHERE_URL=http://127.0.0.1:4380/production.anywhere \
MANGO_SERVICE_URL=http://127.0.0.1:4380/production.service \
MANGO_USER=svc.dashboard MANGO_PASS=stub-password \
  npm run anywhere:pull -- --dry-run
```

The stub is three applications on one origin like the real one, and it refuses
every service call without the header — so a pull that fails to obtain the
token fails the test rather than passing it.

## What the columns turned out to be

Read off a live answer for MG2, and the mapping is written against these rather
than against their names:

| Answer | Columns |
|---|---|
| receivable balances (27 rows) | `maincode, customer_code, customer_name, total_inv, total_amt, balance_amt, grade_customer` |
| payable balances (79 rows) | `mainname, acct_no, cust_name, total_inv, total_amt, balance_amt, grade_vender` |
| receivables by month (143) | `maincode, rl_year, rl_month, receipt_net_amount` |
| payables by month (31) | `maincode, pay_year, pay_month, pay_amount` |
| receivable ageing (3) | `grade_inv, balamt` — one row per band |
| payable ageing (1) | `Grade_A, Grade_B, Grade_C, Grade_D` — one row, a column per band |
| bank balances (11, 25 columns) | `account_name, ac_code, name, name_eng, branch_name, account_code, expenses, income, suspense, balamt, begamt, begdate, …` |

Four things in that list decide how it is read.

**Nothing says what came in.** There is what was invoiced and what is still
owed, so collected is the difference — the only honest reading available. Where
a customer owes *more* than was invoiced the subtraction is impossible, and the
row reports that rather than a negative payment.

**The two ageing screens return different shapes.** One row per band for
receivables, one row with a column per band for payables. Assuming they match
is how one of them silently becomes empty.

**A guarantee is not cash.** It comes from the same endpoint with one parameter
changed, which makes adding it to the cash position the easy mistake. It is
counted, kept out, and reported.

**`total_inv` is not used in any figure**, and the run says so on every pull
along with whether it looks like a count or an amount. That is the lesson from
the estate side, where a column called `revise` beside `asking_price` was taken
for a revised price, was the revision number, and priced 1,839 units at
thirteen baht each.

The monthly figures are **cash moved, not revenue raised**, and are deliberately
not written into the income or expense ledgers: the balances already carry the
invoiced amounts, and filing both would report the invoices plus the payments
for those same invoices.

## What is not written yet

Persisting into the database. These figures are a **position** — what is owed
today — where the import pipeline stores a period's records, and where a
balance belongs among the uploaded workbooks is a decision rather than a
coercion. Writing them beside the GL exports that already carry the same
balances is precisely the double count the reconciliation rules exist to catch.

And before any of it is scheduled: **ask Mango for the official API**, which
this system already has a tokens page for. See
[`MANGO-API-REQUEST.md`](MANGO-API-REQUEST.md). A browser holding a session open
is a reasonable way to obtain figures nobody can otherwise reach; it is not a
reasonable thing to depend on every morning at six.
