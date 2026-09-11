import { round2 } from '@/lib/calc/aggregate';
import type { ImportIssue, SourceRef } from '@/lib/types';
import {
  OFF_MARKET_CODES,
  PIPELINE_CODES,
  SOLD_CODES,
  type BookingAgencySale,
  type BookingUnit,
} from './types';

/**
 * Turning the Booking inventory into figures this system can report.
 *
 * Booking and Mango RE answer different questions and this mapper is careful
 * not to blur them. Mango holds the money — contracts, receipts, transfers,
 * targets — and remains the source of every financial figure. Booking holds
 * the inventory: which units exist, what they are priced at, and how far
 * along the funnel each one is. Nothing here is written as a receivable or as
 * income, because a unit marked sold in Booking is not a receipt of anything;
 * the contract in Mango is what says money is owed.
 *
 * What it does produce is the board figure — what a project expects to sell
 * for — and a count of where the units stand, which is the denominator every
 * take-up percentage on the dashboard needs.
 *
 * Two decisions here are worth stating outright.
 *
 * A unit is priced three times, once per buyer quota, and the quota says which
 * price is the real one. Reading `price.tc` for everything understates a
 * foreign-quota sale wherever the foreign price is set higher, which is the
 * usual arrangement — LOVEIT sets it 8% above.
 *
 * "Booked" means two opposite things depending on which field it is read
 * from. In `status` it is the salesperson's word for sold; in `statusCode` it
 * means waiting for payment, one step earlier. Everything below reads the
 * code, and `status` is carried through untouched for display only.
 */

export interface BookingMapOptions {
  /** The date this pull represents. */
  reportDate: string;
  /** Acc project id per Booking project name, where one is known. */
  projectIdByName?: Map<string, string>;
}

export interface ProjectInventory {
  project: string;
  projectId: string | null;
  /** Units on the market: everything except blocked, not-in-this-round and maintenance. */
  sellable: number;
  sold: number;
  pipeline: number;
  available: number;
  offMarket: number;
  /**
   * What the project expects to sell for.
   *
   * Every sellable unit at the price its own quota implies — the figure the
   * revenue-recognition percentage divides by, and the one somebody has been
   * typing into Settings by hand.
   */
  saleValue: number;
  /** Value of the units already sold, at the same quota-aware prices. */
  soldValue: number;
  /** Units carrying no price in any quota, so contributing nothing to the value. */
  unpriced: number;
}

export interface BookingMapResult {
  inventory: ProjectInventory[];
  agencies: BookingAgencySale[];
  issues: ImportIssue[];
  counts: { units: number; projects: number; unpriced: number; offMarket: number };
}

/**
 * The price that applies to a unit.
 *
 * A unit that has been taken by a buyer is priced by that buyer's quota. One
 * still on the market has no buyer yet, so it is valued at the Thai-company
 * price, which is the list price the project publishes — not the highest of
 * the three, which would flatter the total.
 */
export function priceFor(unit: BookingUnit): number | null {
  const p = unit.price ?? { tc: null, tq: null, fq: null };
  const quota = (unit.quota ?? '').toUpperCase();

  const chosen =
    quota === 'FQ' ? p.fq
    : quota === 'TQ' ? p.tq
    : quota === 'TC' ? p.tc
    : null;

  // Fall back down the list rather than reporting nothing: a unit with no
  // quota recorded is still worth its list price.
  const value = chosen ?? p.tc ?? p.tq ?? p.fq ?? null;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Where a figure came from, said the way the rest of the system says it. */
const ref = (sheet: string, note: string): SourceRef => ({
  file: 'Booking API — /units',
  sheet,
  row: 0,
  col: 1,
  cell: `${sheet}!${note}`,
});

const isSold = (code: string) => SOLD_CODES.includes(code);
const isPipeline = (code: string) => PIPELINE_CODES.includes(code);
const isOffMarket = (code: string) => OFF_MARKET_CODES.includes(code);

export function mapBookingUnits(
  units: BookingUnit[],
  agencies: BookingAgencySale[] = [],
  options: BookingMapOptions,
): BookingMapResult {
  const issues: ImportIssue[] = [];
  const byProject = new Map<string, ProjectInventory>();

  let unpricedTotal = 0;
  let offMarketTotal = 0;
  const unknownCodes = new Set<string>();

  for (const unit of units) {
    const name = (unit.project ?? '').trim();
    if (!name) continue;

    let row = byProject.get(name);
    if (!row) {
      row = {
        project: name,
        projectId: options.projectIdByName?.get(name) ?? null,
        sellable: 0, sold: 0, pipeline: 0, available: 0, offMarket: 0,
        saleValue: 0, soldValue: 0, unpriced: 0,
      };
      byProject.set(name, row);
    }

    const code = String(unit.statusCode ?? '').toUpperCase();
    if (!code) continue;

    if (isOffMarket(code)) {
      row.offMarket += 1;
      offMarketTotal += 1;
      continue;
    }

    if (!isSold(code) && !isPipeline(code) && code !== 'AVAILABLE') {
      // An unrecognised code is counted as on the market rather than dropped:
      // a unit that exists and is not blocked is inventory, and silently
      // losing it would shrink the denominator of every take-up figure.
      unknownCodes.add(code);
    }

    row.sellable += 1;
    if (isSold(code)) row.sold += 1;
    else if (isPipeline(code)) row.pipeline += 1;
    else if (code === 'AVAILABLE') row.available += 1;

    const price = priceFor(unit);
    if (price === null) {
      row.unpriced += 1;
      unpricedTotal += 1;
      continue;
    }

    row.saleValue = round2(row.saleValue + price);
    if (isSold(code)) row.soldValue = round2(row.soldValue + price);
  }

  const inventory = [...byProject.values()].sort((a, b) => b.saleValue - a.saleValue);

  if (unpricedTotal > 0) {
    issues.push({
      severity: 'warning',
      code: 'BOOKING_UNPRICED_UNIT',
      message:
        (unpricedTotal === 1
          ? '1 unit on the market carries no price in any quota. It is counted in the unit totals '
            + 'but adds nothing to what the project expects to sell for, so that figure is short by '
            + 'its value.'
          : `${unpricedTotal} units on the market carry no price in any quota. They are counted in `
            + 'the unit totals but add nothing to what the project expects to sell for, so that '
            + 'figure is short by their value.'),
      source: ref('units', 'price'),
    });
  }

  if (unknownCodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'BOOKING_UNKNOWN_STATUS',
      message:
        `Booking used status code${unknownCodes.size === 1 ? '' : 's'} this system does not know: `
        + `${[...unknownCodes].join(', ')}. They are counted as on the market but not as sold or as `
        + 'pipeline, so the funnel does not add up to the unit total until they are classified.',
      source: ref('units', 'statusCode'),
    });
  }

  const unmatched = inventory.filter((row) => !row.projectId).map((row) => row.project);
  if (unmatched.length > 0 && options.projectIdByName) {
    issues.push({
      severity: 'info',
      code: 'BOOKING_UNMATCHED_PROJECT',
      message:
        `${unmatched.length} Booking project${unmatched.length === 1 ? '' : 's'} match no project here: `
        + `${unmatched.join(', ')}. Add the name as an alias in Settings › Projects to place `
        + `${unmatched.length === 1 ? 'it' : 'them'}.`,
      source: ref('projects', 'project'),
    });
  }

  return {
    inventory,
    agencies,
    issues,
    counts: {
      units: units.length,
      projects: inventory.length,
      unpriced: unpricedTotal,
      offMarket: offMarketTotal,
    },
  };
}

/**
 * Where Booking and Mango disagree.
 *
 * Both systems know what a project expects to sell for, and they arrive at it
 * differently — Booking by pricing its inventory, Mango by summing its active
 * price list. When they differ, one of them is behind, and which one is a
 * question somebody has to answer rather than something to paper over by
 * picking a winner. So this reports the gap and leaves the figures alone.
 */
export interface SaleValueDisagreement {
  project: string;
  booking: number;
  mango: number;
  difference: number;
  /** The gap as a share of the larger figure, which is what makes it worth reading. */
  share: number;
}

export function compareSaleValue(
  booking: Map<string, number>,
  mango: Map<string, number>,
  tolerance = 0.01,
): SaleValueDisagreement[] {
  const out: SaleValueDisagreement[] = [];

  for (const [project, bookingValue] of booking) {
    const mangoValue = mango.get(project);
    if (mangoValue === undefined) continue;

    const larger = Math.max(bookingValue, mangoValue);
    if (larger === 0) continue;

    const difference = round2(bookingValue - mangoValue);
    const share = Math.abs(difference) / larger;
    if (share <= tolerance) continue;

    out.push({ project, booking: bookingValue, mango: mangoValue, difference, share });
  }

  return out.sort((a, b) => b.share - a.share);
}
