/**
 * Provider-agnostic embedding layer.
 * Same pattern as the LLM provider: interface + adapters.
 */

import OpenAI from 'openai';

export interface EmbeddingProvider {
	id: string;
	dimensions: number;
	embed(texts: string[]): Promise<number[][]>;
}

// --- OpenAI Adapter ---

class OpenAIEmbeddingProvider implements EmbeddingProvider {
	id = 'openai';
	dimensions = 1536;
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model = 'text-embedding-3-small') {
		this.client = new OpenAI({ apiKey });
		this.model = model;
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		// OpenAI supports batch embedding natively (max 2048 inputs)
		const batches: string[][] = [];
		for (let i = 0; i < texts.length; i += 2048) {
			batches.push(texts.slice(i, i + 2048));
		}

		const allEmbeddings: number[][] = [];
		for (const batch of batches) {
			const response = await this.client.embeddings.create({
				model: this.model,
				input: batch,
				dimensions: this.dimensions,
			});
			for (const item of response.data) {
				allEmbeddings.push(item.embedding);
			}
		}

		return allEmbeddings;
	}
}

// --- Ollama Adapter ---

class OllamaEmbeddingProvider implements EmbeddingProvider {
	id = 'ollama';
	dimensions = 768;
	private baseUrl: string;
	private model: string;

	constructor(baseUrl = 'http://localhost:11434', model = 'nomic-embed-text') {
		this.baseUrl = baseUrl;
		this.model = model;
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		// Ollama supports batch via array input
		const response = await fetch(`${this.baseUrl}/api/embed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: this.model, input: texts }),
		});

		if (!response.ok) {
			throw new Error(`Ollama embed failed: ${response.status} ${await response.text()}`);
		}

		const data = (await response.json()) as { embeddings: number[][] };
		return data.embeddings;
	}
}

// --- Provider Registry ---

let cachedEmbeddingProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
	if (cachedEmbeddingProvider) return cachedEmbeddingProvider;

	// Anthropic/Google don't have embedding APIs — fall back to OpenAI
	const llmProvider = process.env.LLM_PROVIDER || 'anthropic';
	const providerId = process.env.EMBEDDING_PROVIDER || (
		llmProvider === 'openai' || llmProvider === 'ollama' ? llmProvider : 'openai'
	);
	const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;

	switch (providerId) {
		case 'openai': {
			if (!apiKey) throw new Error('No API key for OpenAI embeddings. Set EMBEDDING_API_KEY or OPENAI_API_KEY.');
			const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
			cachedEmbeddingProvider = new OpenAIEmbeddingProvider(apiKey, model);
			break;
		}
		case 'ollama': {
			const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
			const model = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
			cachedEmbeddingProvider = new OllamaEmbeddingProvider(baseUrl, model);
			break;
		}
		default:
			throw new Error(`Unknown embedding provider: ${providerId}. Supported: openai, ollama`);
	}

	console.log(`[Embeddings] Using provider: ${cachedEmbeddingProvider.id} (${cachedEmbeddingProvider.dimensions} dims)`);

	return cachedEmbeddingProvider;
}

/** Embed a single text. Convenience wrapper. */
export async function embedText(text: string): Promise<number[]> {
	const provider = getEmbeddingProvider();
	const [embedding] = await provider.embed([text]);
	return embedding;
}

/** Embed multiple texts in batch. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
	const provider = getEmbeddingProvider();
	return provider.embed(texts);
}

/** Get the configured embedding dimensions. */
export function getEmbeddingDimensions(): number {
	return getEmbeddingProvider().dimensions;
}
