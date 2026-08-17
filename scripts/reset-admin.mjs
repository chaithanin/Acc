#!/usr/bin/env node
/**
 * Sets an administrator's password directly against the database.
 *
 * For the case every self-hosted deployment eventually hits: nobody has a
 * working password. The generated bootstrap password is shown once and stored
 * only as a hash, so it cannot be recovered — it can only be replaced.
 *
 * Runs inside the container, where better-sqlite3 and the database both live:
 *
 *   docker exec -it gtg-app-1 node scripts/reset-admin.mjs you@example.com 'new password'
 *
 * Creates the account if the email is unknown, otherwise resets that account's
 * password and makes sure it is an active admin.
 *
 * Deliberately plain JavaScript with no imports from the app: it has to work
 * in the runtime image, which carries the compiled bundle rather than source.
 */
import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import path from 'node:path';

// Kept identical to src/lib/db/repositories/users.ts. If the parameters there
// ever change, they must change here too or the hashes will not verify.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/reset-admin.mjs <email> <password>');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Refusing to set a password shorter than 12 characters.');
  process.exit(1);
}

const dataDir = process.env.GTG_DATA_DIR
  ? path.resolve(process.env.GTG_DATA_DIR)
  : path.join(process.cwd(), 'data');

const dbPath = path.join(dataDir, 'gtg-financial.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const now = new Date().toISOString();
const existing = db
  .prepare('SELECT id, name FROM users WHERE lower(email) = lower(?)')
  .get(email.trim());

if (existing) {
  db.prepare(
    `UPDATE users SET password_hash = ?, role = 'admin', active = 1, updated_at = ? WHERE id = ?`,
  ).run(hashPassword(password), now, existing.id);
  console.log(`Reset the password for ${email} and confirmed the account is an active admin.`);
} else {
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)`,
  ).run(randomUUID(), email.trim().toLowerCase(), 'Administrator', hashPassword(password), now, now);
  console.log(`Created administrator ${email}.`);
}

// Existing sessions were issued against the old password, so they are revoked.
const revoked = db.prepare('DELETE FROM auth_sessions').run().changes;
if (revoked > 0) console.log(`Signed out ${revoked} existing session(s).`);

db.close();
