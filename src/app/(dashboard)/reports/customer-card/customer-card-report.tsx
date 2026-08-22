'use client';

import { useRef, useState } from 'react';
import { Button, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader, cx } from '@/components/ui/primitives';
import { formatTHB } from '@/lib/format/number';

/**
 * The upload form and what came back.
 *
 * The workbook downloads; the summary stays on screen. Handing back only a file
 * would leave the person who ran it to open it and hunt for the reconciliation
 * before knowing whether it is usable — which is the one thing they need first.
 */

interface Issue {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  unit?: string | null;
  sourceRow?: number | null;
}

interface Summary {
  sourceRows: number;
  contracts: number;
  units: number;
  totalSalePrice: number;
  totalExpectedSellingPrice: number;
  totalPlan: number;
  totalPaid: number;
  totalOutstanding: number;
  totalInterestExpense: number;
  ok: number;
  check: number;
  error: number;
  needsConfirmation: string[];
  sheetName: string;
  headerRow: number;
  issues: Issue[];
}

export function CustomerCardReport({
  defaultProjectLabel,
  defaultCompletionDate,
  defaultUplift,
}: {
  defaultProjectLabel: string;
  defaultCompletionDate: string;
  defaultUplift: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [projectLabel, setProjectLabel] = useState(defaultProjectLabel);
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [completionDate, setCompletionDate] = useState(defaultCompletionDate);
  const [uplift, setUplift] = useState(String(defaultUplift));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const run = async (file: File) => {
    setBusy(true);
    setError(null);
    setSummary(null);
    setFileName(file.name);

    const form = new FormData();
    form.append('file', file);
    form.append('projectLabel', projectLabel);
    form.append('reportDate', reportDate);
    form.append('completionDate', completionDate);
    form.append('maxUplift', uplift);

    try {
      const response = await fetch('/api/reports/customer-card', { method: 'POST', body: form });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'The report could not be produced.');
        return;
      }

      const header = response.headers.get('x-report-summary');
      if (header) setSummary(JSON.parse(decodeURIComponent(header)) as Summary);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Interest-Advance received_${projectLabel}_${reportDate.replaceAll('-', '.')}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`The report could not be produced: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader
          title="Source and assumptions"
          subtitle="The customer card supplies every figure. The two assumptions below do not come from it and are carried over from the previous report."
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput
            label="Project"
            value={projectLabel}
            onChange={(e) => setProjectLabel(e.target.value)}
          />
          <TextInput
            label="Report date"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
          />
          <TextInput
            label="Expected building completion"
            type="date"
            value={completionDate}
            onChange={(e) => setCompletionDate(e.target.value)}
          />
          <TextInput
            label="Selling-price uplift (%)"
            inputMode="decimal"
            value={uplift}
            onChange={(e) => setUplift(e.target.value)}
          />
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          The completion date and the uplift set every expected selling price and every effective
          interest rate in the workbook. Both are marked REVIEW REQUIRED on the Data_Check sheet
          until Finance confirms them.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.xlsb"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])}
        />

        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Building the report…' : 'Choose the customer card'}
          </Button>
          {fileName ? <span className="text-sm text-ink-secondary">{fileName}</span> : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        ) : null}
      </Card>

      {summary ? <SummaryView summary={summary} /> : null}

      {!summary && !busy ? (
        <Card className="mt-4">
          <CardHeader
            title="What the workbook contains"
            subtitle="Six sheets, the first four laid out as the existing report"
          />
          <ol className="space-y-1.5 text-sm text-ink-secondary">
            {[
              ['InsPlan', 'One row per unit: what is due, in the month it falls due, plus the transfer instalment on On Key. Below it, the same plan at future value, and the effective interest rate solved for each unit.'],
              ['InsPaid', 'The same units, with the cash that actually arrived in the month it arrived — never the month it was due.'],
              ['%sellingprice', 'The uplift, straight-line in months remaining to completion. Change the completion date or the uplift and every expected price follows.'],
              ['Interest expense recognition', 'Interest on the advance, month by month, capped at the interest the plan carries, with the year-end journal entries.'],
              ['Data_Check', 'Every unit reconciled against the card, plus the totals and the assumptions still to be confirmed.'],
              ['Raw_AR_…', 'The source rows exactly as they were read, as the audit trail.'],
            ].map(([name, detail]) => (
              <li key={name} className="flex gap-2">
                <span className="w-44 shrink-0 font-medium text-ink">{name}</span>
                <span>{detail}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  const figures: [string, string][] = [
    ['Units', String(summary.units)],
    ['Contracts', String(summary.contracts)],
    ['Source rows read', String(summary.sourceRows)],
    ['Total net selling price', formatTHB(summary.totalSalePrice)],
    ['Total expected selling price', formatTHB(summary.totalExpectedSellingPrice)],
    ['Total installment plan', formatTHB(summary.totalPlan)],
    ['Total actual paid', formatTHB(summary.totalPaid)],
    ['Total outstanding', formatTHB(summary.totalOutstanding)],
    ['Total interest expense', formatTHB(summary.totalInterestExpense)],
  ];

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader
          title="The workbook has downloaded"
          subtitle={`Read from "${summary.sheetName}", header on row ${summary.headerRow}`}
          action={
            <div className="flex items-center gap-2">
              <Badge tone="good">{summary.ok} OK</Badge>
              {summary.check > 0 ? <Badge tone="warning">{summary.check} CHECK</Badge> : null}
              {summary.error > 0 ? <Badge tone="critical">{summary.error} ERROR</Badge> : null}
            </div>
          }
        />

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {figures.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between border-b border-border py-1.5">
              <dt className="text-sm text-ink-secondary">{label}</dt>
              <dd className="tnum text-sm font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Still to be confirmed"
          subtitle="Assumptions the customer card does not contain"
        />
        <ul className="space-y-1.5 text-sm text-ink-secondary">
          {summary.needsConfirmation.map((note) => (
            <li key={note} className="flex gap-2">
              <span aria-hidden className="text-warning">
                ●
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </Card>

      {summary.issues.length > 0 ? (
        <Card>
          <CardHeader
            title="Data quality"
            subtitle={`${summary.issues.length} thing${summary.issues.length === 1 ? '' : 's'} worth a look, all of them also on the Data_Check sheet`}
          />
          <ul className="space-y-2 text-sm">
            {summary.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className="flex gap-3 border-b border-border pb-2 last:border-0"
              >
                <span
                  className={cx(
                    'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                    issue.severity === 'error'
                      ? 'bg-critical/15 text-critical'
                      : issue.severity === 'warning'
                        ? 'bg-warning/15 text-warning'
                        : 'bg-surface-sunken text-ink-muted',
                  )}
                >
                  {issue.severity}
                </span>
                <span className="text-ink-secondary">
                  {issue.unit ? <span className="font-medium text-ink">{issue.unit} — </span> : null}
                  {issue.message}
                  {issue.sourceRow ? (
                    <span className="text-ink-muted"> (source row {issue.sourceRow})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
