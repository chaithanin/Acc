# Reading the unit inventory from the Booking API

`booking.chaithanin.com` publishes a read-only REST API with a written guide, a
version, bearer keys, scopes, pagination and a stated rate limit. After Mango
RE — whose internal endpoints work but promise nothing — this is the easy one.

```bash
npm run booking:pull -- --dry-run              # look
npm run booking:pull -- --company GTG          # and then write
```

---

## It is not a replacement for Mango

The two systems answer different questions and the pull keeps them apart.

**Mango RE holds the money.** Contracts, receipts, transfers, cancellations,
monthly targets. Every financial figure on the dashboard comes from there, and
nothing in this pull is written as a receivable or as income — a unit marked
sold in Booking is not a receipt of anything. The contract in Mango is what says
money is owed.

**Booking holds the inventory.** Which units exist, what they are priced at, and
where each one stands in the funnel. That is the denominator every take-up
percentage needs, and it is the thing Mango is worst at: Mango knows about a
unit once somebody has booked it.

They overlap in exactly one figure — what a project expects to sell for — and
they get to it by different routes, Booking by pricing its inventory and Mango
by summing its active price list. `compareSaleValue()` reports the gap rather
than resolving it. A disagreement means one system is behind the other, and
which one is a question for a person, not something to settle by preferring
whichever pull ran last.

## The key

Ask the Booking administrator for a key **for this system only** — one system,
one key, so it can be revoked on its own — with these scopes:

| Scope | Why |
|---|---|
| `read:projects` | `/me` and `/projects`; also how the run checks its own connection |
| `read:units` | the inventory itself, which is the point |
| `read:agencies` | agency sales totals — optional, and the pull skips them rather than failing if the key lacks it |

`read:units:pii` is **not** requested and should not be granted. It adds customer
names and phone numbers to every unit, and this system has no screen that needs
them; holding personal data it does not use is a liability and nothing else.

```
BOOKING_API_KEY=<the key, beginning bk_live_>
BOOKING_API_URL=  # optional, defaults to the published base URL
```

The key is shown once and stored only as a hash, so a lost key is a reissued key.
Keep it in the environment: `.env` and `.env*.local` are git-ignored, and on the
deployment VM it belongs in the container's environment rather than the image.

The run refuses a key that does not begin `bk_live_`, and refuses one that is
still the placeholder from these instructions, because both otherwise arrive as
a 401 several steps later — which reads as "the key was revoked" and sends
somebody to ask for a new one.

## Flags

| Flag | What it does |
|---|---|
| `--company <code>` | which company in the dashboard this belongs to; required unless `--dry-run` |
| `--project <name>` | limit to one Booking project, named as `/projects` spells it |
| `--date YYYY-MM-DD` | the date to file the pull under (default: today) |
| `--dry-run` | fetch, map and report; write nothing |
| `--save <file>` | also write the raw units to disk, for inspection |
| `--force` | write even when the schema check has something to say |

---

## Two things the guide warns about, and what the mapper does with them

### "Booked" means two opposite things

`status` is the wording a salesperson sees; `statusCode` is the stable code.
They disagree on the most important word in the funnel:

| | `status` | `statusCode` |
|---|---|---|
| sold | **Booked** | `SOLD` |
| waiting for payment | Waiting Payment | **`BOOKED`** |

So a report built on `status` counts unpaid units as sales, and a report built
on the *code* without reading the table counts sold units as pipeline. The
mapper reads `statusCode` only, and carries `status` through untouched for
display. There is a test for each direction, because getting one right and the
other wrong is the easy mistake.

Blocked, not-in-this-round and under-maintenance units are excluded from the
sellable count and from the sale value altogether — a blocked unit is not
inventory anybody is trying to sell, and counting it inflates the denominator of
every take-up figure on the page.

### A unit has three prices

Thai law caps foreign ownership at 49% of the saleable area, so each unit is
priced once per buyer type and `quota` says which price applies. Some projects
set the foreign price above the Thai one — LOVEIT by 8% — so reading `price.tc`
for everything understates foreign-quota sales.

| `quota` | Buyer | Price |
|---|---|---|
| `TC` | Thai company | `price.tc` |
| `TQ` | Thai national | `price.tq` |
| `FQ` | Foreign national | `price.fq` |

A unit with no buyer yet has no quota, and is valued at `price.tc` — the
published list price. Not the highest of the three, which would flatter the
total for no reason. A unit carrying no price in any quota is counted in the
unit totals, left out of the value, and reported, so a short total says so
rather than looking like a cheap project.

## What the pull writes

Only one thing: the **total sale value** per project, which is the board figure
the revenue-recognition percentage divides by and which somebody has been typing
into Settings by hand. Cost budget, revised budget and committed cost are left
exactly as they were — Booking knows nothing about them.

Projects are matched by name against the aliases each project already carries,
the same resolution an uploaded workbook goes through. Names that match nothing
are listed at the end; add the name as an alias in **Settings › Projects &
Aliases** to place them.

When a sale value changes, the run prints the old figure and the new one rather
than overwriting in silence.

## Pulling on a schedule

Do not fetch everything every time. The limit is 600 requests a minute and a
full 702-unit project is eight pages at the default page size.

- **For current state** — `updatedSince`, set to the moment the *previous* run
  started (not when it finished, or anything changed while it was running is
  lost). Every 5–15 minutes is plenty.
- **For a record of what happened** — `/events` with the cursor. Ask by
  timestamp and events that happen in the same second as the last one are either
  repeated or lost; the cursor is a position in the sequence and has neither
  problem. Event `id`s are stable, so store the ones already handled and two
  overlapping runs cannot double-count a sale.

`sale_effect` is `+1` entering sold, `-1` leaving it, `0` for a move that does
not touch the total, so agency totals accumulate by addition.

On 429 the client waits the `Retry-After` it was given and no less — retrying
sooner extends the limit rather than shortening the wait. There is a test that
holds it to that.

## Testing without a key

```bash
node --import ./scripts/register-ts.mjs scripts/booking-stub.mjs   # port 4320
BOOKING_API_URL=http://127.0.0.1:4320/api/integration/v1 \
BOOKING_API_KEY=bk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  npm run booking:pull -- --dry-run
```

The stub answers in the documented shape and can be told to behave badly, which
is the part worth having: `STUB_SCOPES='read:projects'` to see what a key missing
a scope reports, `STUB_429=2` to watch the backoff, a wrong key for the 401 path.

`tests/booking-source.test.ts` covers the mapping against a fixture built around
the traps, and runs the real client against a real local server to prove it
follows pagination to the last page and waits out a 429.

## Staying a guest

Every endpoint is a GET and there is nothing here that writes back; bookings and
status changes happen in the Booking system and nowhere else. Tell the Booking
administrator before increasing the frequency or reaching for a new dataset, so
the scope and the ceiling can be set to match.
