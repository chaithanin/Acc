# Customer Card Report

Turns the sales system's **ลูกหนี้คงค้าง** (outstanding receivable customer card)
into the **Interest / Advance-received** workbook Finance keeps by hand.

`/reports/customer-card` → upload the card → the workbook downloads and the
reconciliation stays on screen.

## What it produces

Six sheets. The first four are laid out as `Interest-Advance received_SUN9`:

| Sheet | What it holds |
|---|---|
| `InsPlan` | One row per unit: what is due, in the month it falls due, plus the transfer instalment on **On Key**. Below it the same plan at future value, with the effective interest rate solved for each unit. |
| `InsPaid` | The same units, with the cash that actually arrived, in the month it arrived. |
| `%sellingprice` | The uplift, straight-line in months remaining to completion. |
| `Interest expense recognition` | Interest on the advance month by month, capped at the interest the plan carries, with the year-end journal entries. |
| `Data_Check` | Every unit reconciled against the card, the totals, and the assumptions still to be confirmed. |
| `Raw_AR_<date>` | The source rows exactly as they were read — the audit trail. |

## The two matrices are not the same matrix

This is the mistake the report exists to avoid.

- **InsPlan** buckets `จำนวนเงินที่ต้องชำระ` by `วันครบกำหนดชำระเงินตามสัญญา`.
- **InsPaid** buckets `จำนวนเงินที่ชำระแล้ว` by `วันที่ชำระ`.

Neither falls back on the other. An instalment due in March and paid in June is
in March on one sheet and June on the other; a payment with no payment date is
reported and left out of InsPaid rather than filed under its due date.

## Receipts split across instalments

One receipt is routinely applied to several instalments and so appears on
several rows, each carrying the part applied to that instalment. Those parts
are **summed** — they are what add up to the cash received, and dropping a
repeat would drop real money.

What is reported is the shape that cannot be told apart from a data-entry
duplicate: the same receipt, the same amount, the same day, on the same unit,
twice. Both amounts are included and a `RECEIPT_DUPLICATE_SUSPECTED` warning
asks a human, because resolving it either way silently is wrong some of the
time.

## The transfer instalment

A handover payment is due "on transfer", which has no scheduled month. It goes
in its own **On Key** column rather than being dropped for want of a date —
dropping it leaves every unit's plan roughly half short of its contract price,
and `Total unit price − Sale Price` is the check that catches exactly that.

## What is a formula and what is a value

Everything derived is written as a **formula**: change the completion date or
the uplift and every expected price, rate and interest figure follows.

Two things are values:

- data read from the customer card;
- the **effective interest rate**, which is the result of a search. Excel
  reaches it with Goal Seek and stores the answer; there is no formula that
  expresses it, and the original template holds it as a constant for the same
  reason. It is solved by bisection so that
  `FV(instalments) + On Key = expected selling price`, exactly the identity the
  template's `Total unit price` column asserts.

The file is written with `fullCalcOnLoad`, because the formulas carry no cached
result — this process has not evaluated them. Without it the workbook opens
with every derived figure blank.

## The two assumptions

Neither is in the customer card:

- **expected building completion** (default 2028-09-30)
- **selling-price uplift over the whole schedule** (default 20%)

Both are carried over from the previous report, both are editable on the page,
and both are listed under **REVIEW REQUIRED** on `Data_Check` until Finance
confirms them. They are never inferred from the data.

When a unit's solved rate comes out above 25% the report says so
(`EIR_IMPLAUSIBLE`): the arithmetic is right, but a rate that high means the
uplift is being carried by a small part of the plan, which is what happens when
the completion date does not match the schedule the card contains.

## Nothing is stored

The report reads a file and returns a file. The uploaded card is deleted before
the response is sent — it is a list of buyers and what they still owe — and
nothing reaches the financial tables. Putting it through the import pipeline
would make it a source of dashboard figures, which it is not.

## Reading the card

Columns are matched on their header wording, not their position, and the header
row is found by scoring rather than assumed. `ราคาขายสุทธิ` is tried before
`ราคาขายตามสัญญา`, or the net price would be claimed by the contract price.

Unit, contract, customer and price are printed once per block and left blank on
the instalment lines beneath, so they are carried down — and **reset when the
unit changes**, or one buyer's price ends up on another's contract.
