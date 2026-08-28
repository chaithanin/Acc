import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAlerts, staleness } from '@/lib/alerts';
import type { MetricComparison } from '@/lib/types';

/**
 * Executive alerts.
 *
 * A list that always has ten things on it is a list nobody reads, so the
 * thresholds here are the ones someone would actually act on. These cases are
 * as much about what does NOT fire as about what does.
 */

const metric = (key: string, current: number | null): MetricComparison => ({
  key,
  label: key,
  section: 'position',
  unit: 'THB',
  current,
  previous: null,
  difference: null,
  differencePct: null,
  formula: '',
  inputs: [],
});

const inputs = (values: Record<string, number | null>, over: Partial<Parameters<typeof buildAlerts>[0]> = {}) => ({
  metrics: new Map(Object.entries(values).map(([k, v]) => [k, metric(k, v)])),
  reportDate: '2026-08-31',
  importedAt: '2026-09-02T10:00:00.000Z',
  now: new Date('2026-09-10T00:00:00.000Z'),
  ...over,
});

const titles = (alerts: ReturnType<typeof buildAlerts>) => alerts.map((a) => a.title);

describe('a healthy month says nothing', () => {
  it('raises no alert when everything is comfortable', () => {
    const alerts = buildAlerts(inputs({
      available_cash: 20_000_000,
      current_liabilities: 5_000_000,
      working_capital: 30_000_000,
      required_funding: 0,
      total_receivable_outstanding: 10_000_000,
      receivable_overdue: 500_000,
      receivable_undated: 0,
      payable_overdue: 0,
    }));

    assert.deepEqual(alerts, [], `expected silence, got ${titles(alerts).join('; ')}`);
  });
});

describe('cash', () => {
  it('is critical when cash covers under half of what is owed', () => {
    const alerts = buildAlerts(inputs({ available_cash: 2_000_000, current_liabilities: 10_000_000 }));
    assert.equal(alerts[0]?.severity, 'critical');
    assert.match(alerts[0]!.title, /less than half/);
  });

  it('is high when cash covers some but not all of it', () => {
    const alerts = buildAlerts(inputs({ available_cash: 8_000_000, current_liabilities: 10_000_000 }));
    assert.equal(alerts[0]?.severity, 'high');
  });

  it('says nothing when cash covers it', () => {
    const alerts = buildAlerts(inputs({ available_cash: 12_000_000, current_liabilities: 10_000_000 }));
    assert.deepEqual(titles(alerts), []);
  });

  it('does not divide by zero when nothing is owed', () => {
    const alerts = buildAlerts(inputs({ available_cash: 0, current_liabilities: 0 }));
    assert.deepEqual(titles(alerts), []);
  });

  it('raises the projected shortfall as its own alert', () => {
    const alerts = buildAlerts(inputs({ required_funding: 4_000_000 }));
    assert.ok(titles(alerts).some((t) => /projection goes below zero/.test(t)));
  });
});

describe('collections', () => {
  it('fires when a quarter of the balance is overdue', () => {
    const alerts = buildAlerts(inputs({
      total_receivable_outstanding: 10_000_000,
      receivable_overdue: 2_600_000,
      receivable_oldest_days: 95,
    }));
    assert.ok(titles(alerts).some((t) => /26% of the receivable balance is overdue/.test(t)));
  });

  it('escalates to critical past half', () => {
    const alerts = buildAlerts(inputs({
      total_receivable_outstanding: 10_000_000,
      receivable_overdue: 6_000_000,
    }));
    assert.equal(alerts.find((a) => /overdue/.test(a.title))?.severity, 'critical');
  });

  it('stays quiet below the threshold', () => {
    const alerts = buildAlerts(inputs({
      total_receivable_outstanding: 10_000_000,
      receivable_overdue: 1_000_000,
    }));
    assert.deepEqual(titles(alerts), []);
  });

  it('flags a balance that cannot be aged at all', () => {
    const alerts = buildAlerts(inputs({
      total_receivable_outstanding: 10_000_000,
      receivable_undated: 3_000_000,
    }));
    assert.ok(titles(alerts).some((t) => /cannot be aged/.test(t)));
  });
});

describe('staleness', () => {
  it('says nothing inside the close window', () => {
    assert.equal(staleness('2026-08-31', null, new Date('2026-09-20T00:00:00Z')), null);
  });

  it('speaks up once the month is overdue', () => {
    const alert = staleness('2026-08-31', '2026-09-02T00:00:00.000Z', new Date('2026-10-31T00:00:00Z'));
    assert.ok(alert);
    assert.equal(alert.severity, 'medium');
    assert.match(alert.detail, /2026-08-31/);
  });

  it('escalates when the figures are months old', () => {
    const alert = staleness('2026-03-31', null, new Date('2026-08-28T00:00:00Z'));
    assert.ok(alert);
    assert.equal(alert.severity, 'high');
    assert.match(alert.title, /months old/);
  });

  it('says nothing when there is no snapshot at all', () => {
    // An empty dashboard is not a stale one, and saying so would send someone
    // looking for an import that was never meant to exist.
    assert.equal(staleness(null, null), null);
  });
});

describe('ordering', () => {
  it('puts the worst first, because that is the one to read', () => {
    const alerts = buildAlerts(inputs({
      available_cash: 1_000_000,
      current_liabilities: 10_000_000,
      payable_overdue: 500_000,
      total_receivable_outstanding: 10_000_000,
      receivable_undated: 3_000_000,
    }));

    const ranks = alerts.map((a) => a.severity);
    assert.equal(ranks[0], 'critical');
    assert.deepEqual([...ranks].sort((a, b) =>
      ['critical', 'high', 'medium', 'information'].indexOf(a)
      - ['critical', 'high', 'medium', 'information'].indexOf(b)), ranks);
  });
});
