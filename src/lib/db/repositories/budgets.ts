import { getDb, newId, nowIso } from '../index';

/**
 * Budget figures.
 *
 * The source workbooks carry no budget, so budget-utilisation is only
 * meaningful once someone enters one. Nothing here invents a denominator: an
 * absent budget stays absent and the dial says so.
 *
 * A budget belongs to a company, and a null project means every project of
 * that company. Keyed by month and project alone, "August, all projects" was
 * one row for the whole group: the second company to enter a budget silently
 * overwrote the first, and both then saw the survivor's figure on their dial.
 */

export interface Budget {
  month: string;
  companyId: string;
  projectId: string | null;
  incomeBudget: number | null;
  expenseBudget: number | null;
}

export function getBudget(
  companyId: string,
  month: string,
  projectId: string | null,
): Budget | null {
  const row = getDb()
    .prepare<[string, string, string], {
      month: string; company_id: string | null; project_id: string | null;
      income_budget: number | null; expense_budget: number | null;
    }>(
      `SELECT month, company_id, project_id, income_budget, expense_budget
         FROM budgets
        WHERE month = ? AND company_id = ? AND IFNULL(project_id, '') = ?`,
    )
    .get(month, companyId, projectId ?? '');

  if (!row) return null;
  return {
    month: row.month,
    companyId,
    projectId: row.project_id,
    incomeBudget: row.income_budget,
    expenseBudget: row.expense_budget,
  };
}

export function setBudget(input: {
  companyId: string;
  month: string;
  projectId: string | null;
  incomeBudget: number | null;
  expenseBudget: number | null;
  userId: string | null;
}): void {
  const db = getDb();
  const now = nowIso();

  // A project from another company cannot be given a budget under this one,
  // which would put a figure on a dial its owner never entered.
  if (input.projectId) {
    const owner = db
      .prepare<[string], { company_id: string | null }>(
        'SELECT company_id FROM projects WHERE id = ?',
      )
      .get(input.projectId);

    if (!owner || owner.company_id !== input.companyId) {
      throw new Error('That project belongs to another company.');
    }
  }

  const existing = getBudget(input.companyId, input.month, input.projectId);

  if (existing) {
    db.prepare(
      `UPDATE budgets SET income_budget = ?, expense_budget = ?, updated_at = ?
        WHERE month = ? AND company_id = ? AND IFNULL(project_id, '') = ?`,
    ).run(
      input.incomeBudget, input.expenseBudget, now,
      input.month, input.companyId, input.projectId ?? '',
    );
    return;
  }

  db.prepare(
    `INSERT INTO budgets
       (id, month, company_id, project_id, income_budget, expense_budget, created_by,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(), input.month, input.companyId, input.projectId,
    input.incomeBudget, input.expenseBudget, input.userId, now, now,
  );
}

export interface BudgetUtilisation {
  budget: number | null;
  actual: number;
  /** Percentage of budget consumed; null when no budget is set. */
  percent: number | null;
  /** Budget − actual. Negative means overspent / over-collected. */
  balance: number | null;
}

export function utilisation(budget: number | null, actual: number): BudgetUtilisation {
  if (budget === null || budget === 0) {
    return { budget, actual, percent: null, balance: budget === null ? null : budget - actual };
  }
  return {
    budget,
    actual,
    percent: Number(((actual / budget) * 100).toFixed(1)),
    balance: Number((budget - actual).toFixed(2)),
  };
}
