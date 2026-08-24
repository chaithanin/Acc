import { headers } from 'next/headers';
import { activeCompany, currentUser } from '@/lib/auth';
import { writeAudit } from '@/lib/db/repositories/audit';

/**
 * Recording an action against the person who took it.
 *
 * Written from the request rather than from inside the repositories: the
 * repositories are also called by the seed, by the command-line tools and by
 * the tests, none of which has an actor to name, and a log full of entries
 * saying "system" is worse than no log because it looks complete.
 *
 * A failure to write the log never fails the action. Losing the record of a
 * password reset is bad; refusing to reset the password because the record
 * could not be written is worse.
 */

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  detail?: Record<string, unknown> | null;
  /** Overrides the company from the session, for actions that name their own. */
  companyId?: string | null;
}

async function callerAddress(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]!.trim() || null;
    return h.get('x-real-ip')?.trim() || null;
  } catch {
    return null;
  }
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const user = await currentUser();
    if (!user) return;

    const company =
      input.companyId !== undefined ? input.companyId : (await activeCompany())?.id ?? null;

    writeAudit({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      companyId: company,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      summary: input.summary,
      detail: input.detail ?? null,
      ip: await callerAddress(),
    });
  } catch {
    // Deliberately silent: see the note above.
  }
}

/** The fields that actually changed, for the detail column. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (before[key] === value) continue;
    changes[key] = { from: before[key], to: value };
  }
  return changes;
}
