# KPI definitions and where they come from

Every figure on the dashboard is recomputed from normalized records. Nothing is
read from a formula result in the source workbook — an Excel formula that was
stale when the file was saved would otherwise be stale on the dashboard, with
nothing to show that it was.

## The three places a KPI is described

| What | Where | Why there |
|---|---|---|
| The arithmetic | `src/lib/calc/kpi.ts` | The engine computes it and emits its own formula text and inputs, so "View Calculation" and the number can never disagree. |
| What it means, and which records it reads | `src/config/kpi-definitions.ts` | Prose the engine cannot express. Shown above the formula in View Calculation and above the drill-down. |
| That it still produces the right number | `tests/golden-file.test.ts` | One fixed workbook through the whole pipeline, every KPI asserted at an exact figure. |

The formula is deliberately **not** repeated in the definitions registry. Two
copies of a formula are two definitions of the same number, and they drift.

## The golden file

`tests/fixtures/golden-workbook.ts` builds a workbook in code rather than
committing a binary, so a reviewer can read the figures and change one on
purpose. Its sheets use the header wording the real reports use, because the
detector reads headers — a fixture with tidied-up headers would be testing a
pipeline nobody runs.

The test asserts, in order:

1. the file parses, the project is recognised, and each sheet is classified;
2. every row became a record (a drop means the normalizer started rejecting
   rows it used to accept);
3. every KPI equals a figure worked out by hand from the sheet;
4. the statement reconciles — net profit equals income less every cost;
5. every KPI the engine produces has both an expected figure and a definition.

**A failure is not automatically a bug.** It means a figure moved, and somebody
has to say whether it was supposed to. When it was, change the expected figure
in the same commit as the change that moved it, and say in the message why.

## Adding a KPI

1. Compute it in `src/lib/calc/kpi.ts`, with its formula text and inputs.
2. Add its definition to `src/config/kpi-definitions.ts`.
3. Add its expected figure to `EXPECTED` in `tests/golden-file.test.ts`.
4. If it is drillable, add its source to `DRILLDOWN_SOURCES`.

Steps 2 and 3 are enforced: the suite fails if a KPI has no definition or no
golden figure, and fails equally if a definition names a KPI that no longer
exists.
