/**
 * Supabase client singleton — lazy-initialized from env vars.
 * Uses the service role key to bypass RLS (server-side only).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
	if (client) return client;

	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !key) {
		throw new Error(
			'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for agent file storage',
		);
	}

	client = createClient(url, key);
	return client;
}
