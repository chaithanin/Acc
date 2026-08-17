import { getDb, newId, nowIso } from '../index';

/**
 * Budget figures.
 *
 * The source workbooks carry no budget, so budget-utilisation is only
 * meaningful once someone enters one. Nothing here invents a denominator: an
 * absent budget stays absent and the dial says so.
 */

export interface Budget {
  month: string;
  projectId: string | null;
  incomeBudget: number | null;
  expenseBudget: number | null;
}

export function getBudget(month: string, projectId: string | null): Budget | null {
  const row = getDb()
    .prepare<[string, string], {
      month: string; project_id: string | null;
      income_budget: number | null; expense_budget: number | null;
    }>(
      `SELECT month, project_id, income_budget, expense_budget
         FROM budgets WHERE month = ? AND IFNULL(project_id, '') = ?`,
    )
    .get(month, projectId ?? '');

  if (!row) return null;
  return {
    month: row.month,
    projectId: row.project_id,
    incomeBudget: row.income_budget,
    expenseBudget: row.expense_budget,
  };
}

export function setBudget(input: {
  month: string;
  projectId: string | null;
  incomeBudget: number | null;
  expenseBudget: number | null;
  userId: string | null;
}): void {
  const db = getDb();
  const now = nowIso();
  const existing = getBudget(input.month, input.projectId);

  if (existing) {
    db.prepare(
      `UPDATE budgets SET income_budget = ?, expense_budget = ?, updated_at = ?
        WHERE month = ? AND IFNULL(project_id, '') = ?`,
    ).run(input.incomeBudget, input.expenseBudget, now, input.month, input.projectId ?? '');
    return;
  }

  db.prepare(
    `INSERT INTO budgets
       (id, month, project_id, income_budget, expense_budget, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(), input.month, input.projectId, input.incomeBudget, input.expenseBudget,
    input.userId, now, now,
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
