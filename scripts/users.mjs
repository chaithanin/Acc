#!/usr/bin/env node
/**
 * User administration from the command line.
 *
 * The dashboard has a Users & Roles screen, which is the normal way to do
 * this. This exists for the two cases that screen cannot cover: setting up a
 * team before anyone can sign in, and recovering when nobody has a working
 * password. Passwords are stored only as scrypt hashes, so a lost one cannot
 * be read back — only replaced.
 *
 * Runs inside the container, where better-sqlite3 and the database both live:
 *
 *   docker exec gtg-app-1 node scripts/users.mjs list
 *   docker exec gtg-app-1 node scripts/users.mjs add you@example.com admin
 *   docker exec gtg-app-1 node scripts/users.mjs add sara@example.com finance 'chosen password'
 *   docker exec gtg-app-1 node scripts/users.mjs reset you@example.com
 *   docker exec gtg-app-1 node scripts/users.mjs disable old@example.com
 *
 * Omitting the password generates a strong one and prints it once.
 *
 * Deliberately plain JavaScript with no imports from the app: the runtime
 * image carries the compiled bundle rather than source.
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

const ROLES = ['admin', 'finance', 'management', 'viewer'];
const MIN_PASSWORD = 12;

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Avoids characters that are easy to misread when a password is passed on
 * verbally or copied off a screen — no O/0, l/1/I.
 */
function generatePassword(length = 20) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage:
  users.mjs list
  users.mjs add <email> <role> [password]
  users.mjs reset <email> [password]
  users.mjs role <email> <role>
  users.mjs disable <email>
  users.mjs enable <email>

Roles: ${ROLES.join(', ')}
Passwords must be at least ${MIN_PASSWORD} characters; omit to generate one.
`);
  process.exit(1);
}

const dataDir = process.env.GTG_DATA_DIR
  ? path.resolve(process.env.GTG_DATA_DIR)
  : path.join(process.cwd(), 'data');

const db = new Database(path.join(dataDir, 'gtg-financial.db'));
db.pragma('foreign_keys = ON');

const now = () => new Date().toISOString();
const findUser = (email) =>
  db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email).trim());

const [command, ...args] = process.argv.slice(2);

function requirePassword(supplied) {
  if (supplied === undefined) return { password: generatePassword(), generated: true };
  if (supplied.length < MIN_PASSWORD) {
    usage(`Refusing a password shorter than ${MIN_PASSWORD} characters.`);
  }
  return { password: supplied, generated: false };
}

function requireRole(role) {
  if (!ROLES.includes(role)) usage(`Unknown role "${role}".`);
  return role;
}

/** Sessions were issued against the old credentials, so they are revoked. */
function revokeSessions(userId) {
  const n = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId).changes;
  if (n > 0) console.log(`  signed out ${n} existing session(s)`);
}

switch (command) {
  case 'list': {
    const rows = db.prepare('SELECT email, name, role, active FROM users ORDER BY role, email').all();
    if (rows.length === 0) {
      console.log('No users yet.');
      break;
    }
    console.log(`\n${'EMAIL'.padEnd(34)} ${'ROLE'.padEnd(12)} STATUS`);
    for (const r of rows) {
      console.log(`${r.email.padEnd(34)} ${r.role.padEnd(12)} ${r.active ? 'active' : 'disabled'}`);
    }
    console.log(`\n${rows.length} user(s).\n`);
    break;
  }

  case 'add': {
    const [email, role, supplied] = args;
    if (!email || !role) usage('add needs an email and a role.');
    requireRole(role);

    if (findUser(email)) {
      usage(`${email} already exists — use "reset" to change its password, or "role" to change its role.`);
    }

    const { password, generated } = requirePassword(supplied);
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      randomUUID(),
      email.trim().toLowerCase(),
      // A display name is editable later; the local part is a sane start.
      email.split('@')[0],
      hashPassword(password),
      role,
      now(),
      now(),
    );

    console.log(`Created ${email} as ${role}.`);
    if (generated) console.log(`  password: ${password}\n  (shown once — store it now)`);
    break;
  }

  case 'reset': {
    const [email, supplied] = args;
    if (!email) usage('reset needs an email.');

    const user = findUser(email);
    if (!user) usage(`${email} does not exist — use "add" to create it.`);

    const { password, generated } = requirePassword(supplied);
    db.prepare('UPDATE users SET password_hash = ?, active = 1, updated_at = ? WHERE id = ?')
      .run(hashPassword(password), now(), user.id);

    console.log(`Reset the password for ${email}.`);
    if (generated) console.log(`  password: ${password}\n  (shown once — store it now)`);
    revokeSessions(user.id);
    break;
  }

  case 'role': {
    const [email, role] = args;
    if (!email || !role) usage('role needs an email and a role.');
    requireRole(role);

    const user = findUser(email);
    if (!user) usage(`${email} does not exist.`);

    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now(), user.id);
    console.log(`${email} is now ${role}.`);
    revokeSessions(user.id);
    break;
  }

  case 'disable':
  case 'enable': {
    const [email] = args;
    if (!email) usage(`${command} needs an email.`);

    const user = findUser(email);
    if (!user) usage(`${email} does not exist.`);

    const active = command === 'enable' ? 1 : 0;
    db.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?').run(active, now(), user.id);
    console.log(`${email} is now ${active ? 'active' : 'disabled'}.`);
    if (!active) revokeSessions(user.id);
    break;
  }

  default:
    usage(command ? `Unknown command "${command}".` : undefined);
}

db.close();
