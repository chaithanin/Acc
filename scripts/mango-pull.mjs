import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Pull a period out of Mango RE and put it into the dashboard.
 *
 *   node --import ./scripts/register-ts.mjs scripts/mango-pull.mjs --company GTG
 *
 * Everything it reads comes from the environment:
 *
 *   MANGO_BASE_URL   https://chaithanin.mangoanywhere.com/production.re
 *   MANGO_USER       a service account, not a person's login
 *   MANGO_PASS
 *
 * The account matters. Mango filters every response by the permissions of
 * whoever signed in, so a pull is only as complete as that account's project
 * rights — and Mango logs every menu a user opens, so a person's own login
 * would fill their audit trail with machine traffic. The run prints how many
 * projects it could see so a short pull is obvious rather than silent.
 *
 * Flags:
 *   --company <code>    which company in the dashboard the data belongs to
 *   --projects a,b      limit to these Mango project codes (default: all visible)
 *   --date YYYY-MM-DD   the report date to file it under (default: today)
 *   --dry-run           fetch, map and report; write nothing
 *   --save <file>       also write the raw bundle to disk, for inspection
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const companyCode = flag('company');
const projectFilter = (flag('projects') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const reportDate = flag('date') ?? new Date().toISOString().slice(0, 10);
const dryRun = has('dry-run');
const savePath = flag('save');

if (!dryRun && !companyCode) {
  console.error('Which company is this for? Pass --company <code>, or --dry-run to only look.');
  process.exit(2);
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));

const { MangoClient, credentialsFromEnv, checkBundleSchema, MangoError } =
  await import('../src/lib/sources/mango/client.ts');
const { mapMangoBundle } = await import('../src/lib/sources/mango/map.ts');

// ------------------------------------------------------------------- fetch

let credentials;
try {
  credentials = credentialsFromEnv();
} catch (err) {
  console.error(err instanceof MangoError ? err.message : err);
  process.exit(2);
}

console.log(bold(`\n── Mango RE · ${credentials.baseUrl}`));
console.log(`   signing in as ${credentials.username}`);

const client = new MangoClient(credentials);

try {
  await client.login();
} catch (err) {
  console.error(`\n   ${err.message}`);
  process.exit(1);
}

const projects = await client.projects();
console.log(`   ${projects.length} projects visible to this account`);
for (const p of projects) {
  console.log(`     ${String(p.pre_event2 ?? '—').padEnd(14)} ${p.name ?? ''}`
    + `  units=${p.total_units ?? '?'} sold=${p.sold_units ?? '?'}`);
}

if (projects.length === 0) {
  console.error('\n   This account can see no projects. It needs project rights before a pull means anything.');
  process.exit(1);
}

console.log(bold('\n── Pulling All_Transaction_Data'));
const bundle = await client.allTransactionData(projectFilter);

for (const [name, rows] of Object.entries(bundle)) {
  if (Array.isArray(rows)) console.log(`   ${name.padEnd(20)} ${String(rows.length).padStart(7)} rows`);
}

if (savePath) {
  fs.mkdirSync(path.dirname(path.resolve(savePath)), { recursive: true });
  fs.writeFileSync(savePath, JSON.stringify(bundle, null, 1), 'utf8');
  console.log(`   raw bundle written to ${savePath}`);
}

// ------------------------------------------------------------ schema check

const findings = checkBundleSchema(bundle);
if (findings.length > 0) {
  console.log(bold('\n── Mango has changed since this was written'));
  for (const f of findings) console.log(`   ${f.level.padEnd(15)} ${f.detail}`);

  if (findings.some((f) => f.level === 'missing_column' || f.level === 'missing_table')) {
    console.error('\n   Stopping. A renamed column arrives as nothing and becomes a figure that reads zero.');
    console.error('   Check the endpoint in the browser (F12 → Network → Fetch/XHR) and update the mapper.');
    if (!has('force')) process.exit(1);
    console.error('   --force given; continuing anyway.');
  }
}

// -------------------------------------------------------------------- map

console.log(bold('\n── Mapping'));
const mapped = mapMangoBundle(bundle, { reportDate });

console.log(`   contracts          ${String(mapped.counts.contracts).padStart(7)}`);
console.log(`   cancelled, dropped ${String(mapped.counts.cancelled).padStart(7)}`);
console.log(`   receipts           ${String(mapped.counts.receipts).padStart(7)}`);
console.log(`   units priced       ${String(mapped.counts.units).padStart(7)}`);

const contracted = mapped.data.receivable.reduce((s, r) => s + r.contractualAmount, 0);
const received = mapped.data.receivable.reduce((s, r) => s + r.receiveAmount, 0);
console.log(`\n   contracted         ${money(contracted).padStart(16)}`);
console.log(`   collected          ${money(received).padStart(16)}`);
console.log(`   outstanding        ${money(contracted - received).padStart(16)}`);

if (mapped.saleValueByProject.size > 0) {
  console.log('\n   total sale value, from the active price list:');
  for (const [code, value] of mapped.saleValueByProject) {
    console.log(`     ${code.padEnd(14)} ${money(value).padStart(16)}`);
  }
  console.log('   (this is the figure revenue recognition needs, and it can now be set from here)');
}

for (const issue of mapped.issues) {
  console.log(`\n   ${issue.severity}: ${issue.message}`);
}

if (dryRun) {
  console.log(bold('\n   --dry-run: nothing was written.\n'));
  process.exit(0);
}

// ------------------------------------------------------------------ persist

const companies = await import('../src/lib/db/repositories/companies.ts');
const projectsRepo = await import('../src/lib/db/repositories/projects.ts');
const imports = await import('../src/lib/db/repositories/imports.ts');
const { indexSourceRefs } = await import('../src/lib/calc/aggregate.ts');

const company = companies.listAllCompanies().find((c) => c.companyCode === companyCode);
if (!company) {
  console.error(`\n   No company with code ${companyCode}. Add it in Settings › Companies first.`);
  process.exit(1);
}

// Mango's project codes are matched against the aliases each project already
// carries, which is the same resolution an uploaded workbook goes through —
// so a project recognised in a spreadsheet is recognised here too.
const byAlias = new Map();
for (const project of projectsRepo.listProjects(true)) {
  if (project.companyId !== company.id) continue;
  for (const alias of [project.code, project.name, ...project.aliases]) {
    if (alias) byAlias.set(String(alias).trim().toLowerCase(), project.id);
  }
}

const resolved = mapMangoBundle(bundle, {
  reportDate,
  projectIdByCode: new Map(
    [...new Set(mapped.data.receivable.map((r) => r.projectLabel).filter(Boolean))]
      .map((code) => [code, byAlias.get(String(code).trim().toLowerCase()) ?? null])
      .filter(([, id]) => id),
  ),
});

const unmatched = [...new Set(
  resolved.data.receivable.filter((r) => !r.projectId && r.projectLabel).map((r) => r.projectLabel),
)];
if (unmatched.length > 0) {
  console.log(`\n   ${unmatched.length} Mango project codes match no project in ${company.displayName}:`);
  console.log(`     ${unmatched.join(', ')}`);
  console.log('   Their records are kept and belong to the company, but sit under no project.');
  console.log('   Add the code as an alias in Settings › Projects & Aliases to place them.');
}

indexSourceRefs(resolved.data);

const payload = JSON.stringify(bundle);
const file = {
  fileName: `mango-re-${reportDate}.json`,
  originalName: `Mango RE All_Transaction_Data ${reportDate}`,
  containerFile: null,
  filePath: savePath ?? `mango://${credentials.baseUrl}/re/reportx/All_Transaction_Data`,
  // The hash of what Mango actually returned, so re-running the same pull is
  // recognised as the duplicate it is.
  hash: createHash('sha256').update(payload).digest('hex'),
  size: Buffer.byteLength(payload),
  fileType: 'json',
  project: { projectId: null, projectCode: null, projectName: null, matchedAlias: null, matchedIn: 'api', confidence: 1 },
  reportDate,
  reportType: 'receivable',
  reportTypeLabel: 'Mango RE — sales ledger',
  sheetCount: 1,
  sheets: [],
  data: resolved.data,
  rowCount: resolved.data.receivable.length,
  issues: resolved.issues,
  status: 'parsed',
  error: null,
};

const duplicates = imports.findDuplicates(company.id, [{
  fileName: file.fileName, hash: file.hash, reportDate,
  projectId: null, reportType: 'receivable',
}]);

if (duplicates.length > 0 && !has('force')) {
  console.error(`\n   This pull is identical to one already imported on ${duplicates[0].importedAt.slice(0, 10)}.`);
  console.error('   Nothing was written. Pass --force to import it anyway.');
  process.exit(1);
}

console.log(bold(`\n── Writing into ${company.displayName}`));

const outcome = imports.persistImport({
  companyId: company.id,
  reportDate,
  label: `Mango RE ${reportDate}`,
  userId: null,
  files: [file],
  issues: [],
  mode: 'new',
});

console.log(`   import   ${outcome.importId}`);
console.log(`   snapshot ${outcome.snapshotId}`);
console.log(`   ${outcome.rowCount ?? resolved.data.receivable.length} records`);

// The board figure revenue recognition needs, which Mango happens to know.
const financials = await import('../src/lib/db/repositories/project-financials.ts');
let written = 0;
for (const [code, value] of resolved.saleValueByProject) {
  const projectId = byAlias.get(String(code).trim().toLowerCase());
  if (!projectId) continue;

  const existing = financials.getProjectFinancials(company.id, projectId);
  financials.setProjectFinancials({
    companyId: company.id,
    projectId,
    totalSaleValue: value,
    costBudget: existing?.costBudget ?? null,
    revisedCostBudget: existing?.revisedCostBudget ?? null,
    committedCost: existing?.committedCost ?? null,
    userId: null,
  });
  written += 1;
}
if (written > 0) {
  console.log(`   set the total sale value on ${written} project${written === 1 ? '' : 's'} from the price list`);
}

console.log(bold('\n   Done.\n'));
