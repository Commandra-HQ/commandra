import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const raw = process.env.DATABASE_URL;
if (!raw?.trim()) {
	throw new Error(
		'DATABASE_URL is unset. Add it to commandra/.env (see comments there for Railway TCP proxy).',
	);
}
if (/REPLACE_|PLACEHOLDER/i.test(raw)) {
	throw new Error(
		'DATABASE_URL still contains placeholders (e.g. REPLACE_TCP_PROXY_*). Replace with the host:port from Railway → supabase-db → Networking → TCP Proxy (see docker/supabase/deploy/railway/SETUP-TWO-PROJECTS.md §7).',
	);
}
let connectionString: string;
try {
	connectionString = new URL(raw).toString();
} catch {
	throw new Error(
		`DATABASE_URL is not a valid URL (check commandra/.env). Got: ${raw.slice(0, 80)}${raw.length > 80 ? '…' : ''}`,
	);
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
