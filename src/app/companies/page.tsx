import { redirect } from 'next/navigation';
import { canSeeGroup, clearActiveCompany, currentUser, setActiveCompany, setGroupView } from '@/lib/auth';
import { companiesForUser } from '@/lib/db/repositories/companies';
import { CompanyLogo } from './company-logo';
import styles from './companies.module.css';

/**
 * Company selection — the first screen after signing in.
 *
 * Nothing financial is reachable until a company is chosen, so a user is never
 * looking at a figure without knowing whose it is. The list is what this user
 * has been granted: a company they cannot see is not rendered and cannot be
 * selected by editing the request, because the choice is validated on the
 * server before it is stored.
 */
export default async function SelectCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  // Arriving here means starting over, so any previous selection is dropped
  // rather than left to reappear behind the next navigation.
  await clearActiveCompany();

  const { error } = await searchParams;
  const companies = companiesForUser(user.id);
  // Offered only to someone who can open every company: a group total missing
  // a subsidiary is worse than none, because nothing on the page would say
  // what was left out.
  const groupAvailable = await canSeeGroup(user.id);

  async function chooseGroup() {
    'use server';
    if (!(await setGroupView())) redirect('/companies?error=denied');
    redirect('/group');
  }

  async function chooseCompany(formData: FormData) {
    'use server';

    const id = String(formData.get('companyId') ?? '');
    const company = await setActiveCompany(id);
    if (!company) redirect('/companies?error=denied');

    redirect('/');
  }

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            Global Top Group
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Welcome</h1>
          <p className="mt-2 text-ink-secondary">
            Select a company to access the Financial Dashboard
            {groupAvailable ? ', or open the group.' : '.'}
          </p>
        </div>

        {groupAvailable ? (
          <form action={chooseGroup} className="mx-auto mb-8 max-w-md">
            <button
              type="submit"
              className="w-full rounded-[var(--radius-card)] border border-accent/40 bg-accent/5 px-5 py-4 text-left transition hover:bg-accent/10"
            >
              <span className="block text-sm font-semibold text-ink">
                All {companies.length} companies
              </span>
              <span className="mt-0.5 block text-sm text-ink-secondary">
                Consolidated, with trade between the companies eliminated.
              </span>
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="mx-auto mb-6 max-w-md rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-center text-sm text-critical">
            That company is not available to your account.
          </p>
        ) : null}

        {companies.length === 0 ? (
          <div className="mx-auto max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center">
            <p className="font-medium text-ink">No companies are assigned to your account.</p>
            <p className="mt-2 text-sm text-ink-secondary">
              An administrator grants access per company. Until then there is nothing here to
              show — which is deliberate: an account with no grant sees no companies rather than
              all of them.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
              <form key={company.id} action={chooseCompany}>
                <input type="hidden" name="companyId" value={company.id} />

                {/*
                  The card itself submits. Anything smaller would put the only
                  way in behind a hover, which a phone cannot perform.
                */}
                <button type="submit" className={styles.card}>
                  <span className={styles.face}>
                    <CompanyLogo
                      logo={company.logo}
                      code={company.companyCode}
                      name={company.displayName}
                    />
                  </span>

                  <span className={styles.content}>
                    <span className={styles.title}>{company.displayName}</span>
                    <span className={styles.description}>{company.legalName}</span>
                    <span className={styles.cue}>Open Dashboard →</span>
                    <span className={styles.meta}>
                      {company.projectCount}{' '}
                      {company.projectCount === 1 ? 'project' : 'projects'} · {company.companyCode}
                    </span>
                  </span>
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
