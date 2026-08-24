import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
import { audit, changedFields } from '@/lib/audit';
import { describeLogoLimits, toLogoDataUri } from '@/lib/companies/logo-upload';
import { listAllCompanies, updateCompany } from '@/lib/db/repositories/companies';
import { CompanyRow } from './company-row';

/**
 * Company administration — names, codes and logos.
 *
 * A logo uploaded here reaches the company chooser immediately, which is the
 * point: putting a mark on a company should not need a repository checkout, a
 * commit and a deploy to do it.
 */
/**
 * The name to write in the log, so a later rename does not rewrite history.
 *
 * Module scope on purpose — see the note on the same helper in the projects
 * settings page.
 */
function companyName(id: string): string {
  return listAllCompanies().find((c) => c.id === id)?.displayName ?? id;
}

export default async function CompanySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  // Companies decide what everyone else can see, so editing them sits with the
  // same permission that manages users rather than with finance.
  if (!can(user, 'users:manage')) redirect('/');

  const { error, notice } = await searchParams;
  const companies = listAllCompanies();

  async function guard() {
    'use server';
    const actor = await currentUser();
    if (!actor || !can(actor, 'users:manage')) redirect('/');
  }

  async function uploadLogoAction(formData: FormData) {
    'use server';
    await guard();

    const id = String(formData.get('id') ?? '');
    const file = formData.get('logo');

    if (!(file instanceof File) || file.size === 0) {
      redirect(`/settings/companies?error=${encodeURIComponent('Choose a file to upload.')}`);
    }

    let dataUri: string;
    try {
      const encoded = toLogoDataUri(
        new Uint8Array(await (file as File).arrayBuffer()),
        (file as File).type,
        (file as File).name,
      );
      dataUri = encoded.dataUri;
    } catch (err) {
      redirect(`/settings/companies?error=${encodeURIComponent((err as Error).message)}`);
    }

    updateCompany(id, { logo: dataUri });

    await audit({
      action: 'company.logo_upload',
      entity: 'company',
      entityId: id,
      summary: `Uploaded a logo for ${companyName(id)}`,
      detail: { fileName: (file as File).name, bytes: (file as File).size },
      companyId: id,
    });
    revalidatePath('/settings/companies');
    revalidatePath('/companies');
    redirect(`/settings/companies?notice=${encodeURIComponent('Logo updated.')}`);
  }

  async function removeLogoAction(formData: FormData) {
    'use server';
    await guard();

    const removedFrom = String(formData.get('id') ?? '');
    updateCompany(removedFrom, { logo: null });

    await audit({
      action: 'company.logo_remove',
      entity: 'company',
      entityId: removedFrom,
      summary: `Removed the logo from ${companyName(removedFrom)}`,
      companyId: removedFrom,
    });
    revalidatePath('/settings/companies');
    revalidatePath('/companies');
    redirect(`/settings/companies?notice=${encodeURIComponent('Logo removed.')}`);
  }

  async function updateDetailsAction(formData: FormData) {
    'use server';
    await guard();

    const id = String(formData.get('id') ?? '');
    const before = listAllCompanies().find((c) => c.id === id);
    const wanted = {
      displayName: String(formData.get('displayName') ?? '').trim() || undefined,
      companyCode: String(formData.get('companyCode') ?? '').trim() || undefined,
      sortOrder: Number(formData.get('sortOrder') ?? 100),
      active: formData.get('active') === 'on',
    };

    updateCompany(id, wanted);

    await audit({
      action: 'company.update',
      entity: 'company',
      entityId: id,
      summary: `Updated ${before?.displayName ?? id}`,
      detail: before
        ? { changed: changedFields(
            { displayName: before.displayName, companyCode: before.companyCode, sortOrder: before.sortOrder, active: before.active },
            wanted,
          ) }
        : { changed: wanted },
      companyId: id,
    });

    revalidatePath('/settings/companies');
    revalidatePath('/companies');
    redirect(`/settings/companies?notice=${encodeURIComponent('Company updated.')}`);
  }

  return (
    <>
      <PageHeader
        title="Companies"
        description="What each company is called, and the mark that identifies it."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-md border border-good/30 bg-good/10 px-3 py-2 text-sm text-good">
          {notice}
        </p>
      ) : null}

      <div className="space-y-3">
        {companies.map((company) => (
          <CompanyRow
            key={company.id}
            company={company}
            limits={describeLogoLimits()}
            uploadAction={uploadLogoAction}
            removeAction={removeLogoAction}
            updateAction={updateDetailsAction}
          />
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Where a logo is stored"
          subtitle="In the company's own row, as data — not as a file in the repository."
        />
        <p className="text-sm text-ink-secondary">
          It survives a deploy because it lives on the data disk with everything else, and it is
          included in a database backup without anyone having to remember a second location. A
          company with no logo shows its code, so leaving one unset is a choice rather than a
          broken image. {describeLogoLimits()}
        </p>
      </Card>
    </>
  );
}
