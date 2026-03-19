/**
 * Agent file storage — CRUD for agent files in Supabase Storage.
 *
 * Bucket: `agents`, path: `{userId}/{agentSlug}/{filename}`
 * Files: AGENT.yaml, SOUL.md, SKILLS.md, LEARNINGS.md, workspace/*
 */

import { getSupabase } from './supabase.js';

const BUCKET = 'agents';
let bucketEnsured = false;

async function ensureBucket(): Promise<void> {
	if (bucketEnsured) return;

	const supabase = getSupabase();
	const { data } = await supabase.storage.getBucket(BUCKET);
	if (!data) {
		await supabase.storage.createBucket(BUCKET, { public: false });
	}
	bucketEnsured = true;
}

function agentPath(userId: string, agentSlug: string, filename?: string): string {
	const base = `${userId}/${agentSlug}`;
	return filename ? `${base}/${filename}` : base;
}

export async function uploadAgentFile(
	userId: string,
	agentSlug: string,
	filename: string,
	content: string,
): Promise<void> {
	await ensureBucket();
	const supabase = getSupabase();
	const path = agentPath(userId, agentSlug, filename);

	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, content, { upsert: true, contentType: 'text/plain' });

	if (error) throw new Error(`Failed to upload ${path}: ${error.message}`);
}

export async function downloadAgentFile(
	userId: string,
	agentSlug: string,
	filename: string,
): Promise<string | null> {
	await ensureBucket();
	const supabase = getSupabase();
	const path = agentPath(userId, agentSlug, filename);

	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message?.includes('not found') || error.message?.includes('Not Found')) {
			return null;
		}
		throw new Error(`Failed to download ${path}: ${error.message}`);
	}

	return await data.text();
}

export async function deleteAgentFolder(userId: string, agentSlug: string): Promise<void> {
	await ensureBucket();
	const supabase = getSupabase();
	const prefix = agentPath(userId, agentSlug);

	const { data: files } = await supabase.storage.from(BUCKET).list(prefix);
	if (files?.length) {
		const paths = files.map((f) => `${prefix}/${f.name}`);
		await supabase.storage.from(BUCKET).remove(paths);
	}
}

export async function listAgentFiles(
	userId: string,
	agentSlug: string,
): Promise<{ name: string; size: number; updatedAt: string }[]> {
	await ensureBucket();
	const supabase = getSupabase();
	const prefix = agentPath(userId, agentSlug);

	const { data, error } = await supabase.storage.from(BUCKET).list(prefix);
	if (error) throw new Error(`Failed to list ${prefix}: ${error.message}`);

	return (data ?? []).map((f) => ({
		name: f.name,
		size: f.metadata?.size ?? 0,
		updatedAt: f.updated_at ?? f.created_at ?? '',
	}));
}
