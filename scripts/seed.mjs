#!/usr/bin/env node
/**
 * Creates the database, seeds projects and templates and, on a fresh database,
 * an admin account. Safe to re-run: existing rows are left untouched.
 *
 *   npm run seed
 *   GTG_ADMIN_EMAIL=you@example.com GTG_ADMIN_PASSWORD=secret npm run seed
 */
const { bootstrapDatabase } = await import('../src/lib/db/bootstrap.ts');

const result = bootstrapDatabase();

console.log('Global Top Group – Financial Management Dashboard');
console.log('------------------------------------------------');
console.log(`Projects created:  ${result.createdProjects}`);
console.log(`Templates created: ${result.createdTemplates}`);

if (result.createdAdmin) {
  console.log('');
  console.log('An administrator account was created:');
  console.log(`  Email:    ${result.createdAdmin.email}`);
  console.log(`  Password: ${result.createdAdmin.password}`);
  console.log('');
  console.log('Store it now — it is not shown again. Change it after first sign-in.');
} else {
  console.log('Users already exist; no admin account was created.');
}
