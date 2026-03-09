/**
 * Conversation memory — compresses long message histories.
 *
 * When conversations exceed a threshold, older messages get summarized
 * into a compact paragraph using the fast model. Recent messages are
 * kept verbatim so the agent has full context for the current task.
 */

import { collectStream } from '../llm/index.js';
import type { LLMProvider } from '../llm/types.js';

export interface ConversationMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface CompressedHistory {
	messages: ConversationMessage[];
	wasSummarized: boolean;
}

// Messages above this count trigger summarization
const SUMMARIZE_THRESHOLD = 20;
// Keep this many recent messages verbatim
const KEEP_RECENT = 10;
// Max messages per summarization chunk
const CHUNK_SIZE = 10;

const SUMMARIZE_PROMPT = `You are a conversation summarizer. Summarize the following conversation between a user and an AI browser assistant. Focus on:
- What tasks the user asked for
- What actions were taken (clicks, navigation, form fills)
- Key outcomes (successes, failures, errors)
- Any important context about the web app being used

Be concise. Use 2-4 sentences per chunk of conversation. Do not include greetings or filler.`;

/**
 * Compress conversation history if it's too long.
 * Returns messages ready for the LLM — older messages summarized, recent kept verbatim.
 */
export async function compressHistory(
	messages: ConversationMessage[],
	provider: LLMProvider,
	fastModel: string,
): Promise<CompressedHistory> {
	if (messages.length <= SUMMARIZE_THRESHOLD) {
		return { messages, wasSummarized: false };
	}

	const recentStart = messages.length - KEEP_RECENT;
	const olderMessages = messages.slice(0, recentStart);
	const recentMessages = messages.slice(recentStart);

	// Summarize older messages in chunks
	const summaries: string[] = [];
	for (let i = 0; i < olderMessages.length; i += CHUNK_SIZE) {
		const chunk = olderMessages.slice(i, i + CHUNK_SIZE);
		const summary = await summarizeChunk(chunk, provider, fastModel);
		summaries.push(summary);
	}

	const summaryText = summaries.join('\n\n');
	const summaryMessage: ConversationMessage = {
		role: 'user',
		content: `[Previous conversation summary]\n${summaryText}\n[End of summary — recent messages follow]`,
	};

	return {
		messages: [summaryMessage, ...recentMessages],
		wasSummarized: true,
	};
}

async function summarizeChunk(
	chunk: ConversationMessage[],
	provider: LLMProvider,
	fastModel: string,
): Promise<string> {
	const transcript = chunk
		.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
		.join('\n\n');

	const stream = provider.chat({
		model: fastModel,
		system: SUMMARIZE_PROMPT,
		messages: [{ role: 'user', content: `Summarize this conversation:\n\n${transcript}` }],
		maxTokens: 300,
	});

	const response = await collectStream(stream);
	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => (b as { text: string }).text)
		.join('');

	return text || '(No summary generated)';
}
