/**
 * Read the unit inventory out of the Booking API.
 *
 *   node --import ./scripts/register-ts.mjs scripts/booking-pull.mjs --company GTG
 *
 * Booking and Mango RE answer different questions, and this pull stays on its
 * own side of that line. Mango holds the money — contracts, receipts,
 * transfers, targets — and remains the source of every financial figure.
 * Booking holds the inventory: which units exist, what they are priced at, and
 * where each one stands in the funnel. Nothing here is written as a receivable
 * or as income; a unit marked sold in Booking is not a receipt of anything.
 *
 * What it does set is what a project expects to sell for, which is the board
 * figure the revenue-recognition percentage divides by.
 *
 * Environment:
 *   BOOKING_API_KEY   bk_live_… — one key per system, kept out of git
 *   BOOKING_API_URL   optional; defaults to the published base URL
 *
 * Flags:
 *   --company <code>    which company in the dashboard this belongs to
 *   --project <name>    limit to one Booking project
 *   --date YYYY-MM-DD   the date to file it under (default: today)
 *   --dry-run           fetch, map and report; write nothing
 *   --save <file>       also write the raw units to disk, for inspection
 *   --force             write even when the schema check has something to say
 *
 * docs/BOOKING-API.md has the rest.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const companyCode = flag('company');
const projectFilter = flag('project');
const reportDate = flag('date') ?? new Date().toISOString().slice(0, 10);
const dryRun = has('dry-run');
const savePath = flag('save');

if (!dryRun && !companyCode) {
  console.error('Which company is this for? Pass --company <code>, or --dry-run to only look.');
  process.exit(2);
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));

const { BookingClient, credentialsFromEnv, checkUnits, BookingError } =
  await import('../src/lib/sources/booking/client.ts');
const { mapBookingUnits } = await import('../src/lib/sources/booking/map.ts');

let credentials;
try {
  credentials = credentialsFromEnv();
} catch (err) {
  console.error(err instanceof BookingError ? err.message : err);
  process.exit(2);
}

console.log(bold(`\n── Booking API · ${credentials.baseUrl}`));

const client = new BookingClient(credentials);

// Ask who the key is before asking it for anything: a missing scope is
// otherwise a 403 on the endpoint that needs it, which reads like an outage.
let key;
try {
  key = await client.preflight(['read:projects', 'read:units']);
} catch (err) {
  console.error(`\n   ${err.message}`);
  process.exit(1);
}
console.log(`   key "${key.name}" · scopes: ${key.scopes.join(', ')}`);

const projects = await client.projects();
console.log(`   ${projects.length} projects visible to this key`);
for (const p of projects) {
  console.log(`     ${String(p.name).padEnd(32)} units=${p.units?.total ?? '?'} sold=${p.units?.sold ?? '?'}`);
}

console.log(bold('\n── Pulling units'));
const units = await client.units(projectFilter ? { project: projectFilter } : {});
console.log(`   ${units.length} units`);

if (savePath) {
  fs.mkdirSync(path.dirname(path.resolve(savePath)), { recursive: true });
  fs.writeFileSync(savePath, JSON.stringify(units, null, 1), 'utf8');
  console.log(`   written to ${savePath}`);
}

const findings = checkUnits(units);
if (findings.length > 0) {
  console.log(bold('\n── The answer is not the shape the guide describes'));
  for (const f of findings) console.log(`   ${f.level.padEnd(14)} ${f.detail}`);
  if (!has('force') && !dryRun) {
    console.error('\n   Stopping. A missing price becomes a project that reads as unsold rather than unpriced.');
    console.error('   Pass --force to write anyway.');
    process.exit(1);
  }
}

// Agency totals are a bonus rather than the point, so a key without the scope
// reports less instead of failing.
let agencies = [];
if (client.has('read:agencies')) {
  agencies = await client.agencySales(projectFilter ? { project: projectFilter } : {});
  console.log(`   ${agencies.length} agencies with sales`);
} else {
  console.log('   (no read:agencies on this key — skipping agency totals)');
}

console.log(bold('\n── Inventory'));
const mapped = mapBookingUnits(units, agencies, { reportDate });

const pad = (s, n) => String(s).padEnd(n);
console.log(`   ${pad('project', 32)} ${'on sale'.padStart(8)} ${'sold'.padStart(6)} `
  + `${'pipeline'.padStart(9)} ${'available'.padStart(10)} ${'sale value'.padStart(16)}`);
for (const row of mapped.inventory) {
  console.log(`   ${pad(row.project, 32)} ${String(row.sellable).padStart(8)} ${String(row.sold).padStart(6)} `
    + `${String(row.pipeline).padStart(9)} ${String(row.available).padStart(10)} ${money(row.saleValue).padStart(16)}`);
}

const totalValue = mapped.inventory.reduce((s, r) => s + r.saleValue, 0);
const soldValue = mapped.inventory.reduce((s, r) => s + r.soldValue, 0);
console.log(`\n   total sale value  ${money(totalValue).padStart(16)}`);
console.log(`   sold so far       ${money(soldValue).padStart(16)}`
  + (totalValue > 0 ? `   (${((soldValue / totalValue) * 100).toFixed(1)}% taken up)` : ''));

for (const issue of mapped.issues) console.log(`\n   ${issue.severity}: ${issue.message}`);

if (dryRun) {
  console.log(bold('\n   --dry-run: nothing was written.\n'));
  process.exit(0);
}

// ------------------------------------------------------------------ persist

const companies = await import('../src/lib/db/repositories/companies.ts');
const projectsRepo = await import('../src/lib/db/repositories/projects.ts');
const financials = await import('../src/lib/db/repositories/project-financials.ts');

const company = companies.listAllCompanies().find((c) => c.companyCode === companyCode);
if (!company) {
  console.error(`\n   No company with code ${companyCode}. Add it in Settings › Companies first.`);
  process.exit(1);
}

// The same alias resolution an uploaded workbook goes through, so a project
// recognised in a spreadsheet is recognised here.
const byAlias = new Map();
for (const project of projectsRepo.listProjects(true)) {
  if (project.companyId !== company.id) continue;
  for (const alias of [project.code, project.name, ...project.aliases]) {
    if (alias) byAlias.set(String(alias).trim().toLowerCase(), project.id);
  }
}

console.log(bold(`\n── Writing into ${company.displayName}`));

let written = 0;
const unplaced = [];
for (const row of mapped.inventory) {
  const projectId = byAlias.get(row.project.trim().toLowerCase());
  if (!projectId) {
    unplaced.push(row.project);
    continue;
  }

  // Only the sale value is set. Cost budget and commitments are somebody
  // else's figures and Booking knows nothing about them.
  const existing = financials.getProjectFinancials(company.id, projectId);

  if (existing?.totalSaleValue && Math.abs(existing.totalSaleValue - row.saleValue) > 1) {
    const from = money(existing.totalSaleValue);
    console.log(`   ${row.project}: sale value ${from} → ${money(row.saleValue)}`);
  }

  financials.setProjectFinancials({
    companyId: company.id,
    projectId,
    totalSaleValue: row.saleValue,
    costBudget: existing?.costBudget ?? null,
    revisedCostBudget: existing?.revisedCostBudget ?? null,
    committedCost: existing?.committedCost ?? null,
    userId: null,
  });
  written += 1;
}

console.log(`   set the total sale value on ${written} project${written === 1 ? '' : 's'}`);
if (unplaced.length > 0) {
  console.log(`   ${unplaced.length} Booking project${unplaced.length === 1 ? '' : 's'} match no project here: ${unplaced.join(', ')}`);
  console.log('   Add the name as an alias in Settings › Projects & Aliases to place them.');
}

console.log(bold('\n   Done.\n'));
