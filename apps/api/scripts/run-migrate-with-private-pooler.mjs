import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * One-off prod migrations on Railway when DATABASE_URL uses a public TCP proxy
 * that does not accept connections from inside Railway (or pooler needs private DNS).
 *
 * Usage (default private host matches PROVISION.md service names):
 *   railway ssh -s api -- node apps/api/scripts/run-migrate-with-private-pooler.mjs
 *
 * Override pooler hostname if yours differs:
 *   MIGRATE_POOLER_HOST=your-pooler.railway.internal
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.DATABASE_URL;
if (!base) {
	console.error('DATABASE_URL is missing.');
	process.exit(1);
}
const host = process.env.MIGRATE_POOLER_HOST ?? 'supabase-supavisor.railway.internal';
const u = new URL(base);
u.hostname = host;
// Transaction mode (5432) often breaks DDL migrator; session pooler (6543) matches `POOLER_POOL_MODE=session` upstream.
u.port = process.env.MIGRATE_POOLER_PORT ?? '6543';
// Public Railway TCP URLs often use ?sslmode=require; private *.railway.internal Postgres usually expects no TLS.
for (const k of [...u.searchParams.keys()]) {
	if (k.toLowerCase() === 'sslmode') u.searchParams.delete(k);
}
const databaseUrl = u.toString();

const migrationsFolder = path.join(__dirname, '../drizzle');
const client = postgres(databaseUrl, { max: 1, ssl: false });
const db = drizzle(client);
await migrate(db, { migrationsFolder });
console.log('Migrations complete.');
await client.end();
