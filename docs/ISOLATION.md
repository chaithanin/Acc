# Company isolation, and how it is proved

Six companies' financial records live in one database. The rule is that a
signed-in user sees the company they are working in and nothing else, and it is
enforced in the queries — not in a component that filters a longer list it was
handed.

## Where the boundary is

| Layer | What enforces it |
|---|---|
| Session | `activeCompany()` re-checks the session's company against the user's grants on every request. A grant removed mid-session takes effect at once. |
| Snapshot resolution | `getSnapshot(companyId, id)` returns null for another company's snapshot. Every read downstream goes by snapshot id, so this is the gate. |
| Fact-table reads | `DataScope` (company + snapshot + project) is a required argument, and `scopeClause` writes the predicates. A read cannot be written without naming the company it answers for. |
| Imports | List, summary, files, issues, rollback and duplicate detection are all per company. |
| Master data | Projects, budgets and templates each carry a company; the settings pages re-resolve it inside every server action. |

An identifier arriving in a query string or a request body is a **request**, not
a permission. The company always comes from the session.

## The two tests

**`tests/data-isolation.test.ts`** — the repositories. Two companies file on the
same report date, then every read is fired with the other's snapshot id, import
id and project id. It also covers the case that made the rule visible: month-end
is month-end for everybody, so "one current snapshot per report date" had one
company's import retiring another company's live snapshot.

**`scripts/adversarial-test.mjs`** — the deployed surface. Run with:

```
npm run build && npm run test:adversarial
```

It starts the standalone bundle — the same one the container runs, since
testing a different server would prove nothing about the one that ships —
signs in as a user granted exactly one company, and sends every route the other
company's identifiers. It checks three things at once:

1. no response contains the other company's **data** (its figures, its name).
   Deliberately not its identifiers: a page echoes the query string back into
   its own links, so finding a snapshot id in the HTML proves only that the
   requester supplied it;
2. the request was actually refused, not merely empty — there is a control
   check that the caller can still read its **own** snapshot;
3. every page actually rendered. A page that throws leaks nothing and would
   otherwise pass. Next answers 200 with most of the HTML and records the
   failure only as an error entry in the RSC payload, which is how a settings
   page broken by a non-serialisable server action earned a clean bill of
   health from a green build, a clean type-check, and an earlier version of
   this script.

**If either test fails, the build does not go to production.**
