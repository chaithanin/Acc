import { redirect } from 'next/navigation';
import { clearActiveCompany, currentUser, setActiveCompany } from '@/lib/auth';
import { companiesForUser } from '@/lib/db/repositories/companies';
import { CompanyLogo } from './company-logo';

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
            Select a company to access the Financial Dashboard.
          </p>
        </div>

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
              <form
                key={company.id}
                action={chooseCompany}
                className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:border-border-strong"
              >
                <input type="hidden" name="companyId" value={company.id} />

                <CompanyLogo logo={company.logo} code={company.companyCode} name={company.displayName} />

                <h2 className="mt-4 font-semibold text-ink">{company.displayName}</h2>
                <p className="mt-0.5 text-sm text-ink-secondary">{company.legalName}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {company.projectCount} {company.projectCount === 1 ? 'project' : 'projects'} ·{' '}
                  {company.companyCode}
                </p>

                <button
                  type="submit"
                  className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Open Dashboard
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
