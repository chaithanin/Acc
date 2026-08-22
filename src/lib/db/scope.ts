/**
 * The three things every fact-table read must know.
 *
 * Passing them as one object rather than three positional arguments is
 * deliberate: a caller cannot leave the company off and still compile, and a
 * reviewer can see at the call site which company a query is answering for.
 * The alternative — an optional `companyId` argument — is exactly the shape
 * that produced the leak this exists to close.
 */
export interface DataScope {
  companyId: string;
  snapshotId: string;
  /** null means every project of this company, never every project. */
  projectId: string | null;
}

export interface ScopeClause {
  /** Ready to drop in after WHERE, already joined with AND. */
  where: string;
  params: string[];
}

/**
 * Predicates restricting a fact table aliased as `alias` to one scope.
 *
 * `company_id` is filtered on the record itself rather than reached through
 * `projects`. A record whose project is unassigned still carries its company,
 * and a join is one more place a condition can be dropped.
 */
export function scopeClause(scope: DataScope, alias: string): ScopeClause {
  const where = [`${alias}.snapshot_id = ?`, `${alias}.company_id = ?`];
  const params = [scope.snapshotId, scope.companyId];

  if (scope.projectId) {
    where.push(`${alias}.project_id = ?`);
    params.push(scope.projectId);
  }

  return { where: where.join(' AND '), params };
}
