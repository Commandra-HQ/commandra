import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { requireAuth, type AuthUser } from '../middleware/auth.js';

const getClient = (() => {
	let client: Anthropic | null = null;
	return () => {
		if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
		return client;
	};
})();

export const chatRoutes = new Hono<{ Variables: { user: AuthUser } }>();

chatRoutes.use('*', requireAuth);

chatRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { message, pageIndex, conversationId } = body as {
		message: string;
		pageIndex?: unknown;
		conversationId?: string;
	};

	if (!message?.trim()) return c.json({ error: 'Message required' }, 400);

	// Get or create conversation
	let convId = conversationId;
	if (!convId) {
		const [conv] = await db
			.insert(conversations)
			.values({ userId: user.id, title: message.slice(0, 100) })
			.returning();
		convId = conv.id;
	}

	// Store user message
	await db.insert(messages).values({
		conversationId: convId,
		role: 'user',
		content: message,
	});

	// Load conversation history
	const history = await db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, convId))
		.orderBy(asc(messages.createdAt));

	// Build Claude messages (skip the one we just inserted, it's the current user msg)
	const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
		role: m.role as 'user' | 'assistant',
		content: m.content,
	}));

	const systemPrompt = buildSystemPrompt(pageIndex);

	// Stream response
	return stream(c, async (s) => {
		let fullResponse = '';

		try {
			const response = await getClient().messages.create({
				model: 'claude-sonnet-4-20250514',
				max_tokens: 2048,
				system: systemPrompt,
				messages: claudeMessages,
				stream: true,
			});

			for await (const event of response) {
				if (
					event.type === 'content_block_delta' &&
					event.delta.type === 'text_delta'
				) {
					const text = event.delta.text;
					fullResponse += text;
					await s.write(text);
				}
			}

			// Store assistant response
			await db.insert(messages).values({
				conversationId: convId!,
				role: 'assistant',
				content: fullResponse,
			});

			// Send conversation ID as final metadata (newline-separated)
			await s.write(`\n\n<!--conv:${convId}-->`);
		} catch (err) {
			console.error('Claude API error:', err);
			await s.write('\n\nSorry, something went wrong. Please try again.');
		}
	});
});

function buildSystemPrompt(pageIndex?: unknown): string {
	const base = `You are an AI assistant embedded in a Chrome extension called "Agents for Everyone." You help users understand and interact with web applications.

You are looking at a web page through its structural index — you can see all interactive elements (buttons, links, inputs, forms, tables), their labels, and the page's navigation structure. You do NOT see the actual content, data values, or visual layout.

When the user asks about the page:
- Reference elements by their label and type (e.g., "the 'Submit' button", "the 'Email' input field")
- Describe what actions are possible based on the elements you see
- Suggest step-by-step plans when the user wants to accomplish something
- Be concise and practical

You cannot execute actions yet — only describe and suggest. When suggesting steps, be specific about which elements to interact with.

If the user asks about data or content you can't see (like table values, text content, or images), let them know you can only see the page structure, not the actual data.`;

	if (!pageIndex) {
		return `${base}\n\nNo page is currently indexed. Ask the user to index a page first.`;
	}

	const pi = pageIndex as {
		url?: string;
		title?: string;
		pageType?: string;
		elements?: { type: string; label: string; selector: string }[];
		navigationLinks?: { label: string; href: string }[];
		sitePages?: { url: string; urlPattern: string; title: string; pageType: string; elementCount: number }[];
	};

	const elementsSummary = pi.elements
		? formatElements(pi.elements)
		: 'No elements indexed.';

	const navSummary = pi.navigationLinks?.length
		? pi.navigationLinks
				.slice(0, 20)
				.map((l) => `  - ${l.label || '(no label)'} → ${l.href}`)
				.join('\n')
		: 'No navigation links found.';

	let siteSummary = '';
	if (pi.sitePages?.length) {
		siteSummary = `\n\n## Other Indexed Pages (${pi.sitePages.length} total)\nYou also know about these pages on the same site:\n${pi.sitePages
			.map((p) => `  - ${p.title || p.urlPattern} (${p.pageType}, ${p.elementCount} elements) — ${p.url}`)
			.join('\n')}`;
	}

	return `${base}

## Current Page
- **URL:** ${pi.url || 'Unknown'}
- **Title:** ${pi.title || 'Unknown'}
- **Page type:** ${pi.pageType || 'Unknown'}

## Interactive Elements
${elementsSummary}

## Navigation Links
${navSummary}${siteSummary}`;
}

function formatElements(
	elements: { type: string; label: string; selector: string }[],
): string {
	if (elements.length === 0) return 'No interactive elements found.';

	// Group by type
	const grouped: Record<string, { label: string; selector: string }[]> = {};
	for (const el of elements) {
		if (!grouped[el.type]) grouped[el.type] = [];
		grouped[el.type].push({ label: el.label, selector: el.selector });
	}

	const lines: string[] = [];
	for (const [type, els] of Object.entries(grouped)) {
		lines.push(`### ${type}s (${els.length})`);
		// Show up to 30 per type to keep context manageable
		for (const el of els.slice(0, 30)) {
			lines.push(`  - "${el.label}"`);
		}
		if (els.length > 30) {
			lines.push(`  - ...and ${els.length - 30} more`);
		}
	}

	return lines.join('\n');
}
