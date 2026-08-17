# Pulling data from an API instead of a workbook

The dashboard's import pipeline takes a workbook, detects its sheets, maps
columns to canonical fields, normalises rows into records, and stores every
record with a reference back to the file, sheet and cell it came from. An API
source is the same pipeline with a different first step: instead of cells, the
records come from a JSON payload, and the source reference records the endpoint
and the field path rather than a cell address.

That last part is not optional. A figure on the dashboard has to be traceable to
where it came from, and "from the API" is not an answer a finance team can check.

## Before an adapter can be written

An adapter needs three things that only the API itself can tell us:

1. **Where the credential goes.** `Authorization: Bearer`, `x-api-key`, a query
   parameter — the URL alone does not say.
2. **What the request body looks like.** An endpoint named `/adapter` is a
   generic entry point; it dispatches on something inside the payload.
3. **What comes back.** Which JSON fields hold the project, the period, the
   amount, and whether amounts arrive already summed.

Guessing any of these produces an adapter that fails in a way that looks like an
API problem but is ours, so they get established first.

## Establishing them

```
node scripts/api-probe.mjs --url <endpoint> --token <token>
```

It sends the plausible combinations of credential placement and request shape,
including one attempt with no credential as a control, and prints what each one
answered. Identical answers are collapsed so the attempt that behaved
differently stands out.

Read the result as follows:

- **One combination accepted (2xx)** — that is the shape. Even a 4xx that names a
  missing field is progress: the credential was accepted and only the payload is
  still unknown.
- **Everything answered identically, including the no-credential control** — the
  API never saw the request. Something in between refused it, and nothing has
  been learned about the token. Run it from a machine with direct outbound
  HTTPS; the deployment VM has one.

The script prints the token nowhere: it is masked in every line of output,
including inside error bodies that echo it back.

## Handling the credential

The token is a live credential for a finance system. It belongs in the
environment, never in the repository:

```
ALLKONS_API_URL=https://…/api/adapter
ALLKONS_API_TOKEN=…
```

`.env` and `.env*.local` are already git-ignored. On the deployment VM these
belong in the container's environment (`/opt/gtg/run.sh`), not in the image —
an image is pushed to a registry and a baked-in token goes with it.

If this token has been pasted into a chat, an issue or a terminal that others can
read, treat it as known and have it reissued.
