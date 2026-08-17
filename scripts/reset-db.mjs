#!/usr/bin/env node
/**
 * Deletes the local database and every stored upload, then re-seeds.
 * Development convenience — it destroys data, so it asks for confirmation
 * unless FORCE=1 is set.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

const dataDir = process.env.GTG_DATA_DIR
  ? path.resolve(process.env.GTG_DATA_DIR)
  : path.join(process.cwd(), 'data');

if (process.env.FORCE !== '1') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This deletes the database and all uploaded files in ${dataDir}. Type "yes" to continue: `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled. Nothing was deleted.');
    process.exit(0);
  }
}

await rm(dataDir, { recursive: true, force: true });
console.log(`Removed ${dataDir}`);

const { bootstrapDatabase } = await import('../src/lib/db/bootstrap.ts');
const result = bootstrapDatabase();

console.log(`Re-seeded ${result.createdProjects} projects and ${result.createdTemplates} templates.`);
if (result.createdAdmin) {
  console.log(`Admin: ${result.createdAdmin.email} / ${result.createdAdmin.password}`);
}
