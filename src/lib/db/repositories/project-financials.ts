import { getDb, newId, nowIso } from '@/lib/db';

/**
 * What a project is expected to sell for and to cost.
 *
 * Neither figure appears in any export the importer reads — they are the
 * board's own numbers — so they are entered once per project and kept until
 * someone changes them. Revenue recognition cannot be done without the first
 * and project cost control cannot be done without the second.
 */

export interface ProjectFinancials {
  projectId: string;
  companyId: string;
  totalSaleValue: number | null;
  costBudget: number | null;
  revisedCostBudget: number | null;
  committedCost: number | null;
  updatedAt: string | null;
}

interface Row {
  project_id: string;
  company_id: string;
  total_sale_value: number | null;
  cost_budget: number | null;
  revised_cost_budget: number | null;
  committed_cost: number | null;
  updated_at: string | null;
}

const toRecord = (r: Row): ProjectFinancials => ({
  projectId: r.project_id,
  companyId: r.company_id,
  totalSaleValue: r.total_sale_value,
  costBudget: r.cost_budget,
  revisedCostBudget: r.revised_cost_budget,
  committedCost: r.committed_cost,
  updatedAt: r.updated_at,
});

export function listProjectFinancials(companyId: string): ProjectFinancials[] {
  return getDb()
    .prepare<[string], Row>('SELECT * FROM project_financials WHERE company_id = ?')
    .all(companyId)
    .map(toRecord);
}

export function getProjectFinancials(
  companyId: string,
  projectId: string,
): ProjectFinancials | null {
  const row = getDb()
    .prepare<[string, string], Row>(
      'SELECT * FROM project_financials WHERE company_id = ? AND project_id = ?',
    )
    .get(companyId, projectId);
  return row ? toRecord(row) : null;
}

/**
 * Writes the figures for one project.
 *
 * The company is taken from the caller's session rather than the form, and the
 * project is checked against it, so a project id posted from another company
 * writes nothing.
 */
export function setProjectFinancials(input: {
  companyId: string;
  projectId: string;
  totalSaleValue: number | null;
  costBudget: number | null;
  revisedCostBudget: number | null;
  committedCost: number | null;
  userId: string | null;
}): boolean {
  const db = getDb();

  const owns = db
    .prepare<[string, string], { n: number }>(
      'SELECT COUNT(*) AS n FROM projects WHERE id = ? AND company_id = ?',
    )
    .get(input.projectId, input.companyId)?.n;
  if (!owns) return false;

  const now = nowIso();
  db.prepare(
    `INSERT INTO project_financials
       (id, company_id, project_id, total_sale_value, cost_budget, revised_cost_budget,
        committed_cost, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id, project_id) DO UPDATE SET
       total_sale_value    = excluded.total_sale_value,
       cost_budget         = excluded.cost_budget,
       revised_cost_budget = excluded.revised_cost_budget,
       committed_cost      = excluded.committed_cost,
       updated_by          = excluded.updated_by,
       updated_at          = excluded.updated_at`,
  ).run(
    newId(), input.companyId, input.projectId,
    input.totalSaleValue, input.costBudget, input.revisedCostBudget, input.committedCost,
    input.userId, now, now,
  );

  return true;
}

/** Remaining project budget, on the policy the group applies. */
export interface ProjectBudgetPosition {
  approved: number | null;
  revised: number | null;
  /** The budget in force: the revision when there is one, else the approved. */
  inForce: number | null;
  actual: number;
  committed: number;
  /** In force less actual less committed. Null when no budget is set. */
  remaining: number | null;
  /** Actual and committed against the budget in force, as a percentage. */
  utilisation: number | null;
}

export function budgetPosition(
  financials: ProjectFinancials | null,
  actualCost: number,
): ProjectBudgetPosition {
  const approved = financials?.costBudget ?? null;
  const revised = financials?.revisedCostBudget ?? null;
  const inForce = revised ?? approved;
  const committed = financials?.committedCost ?? 0;

  return {
    approved,
    revised,
    inForce,
    actual: actualCost,
    committed,
    // Exposure, not spend: money already promised is money gone, and a budget
    // that looks healthy until the commitments land is how an overrun is found
    // too late to do anything about.
    remaining: inForce === null ? null : Math.round((inForce - actualCost - committed) * 100) / 100,
    utilisation:
      inForce === null || inForce === 0
        ? null
        : Number((((actualCost + committed) / inForce) * 100).toFixed(1)),
  };
}
