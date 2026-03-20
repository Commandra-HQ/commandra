/**
 * Domain-level S3 file CRUD — per-user domain knowledge stored in Supabase Storage.
 *
 * Bucket: `agents` (reuses existing), path: `domains/{userId}/{sanitizedDomain}/{filename}`
 * Files: KNOWLEDGE.md, WORKFLOWS.md, AGENTS.md, MEMORY.md
 */

import { getSupabase } from './supabase.js';

const BUCKET = 'agents';

/**
 * Sanitize domain for use as a directory name.
 * mail.google.com → mail_google_com
 */
export function sanitizeDomain(domain: string): string {
	return domain
		.replace(/[^a-zA-Z0-9]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
}

function domainPath(userId: string, domain: string, filename?: string): string {
	const base = `domains/${userId}/${sanitizeDomain(domain)}`;
	return filename ? `${base}/${filename}` : base;
}

export async function uploadDomainFile(
	userId: string,
	domain: string,
	filename: string,
	content: string,
): Promise<void> {
	const supabase = getSupabase();
	const path = domainPath(userId, domain, filename);

	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, content, { upsert: true, contentType: 'text/plain' });

	if (error) throw new Error(`Failed to upload ${path}: ${error.message}`);
}

export async function downloadDomainFile(
	userId: string,
	domain: string,
	filename: string,
): Promise<string | null> {
	const supabase = getSupabase();
	const path = domainPath(userId, domain, filename);

	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message?.includes('not found') || error.message?.includes('Not Found')) {
			return null;
		}
		throw new Error(`Failed to download ${path}: ${error.message}`);
	}

	return await data.text();
}

export async function listDomainFiles(
	userId: string,
	domain: string,
): Promise<{ name: string; size: number; updatedAt: string }[]> {
	const supabase = getSupabase();
	const prefix = domainPath(userId, domain);

	const { data, error } = await supabase.storage.from(BUCKET).list(prefix);
	if (error) throw new Error(`Failed to list ${prefix}: ${error.message}`);

	return (data ?? []).map((f) => ({
		name: f.name,
		size: f.metadata?.size ?? 0,
		updatedAt: f.updated_at ?? f.created_at ?? '',
	}));
}
