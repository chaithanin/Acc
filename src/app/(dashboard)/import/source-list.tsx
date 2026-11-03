import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { IMPORT_SOURCES, type ImportSource } from '@/config/source-systems';

/**
 * Where each figure comes from now.
 *
 * This sits on the upload page because the answer changed and the page is
 * where somebody stands when the question occurs to them. Three of the files
 * that used to be exported every month are now read straight out of Mango, and
 * uploading them as well would file the same balances twice — the double count
 * the reconciliation rules exist to catch. Nothing on the page said so.
 *
 * The hand-exported ones are listed in the same place for the opposite reason:
 * running the wrong report is the most common way an import goes wrong, and it
 * produces a file that parses and is quietly incomplete rather than an error.
 */
export function ImportSourceList() {
  const pulled = IMPORT_SOURCES.filter((source) => source.via.kind === 'pull');
  const uploaded = IMPORT_SOURCES.filter((source) => source.via.kind === 'upload');

  return (
    <Card className="mb-4">
      <CardHeader
        title="What this dashboard needs, and where it comes from"
        subtitle={`${uploaded.length} of ${IMPORT_SOURCES.length} still arrive as a file; the rest are read from the source system`}
      />

      <div className="space-y-5">
        <Group
          heading="Upload these"
          note="Exported by hand. Which report is run matters more than it looks: the wrong one usually parses."
          sources={uploaded}
        />
        <Group
          heading="Do not upload these"
          note="Read straight out of the source system. A workbook uploaded as well would report the same balances twice."
          sources={pulled}
        />
      </div>
    </Card>
  );
}

function Group({
  heading,
  note,
  sources,
}: {
  heading: string;
  note: string;
  sources: ImportSource[];
}) {
  if (sources.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">{heading}</h3>
      <p className="mb-2 mt-0.5 text-xs text-ink-secondary">{note}</p>

      <ul className="divide-y divide-border rounded-md border border-border">
        {sources.map((source) => (
          <li key={source.data} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{source.data}</p>
                <p className="mt-0.5 text-xs text-ink-secondary">Feeds {source.feeds}</p>
              </div>

              <Badge tone={source.via.kind === 'pull' ? 'good' : 'info'}>
                {source.via.kind === 'pull' ? 'read automatically' : 'upload'}
              </Badge>
            </div>

            <Detail via={source.via} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ via }: { via: ImportSource['via'] }) {
  return (
    <div className="mt-2 space-y-1 text-xs">
      <p className="text-ink-secondary">
        From <span className="font-medium text-ink">{via.system}</span>
        {via.kind === 'upload' && via.reportName ? (
          <>
            {' · '}
            <span className="text-ink">“{via.reportName}”</span>
          </>
        ) : null}
        {via.kind === 'upload' && via.menuPath ? (
          <>
            {' · '}
            <span className="text-ink-secondary">{via.menuPath}</span>
          </>
        ) : null}
      </p>

      {/*
        The command is shown rather than described. Somebody reading this page
        because a figure is stale needs the line to run, and a paraphrase of it
        is one more thing to get wrong.
      */}
      {via.kind === 'pull' ? (
        <p className="overflow-x-auto rounded border border-border bg-surface-sunken px-2 py-1 font-mono text-[11px] text-ink-secondary">
          {via.command}
        </p>
      ) : null}

      {via.note ? <p className="text-ink-secondary">{via.note}</p> : null}
    </div>
  );
}
