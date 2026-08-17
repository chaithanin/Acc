/**
 * Performance targets shown beside the ratio and margin KPIs.
 *
 * Data, not literals in a component, so Finance can change what "good" means
 * without a code change once a settings screen is added for them.
 */
export const TARGETS = {
  /** Net profit margin, as a percentage. */
  netProfitMargin: 12,
  /** Quick ratio floor — liquid assets against short-term obligations. */
  quickRatio: 1,
  /** Current ratio floor. */
  currentRatio: 3,
} as const;

export const TARGET_LABELS: Record<keyof typeof TARGETS, string> = {
  netProfitMargin: 'Net Profit Margin Target',
  quickRatio: 'Quick Ratio Target',
  currentRatio: 'Current Ratio Target',
};
