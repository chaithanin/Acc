import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/primitives';
import type { Alert, AlertSeverity } from '@/lib/alerts';

/**
 * The things management should be told without having to look for them.
 *
 * Ordered worst first and shown only when there is something to say. A panel
 * that is always on screen with a green "all clear" trains people to skip it,
 * which is exactly the habit that makes the one real alert invisible.
 */

const TONE: Record<AlertSeverity, { border: string; text: string; label: string }> = {
  critical:    { border: 'border-critical/40 bg-critical/5', text: 'text-critical', label: 'Critical' },
  high:        { border: 'border-warning/40 bg-warning/5',   text: 'text-warning',  label: 'High' },
  medium:      { border: 'border-border bg-surface-sunken',  text: 'text-ink',      label: 'Medium' },
  information: { border: 'border-border bg-surface-sunken',  text: 'text-ink-secondary', label: 'Information' },
};

export function AlertPanel({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader
        title="Needs attention"
        subtitle={`${alerts.length} ${alerts.length === 1 ? 'thing' : 'things'} worth acting on before anything else.`}
      />
      <ul className="space-y-2">
        {alerts.map((alert) => {
          const tone = TONE[alert.severity];
          return (
            <li key={alert.title} className={`rounded-md border px-3 py-2.5 ${tone.border}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${tone.text}`}>
                  {tone.label}
                </span>
                <span className="text-sm font-medium text-ink">{alert.title}</span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">{alert.detail}</p>
              {alert.href ? (
                <Link
                  href={alert.href}
                  className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
                >
                  Look into it
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
