import { Card, CardHeader } from '@/components/ui/primitives';
import type { SourceReportGuide } from '@/config/source-systems';

/**
 * Where to get the file.
 *
 * The wrong export is the most common way this goes wrong — a summary instead
 * of a card, a date range that stops short, a PDF. None of those produce a
 * useful error; they produce a report that is quietly missing units. So the
 * answer sits on the page that needs it.
 *
 * Open by default: somebody running this for the first time should not have to
 * discover that the instructions exist.
 */
export function SourceGuide({ guide }: { guide: SourceReportGuide }) {
  return (
    <Card className="mb-4">
      <CardHeader
        title="Where to get the customer card"
        subtitle={`Exported by hand from ${guide.system}`}
        action={
          <a
            href={guide.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Open {guide.system} ↗
          </a>
        }
      />

      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <Step n={1} />
          <div>
            <p className="text-ink">
              Open the report{' '}
              <span className="font-medium text-ink">“{guide.reportName}”</span>
            </p>
            {guide.menuPath ? (
              <p className="mt-0.5 text-ink-secondary">{guide.menuPath}</p>
            ) : (
              <p className="mt-0.5 text-ink-muted">
                The report prints its own name at the top of the export, so this is the name to
                look for in the menu.
              </p>
            )}
          </div>
        </li>

        <li className="flex gap-3">
          <Step n={2} />
          <div className="w-full">
            <p className="mb-1.5 text-ink">Set these before exporting</p>
            <dl className="space-y-1">
              {guide.settings.map((setting) => (
                <div key={setting.label} className="flex flex-wrap gap-x-2 text-ink-secondary">
                  <dt className="font-medium text-ink">{setting.label}</dt>
                  <dd>— {setting.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </li>

        <li className="flex gap-3">
          <Step n={3} />
          <div>
            <p className="text-ink">Upload the .xlsx below. Nothing else is needed.</p>
            <p className="mt-0.5 text-ink-secondary">
              The importer finds the columns by their headings, so an extra column or a different
              column order is fine. What it cannot do without is the headings themselves.
            </p>
          </div>
        </li>
      </ol>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            A correct export starts like this
          </p>
          <pre className="mt-1.5 overflow-x-auto rounded-md border border-border bg-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-secondary">
            {guide.looksLike.join('\n')}
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Columns it must contain
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {guide.requiredColumns.map((column) => (
              <span
                key={column}
                className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary"
              >
                {column}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            If the upload is refused for a missing column, this is the list to check the export
            against.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-medium text-accent"
    >
      {n}
    </span>
  );
}
