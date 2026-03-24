/**
 * Upload screenshots to LLM provider's Files API for context-efficient referencing.
 *
 * Instead of embedding base64 in every message (bloats context), we upload once
 * and reference by file_id. Both Anthropic and OpenAI support this:
 *   - Anthropic: beta.files.upload() → file_id → { type: "image", source: { type: "file", file_id } }
 *   - OpenAI: files.create() → file_id → { type: "input_file", file_id }
 */

import { getProvider } from '../llm/index.js';

// Cache to avoid re-uploading the same screenshot in a conversation
const uploadCache = new Map<string, { fileId: string; provider: string; expiresAt: number }>();
const CACHE_TTL = 55 * 60 * 1000; // 55 minutes (URLs expire at 60)

/**
 * Upload a screenshot to the active LLM provider's Files API.
 * Returns a fileId that can be referenced in messages without embedding base64.
 */
export async function uploadScreenshotToProvider(
	base64Data: string,
	cacheKey?: string,
): Promise<string | null> {
	const providerName = process.env.LLM_PROVIDER || 'anthropic';

	// Check cache
	if (cacheKey) {
		const cached = uploadCache.get(cacheKey);
		if (cached && cached.provider === providerName && cached.expiresAt > Date.now()) {
			return cached.fileId;
		}
	}

	try {
		let fileId: string | null = null;

		if (providerName === 'anthropic') {
			fileId = await uploadToAnthropic(base64Data);
		} else if (providerName === 'openai') {
			fileId = await uploadToOpenAI(base64Data);
		}

		if (fileId && cacheKey) {
			uploadCache.set(cacheKey, { fileId, provider: providerName, expiresAt: Date.now() + CACHE_TTL });
		}

		return fileId;
	} catch (err) {
		console.warn('[ProviderUpload] Failed to upload screenshot to provider:', err);
		return null;
	}
}

async function uploadToAnthropic(base64Data: string): Promise<string | null> {
	const Anthropic = (await import('@anthropic-ai/sdk')).default;
	const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

	const buffer = Buffer.from(base64Data, 'base64');
	const blob = new Blob([buffer], { type: 'image/jpeg' });
	const file = new File([blob], `screenshot-${Date.now()}.jpg`, { type: 'image/jpeg' });

	const uploaded = await client.beta.files.upload({
		file,
		betas: ['files-api-2025-04-14'],
	});

	console.log(`[ProviderUpload] Anthropic file uploaded: ${uploaded.id} (${buffer.length} bytes)`);
	return uploaded.id;
}

async function uploadToOpenAI(base64Data: string): Promise<string | null> {
	const OpenAI = (await import('openai')).default;
	const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

	const buffer = Buffer.from(base64Data, 'base64');
	const blob = new Blob([buffer], { type: 'image/jpeg' });
	const file = new File([blob], `screenshot-${Date.now()}.jpg`, { type: 'image/jpeg' });

	const uploaded = await client.files.create({
		file,
		purpose: 'vision',
	});

	console.log(`[ProviderUpload] OpenAI file uploaded: ${uploaded.id} (${buffer.length} bytes)`);
	return uploaded.id;
}

/**
 * Clean up expired cache entries.
 */
export function cleanupProviderUploadCache(): void {
	const now = Date.now();
	for (const [key, entry] of uploadCache) {
		if (entry.expiresAt < now) uploadCache.delete(key);
	}
}
