import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prefer Railway / shell env. Only load repo .env when no DB URL is present (local dev).
if (!process.env.DATABASE_URL && !process.env.MIGRATE_DATABASE_URL) {
	// Monorepo root `commandra/.env` (this file lives under `src/db/`, one level deeper than `src/env.ts`).
	config({ path: path.join(__dirname, '../../../../.env') });
}

// Optional: direct Postgres (e.g. supabase-db private URL) when pooler/public proxy breaks DDL from the runtime network.
const databaseUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		'Set DATABASE_URL or MIGRATE_DATABASE_URL (see deploy/railway/PROVISION.md § Commandra migrations).',
	);
}

const migrationsFolder = path.join(__dirname, '../../drizzle');

let parsed: URL;
try {
	parsed = new URL(databaseUrl);
} catch {
	throw new Error('Invalid DATABASE_URL / MIGRATE_DATABASE_URL.');
}
// Private Railway Postgres (*.railway.internal) typically does not use TLS like public TCP proxies.
const useSslFalse =
	process.env.DRIZZLE_MIGRATE_SSL_DISABLE === '1' || parsed.hostname.endsWith('.railway.internal');

const client = postgres(databaseUrl, {
	max: 1,
	...(useSslFalse ? { ssl: false } : {}),
});
const db = drizzle(client);

await migrate(db, { migrationsFolder });
console.log('Migrations complete.');
await client.end();
