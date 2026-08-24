import { redirect } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ROLE_LABELS, activeCompany, can, currentUser } from '@/lib/auth';
import { listAudit } from '@/lib/db/repositories/audit';
import type { Role } from '@/lib/types';

/**
 * Who changed what.
 *
 * Every figure on a dashboard is the result of somebody importing a file,
 * rolling one back, editing a budget or changing what a project is called.
 * Until this page existed the system could say what the figure was but not who
 * made it that, which is the first question anyone asks when a number moves.
 *
 * Read-only by construction: there is no action on this page and no repository
 * function that edits or deletes an entry.
 */

const HOW_MANY = 300;

/** Entries about the same kind of thing share a tone, so the list scans. */
function toneFor(action: string): 'critical' | 'warning' | 'good' | 'neutral' {
  if (action.startsWith('import.rollback') || action.startsWith('report.delete')) return 'critical';
  if (action.startsWith('user.') || action.startsWith('company.')) return 'warning';
  if (action.startsWith('import.') || action.startsWith('report.')) return 'good';
  return 'neutral';
}

function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  // The log names people and what they did to accounts, so it sits with the
  // permission that manages accounts.
  if (!can(user, 'users:manage')) redirect('/');

  const company = await activeCompany();
  if (!company) redirect('/companies');

  const { action } = await searchParams;
  const entries = listAudit({ companyId: company.id, limit: HOW_MANY, action });

  return (
    <>
      <PageHeader
        title="Activity Log"
        description={`Who changed what, newest first. Entries for ${company.displayName} and the ones that belong to no single company — an account created, a password reset.`}
      />

      <Card>
        <CardHeader
          title={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
          subtitle={
            entries.length === HOW_MANY
              ? `The most recent ${HOW_MANY}. Older entries are kept and can be read from the database.`
              : undefined
          }
        />

        {entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Entries appear here as soon as anyone imports a file, edits a budget or changes an account."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Who</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60 align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-ink-secondary">{when(entry.at)}</td>
                    <td className="py-2 pr-3">
                      <span className="text-ink">{entry.actorEmail}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {ROLE_LABELS[entry.actorRole as Role] ?? entry.actorRole}
                      </span>
                      {entry.ip ? (
                        <div className="text-xs text-ink-muted">{entry.ip}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-ink">
                      {entry.summary}
                      {entry.detail ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-ink-muted">Details</summary>
                          <pre className="mt-1 overflow-x-auto rounded-md bg-surface-sunken px-2 py-1.5 text-xs text-ink-secondary">
                            {JSON.stringify(entry.detail, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      <Badge tone={toneFor(entry.action)}>{entry.action}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="What is recorded" subtitle="And what deliberately is not" />
        <p className="text-sm text-ink-secondary">
          Signing in and out, every change to an account or a company, projects and their
          spellings, template choices, budgets, imports, rollbacks, recalculations and Customer
          Card reports. A password is never written to the log — only that it was replaced, by
          whom and for whom. Nothing edits or deletes an entry once it is written.
        </p>
      </Card>
    </>
  );
}
