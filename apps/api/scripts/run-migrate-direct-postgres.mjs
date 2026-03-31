import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Run Drizzle migrations against **primary Postgres** (not Supavisor transaction pooler).
 * Pooler often resets connections during DDL → use this from Railway SSH on `api`:
 *
 *   railway ssh -s api -- node /app/apps/api/scripts/run-migrate-direct-postgres.mjs
 *
 * Env (optional overrides):
 *   MIGRATE_DB_DIRECT_HOST (default supabase-db.railway.internal)
 *   MIGRATE_DB_DIRECT_USER (default postgres)
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const poolerUrl = process.env.DATABASE_URL;
if (!poolerUrl) {
	console.error('DATABASE_URL is missing.');
	process.exit(1);
}
const ref = new URL(poolerUrl);
const password = ref.password;
if (!password) {
	console.error('DATABASE_URL has no password.');
	process.exit(1);
}

const host = process.env.MIGRATE_DB_DIRECT_HOST ?? 'supabase-db.railway.internal';
// Pooler user is often `postgres.<tenant>` — same role exists on the DB; `postgres` alone may use a different password.
const user = process.env.MIGRATE_DB_DIRECT_USER ?? decodeURIComponent(ref.username || 'postgres');
const database = ref.pathname.replace(/^\//, '') || 'postgres';

const sql = postgres({
	host,
	port: 5432,
	user,
	password,
	database,
	max: 1,
	ssl: false,
});

const migrationsFolder = path.join(__dirname, '../drizzle');
const db = drizzle(sql);
await migrate(db, { migrationsFolder });
console.log('Migrations complete.');
await sql.end();
