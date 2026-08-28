/**
 * The accounting policy this dashboard reports under.
 *
 * Written down here, in one file, because the alternative is a policy that
 * exists only as the shape of the arithmetic — which is how a dashboard ends
 * up reporting an 83% net margin on a property development and nobody being
 * able to say which rule produced it.
 *
 * Everything here is a decision the group's auditors have to agree with. It is
 * data, not logic, so agreeing to a different one is an edit rather than a
 * rewrite.
 */

/**
 * How revenue is recognised.
 *
 * `percentage_of_completion` — revenue is earned as the building is built.
 *   Recognised revenue is the contracted value multiplied by the share of the
 *   construction contract certified complete. This is the method the imported
 *   data actually supports: the BOQ sheets carry both the contract value and
 *   the value certified to date, which is a measured input rather than an
 *   estimate someone types in.
 *
 * `on_transfer` — revenue is earned when the unit transfers to the buyer.
 *   Closer to how most Thai condominium developers report under TFRS 15, and
 *   selectable here, but it needs a transferred flag per unit that the current
 *   imports do not carry. Choosing it without that data reports nothing rather
 *   than guessing.
 *
 * `booking_value` — the old behaviour, kept only so the change is visible:
 *   the whole contracted value is treated as earned the moment it is signed.
 *   It is not a recognition basis and the dashboard says so when it is set.
 */
export type RevenueBasis = 'percentage_of_completion' | 'on_transfer' | 'booking_value';

/** How completion is measured for the percentage-of-completion basis. */
export type CompletionBasis = 'boq_certified' | 'cost_incurred';

export interface AccountingPolicy {
  revenueBasis: RevenueBasis;
  completionBasis: CompletionBasis;
  /**
   * Receivable categories that are consideration for the unit itself.
   *
   * A reservation fee and a transfer fee are not part of the selling price in
   * the same way an instalment is, and including them in the contracted value
   * that revenue is recognised against overstates it.
   */
  salePriceCategories: readonly string[];
  /** Expense categories that are the direct cost of what was sold. */
  directCostCategories: readonly string[];
  /** Expense categories that are capital rather than operating. */
  capitalCategories: readonly string[];
  /**
   * How stale the newest import may be before the dashboard says so, in days.
   * A month-end close that runs to the tenth working day gives about this.
   */
  freshnessDays: number;
  /** Difference at or below this is rounding, not a variance. In baht. */
  roundingTolerance: number;
  /** Receivable ageing buckets, in days past due. */
  ageingBuckets: readonly { label: string; from: number; to: number | null }[];
}

export const POLICY: AccountingPolicy = {
  revenueBasis: 'percentage_of_completion',
  completionBasis: 'boq_certified',
  salePriceCategories: ['contract', 'down_payment'],
  directCostCategories: ['construction', 'contractor', 'material'],
  capitalCategories: ['land', 'capital'],
  freshnessDays: 45,
  roundingTolerance: 1,
  ageingBuckets: [
    { label: 'Current', from: -Infinity, to: 0 },
    { label: '1–30', from: 1, to: 30 },
    { label: '31–60', from: 31, to: 60 },
    { label: '61–90', from: 61, to: 90 },
    { label: '91–120', from: 91, to: 120 },
    { label: '120+', from: 121, to: null },
  ],
};

export const REVENUE_BASIS_LABELS: Record<RevenueBasis, string> = {
  percentage_of_completion: 'Percentage of completion',
  on_transfer: 'On transfer of ownership',
  booking_value: 'Booking value (not a recognition basis)',
};

/** One sentence for the dashboard, so the reader knows what they are reading. */
export const REVENUE_BASIS_NOTES: Record<RevenueBasis, string> = {
  percentage_of_completion:
    'Revenue is earned as the building is built. Contracted sale value is multiplied by the share of the construction contract certified complete.',
  on_transfer:
    'Revenue is earned when a unit transfers to its buyer. Requires a transferred flag per unit, which the current imports do not carry.',
  booking_value:
    'Every contract is treated as earned in full the moment it is signed. This is not a recognition basis and the profit it produces is not comparable with the statutory accounts.',
};
