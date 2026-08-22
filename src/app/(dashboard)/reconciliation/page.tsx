import { DashboardPage } from '@/components/dashboard-page';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { loadDashboard } from '@/lib/dashboard/context';
import { getAllValidations } from '@/lib/db/repositories/snapshots';
import { getImportIssues } from '@/lib/db/repositories/imports';
import { formatTHB } from '@/lib/format/number';
import { ValidationTable, type ValidationRow } from './validation-table';
import { IssueTable, type IssueRow } from './issue-table';

/**
 * Data Validation / Reconciliation (requirement 15).
 *
 * Two distinct things live here: reconciliation RULES (does the arithmetic
 * agree with itself?) and import ISSUES (what went wrong while reading the
 * files?). Keeping them apart matters — a warning about one unreadable cell is
 * not the same as a balance that does not add up.
 */
export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadDashboard(params);

  const validations: ValidationRow[] = context.scope
    ? getAllValidations(context.scope.companyId, context.scope.snapshotId).map((row) => ({
        rule: row.label,
        scope: row.scope,
        project: row.project_name,
        expected: row.expected_value,
        imported: row.imported_value,
        difference: row.difference,
        status: row.status as ValidationRow['status'],
        message: row.message ?? '',
      }))
    : [];

  const issues: IssueRow[] = context.snapshot
    ? getImportIssues(context.scope!.companyId, context.snapshot.importId).map((row) => ({
        severity: row.severity as IssueRow['severity'],
        code: row.code,
        message: row.message,
        file: row.source_file,
        sheet: row.source_sheet,
        row: row.source_row,
        cell: row.source_cell,
      }))
    : [];

  const failures = validations.filter((v) => v.status === 'error');
  const warnings = validations.filter((v) => v.status === 'warning');
  const passes = validations.filter((v) => v.status === 'pass');
  const largestGap = [...failures, ...warnings].reduce(
    (max, v) => Math.max(max, Math.abs(v.difference ?? 0)),
    0,
  );

  return (
    <DashboardPage
      title="Reconciliation"
      description="Where the imported figures disagree with what they should be, and what the importer could not read cleanly."
      context={context}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={failures.length > 0 ? 'critical' : 'neutral'} icon={<span aria-hidden>▲</span>}>
          {failures.length} failing
        </Badge>
        <Badge tone={warnings.length > 0 ? 'warning' : 'neutral'} icon={<span aria-hidden>◆</span>}>
          {warnings.length} warning
        </Badge>
        <Badge tone="good" icon={<span aria-hidden>●</span>}>
          {passes.length} reconciled
        </Badge>
        {largestGap > 0 ? (
          <Badge tone="neutral">Largest gap {formatTHB(largestGap, 'millions')}</Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader
          title="Reconciliation rules"
          subtitle="Each rule states what a figure should be from first principles and compares it with what was imported. Nothing here modifies data."
        />
        {validations.length > 0 ? (
          <ValidationTable rows={validations} />
        ) : (
          <EmptyState title="No rules were run" description="Import data to run reconciliation." />
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Import issues"
          subtitle="Problems found while reading the files. These never stop an import — the readable parts are always imported."
        />
        {issues.length > 0 ? (
          <IssueTable rows={issues} />
        ) : (
          <EmptyState
            title="No issues"
            description="Every sheet, row and cell in this import was read cleanly."
          />
        )}
      </Card>
    </DashboardPage>
  );
}
