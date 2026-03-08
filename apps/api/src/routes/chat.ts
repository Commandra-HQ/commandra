import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { getConnectionByUser, sendActionRequest, sendApprovalRequest, isKilled, resetKill } from '../ws/handler.js';
import { classifyAction } from '../safety/classifier.js';
import { logAction } from '../safety/audit.js';

const getClient = (() => {
	let client: Anthropic | null = null;
	return () => {
		if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
		return client;
	};
})();

const browserTools: Anthropic.Tool[] = [
	{
		name: 'click_element',
		description: 'Click an interactive element on the page. Use the CSS selector from the page index.',
		input_schema: {
			type: 'object' as const,
			properties: {
				selector: { type: 'string', description: 'CSS selector of the element to click' },
			},
			required: ['selector'],
		},
	},
	{
		name: 'type_text',
		description: 'Type text into an input field or textarea. Clears existing content first.',
		input_schema: {
			type: 'object' as const,
			properties: {
				selector: { type: 'string', description: 'CSS selector of the input element' },
				text: { type: 'string', description: 'Text to type into the field' },
			},
			required: ['selector', 'text'],
		},
	},
	{
		name: 'select_option',
		description: 'Select an option from a dropdown/select element.',
		input_schema: {
			type: 'object' as const,
			properties: {
				selector: { type: 'string', description: 'CSS selector of the select element' },
				value: { type: 'string', description: 'Value of the option to select' },
			},
			required: ['selector', 'value'],
		},
	},
	{
		name: 'navigate',
		description: 'Navigate the browser to a specific URL.',
		input_schema: {
			type: 'object' as const,
			properties: {
				url: { type: 'string', description: 'The URL to navigate to' },
			},
			required: ['url'],
		},
	},
	{
		name: 'get_page_state',
		description: 'Get the current page structure including all interactive elements and selectors. Use after navigating or clicking to see the updated page.',
		input_schema: {
			type: 'object' as const,
			properties: {},
			required: [],
		},
	},
];

export const chatRoutes = new Hono<{ Variables: { user: AuthUser } }>();

chatRoutes.use('*', requireAuth);

chatRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { message, pageIndex, conversationId, selectedElement } = body as {
		message: string;
		pageIndex?: unknown;
		conversationId?: string;
		selectedElement?: { selector: string; fallbackSelectors: string[]; tag: string; label: string; type?: string; attributes: Record<string, string> };
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

	const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
		role: m.role as 'user' | 'assistant',
		content: m.content,
	}));

	const systemPrompt = buildSystemPrompt(pageIndex, selectedElement);

	// Check if extension is connected — determines if we can use tools
	const connectionId = getConnectionByUser(user.id);
	const canAct = !!connectionId;
	if (connectionId) resetKill(connectionId);

	// Stream response
	return stream(c, async (s) => {
		let fullResponse = '';

		try {
			if (canAct) {
				// Agentic loop — tool use enabled
				fullResponse = await runAgentLoop(
					systemPrompt,
					claudeMessages,
					connectionId!,
					user.id,
					async (text) => { await s.write(text); },
				);
			} else {
				// Simple chat — no tools, just streaming text
				fullResponse = await runSimpleChat(
					systemPrompt,
					claudeMessages,
					async (text) => { await s.write(text); },
				);
			}

			// Store assistant response
			await db.insert(messages).values({
				conversationId: convId!,
				role: 'assistant',
				content: fullResponse,
			});

			// Send conversation ID as final metadata
			await s.write(`\n\n<!--conv:${convId}-->`);
		} catch (err) {
			console.error('Chat error:', err);
			await s.write('\n\nSorry, something went wrong. Please try again.');
		}
	});
});

/**
 * Simple chat — no tool use, just streaming text response.
 */
async function runSimpleChat(
	systemPrompt: string,
	messages: Anthropic.MessageParam[],
	onText: (text: string) => Promise<void>,
): Promise<string> {
	let fullResponse = '';

	const response = await getClient().messages.create({
		model: 'claude-sonnet-4-20250514',
		max_tokens: 2048,
		system: systemPrompt,
		messages,
		stream: true,
	});

	for await (const event of response) {
		if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
			fullResponse += event.delta.text;
			await onText(event.delta.text);
		}
	}

	return fullResponse;
}

/**
 * Agentic loop — Claude can call browser tools, observe results, and continue.
 * Each tool call is classified (safe/review/blocked) before execution.
 * Review actions pause for user approval. Blocked actions are rejected.
 */
async function runAgentLoop(
	systemPrompt: string,
	chatMessages: Anthropic.MessageParam[],
	connectionId: string,
	userId: string,
	onText: (text: string) => Promise<void>,
	maxIterations = 10,
): Promise<string> {
	let fullResponse = '';
	let currentMessages = [...chatMessages];
	let iterations = 0;

	while (iterations < maxIterations) {
		// Check kill switch
		if (isKilled(connectionId)) {
			const msg = '\n\n[Agent stopped by user]';
			fullResponse += msg;
			await onText(msg);
			break;
		}

		iterations++;

		const response = await getClient().messages.create({
			model: 'claude-sonnet-4-20250514',
			max_tokens: 4096,
			system: systemPrompt + '\n\nYou have access to browser action tools. When the user asks you to DO something on the page, use the tools. When they ask to KNOW something, just respond with text. After using a tool, observe the result and decide if you need to take more actions or if the task is complete.',
			messages: currentMessages,
			tools: browserTools,
		});

		const toolResults: Anthropic.ToolResultBlockParam[] = [];
		let hasToolUse = false;

		for (const block of response.content) {
			if (block.type === 'text') {
				fullResponse += block.text;
				await onText(block.text);
			} else if (block.type === 'tool_use') {
				hasToolUse = true;

				// Check kill switch before each action
				if (isKilled(connectionId)) {
					toolResults.push({
						type: 'tool_result',
						tool_use_id: block.id,
						content: JSON.stringify({ success: false, error: 'Agent stopped by user' }),
						is_error: true,
					});
					continue;
				}

				const toolArgs = block.input as Record<string, unknown>;
				const elementLabel = (toolArgs.description as string) || (toolArgs.selector as string) || '';

				// Classify action
				const classification = classifyAction({
					toolName: block.name,
					args: toolArgs,
					elementLabel,
				});

				console.log(`[Safety] ${block.name} "${elementLabel}" → ${classification.level} (${classification.reason})`);

				// Handle blocked actions
				if (classification.level === 'blocked') {
					const blockMsg = `\n[Blocked: ${classification.reason}]\n`;
					fullResponse += blockMsg;
					await onText(blockMsg);

					await logAction({ userId, action: block.name, safetyLevel: 'blocked', approved: false, metadata: { args: toolArgs, reason: classification.reason } });

					toolResults.push({
						type: 'tool_result',
						tool_use_id: block.id,
						content: JSON.stringify({ success: false, error: `Blocked: ${classification.reason}. Ask the user to confirm this action explicitly.` }),
						is_error: true,
					});
					continue;
				}

				// Handle review actions — request approval
				if (classification.level === 'review') {
					const approvalMsg = `\n[Awaiting approval: ${block.name} — ${classification.reason}]\n`;
					fullResponse += approvalMsg;
					await onText(approvalMsg);

					try {
						const approval = await sendApprovalRequest(connectionId, {
							action: block.name,
							selector: toolArgs.selector as string,
							label: elementLabel,
							reason: classification.reason,
						});

						if (!approval.approved) {
							const rejectMsg = `\n[User rejected: ${approval.reason || 'No reason given'}]\n`;
							fullResponse += rejectMsg;
							await onText(rejectMsg);

							await logAction({ userId, action: block.name, safetyLevel: 'review', approved: false, metadata: { args: toolArgs, reason: approval.reason } });

							toolResults.push({
								type: 'tool_result',
								tool_use_id: block.id,
								content: JSON.stringify({ success: false, error: `User rejected this action. ${approval.reason || ''}` }),
								is_error: true,
							});
							continue;
						}
					} catch {
						await logAction({ userId, action: block.name, safetyLevel: 'review', approved: false, metadata: { args: toolArgs, error: 'Approval failed' } });
						toolResults.push({
							type: 'tool_result',
							tool_use_id: block.id,
							content: JSON.stringify({ success: false, error: 'Could not get user approval' }),
							is_error: true,
						});
						continue;
					}
				}

				// Execute the action (safe or approved review)
				const statusMsg = `\n[Action: ${block.name}${toolArgs.selector ? ` on "${toolArgs.selector}"` : ''}${toolArgs.url ? ` to ${toolArgs.url}` : ''}]\n`;
				fullResponse += statusMsg;
				await onText(statusMsg);

				try {
					const result = await sendActionRequest(connectionId, block.name, toolArgs);
					await logAction({ userId, action: block.name, safetyLevel: classification.level, approved: true, metadata: { args: toolArgs, result } });
					toolResults.push({
						type: 'tool_result',
						tool_use_id: block.id,
						content: JSON.stringify(result),
					});
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					await logAction({ userId, action: block.name, safetyLevel: classification.level, approved: true, metadata: { args: toolArgs, error: errorMsg } });
					toolResults.push({
						type: 'tool_result',
						tool_use_id: block.id,
						content: JSON.stringify({ success: false, error: errorMsg }),
						is_error: true,
					});
				}
			}
		}

		if (!hasToolUse || response.stop_reason === 'end_turn') {
			break;
		}

		currentMessages = [
			...currentMessages,
			{ role: 'assistant', content: response.content },
			{ role: 'user', content: toolResults },
		];
	}

	return fullResponse;
}

function buildSystemPrompt(pageIndex?: unknown, selectedElement?: { selector: string; fallbackSelectors: string[]; tag: string; label: string; type?: string; attributes: Record<string, string> }): string {
	const base = `You are an AI assistant embedded in a Chrome extension called "Agents for Everyone." You help users understand and interact with web applications.

You are looking at a web page through its structural index — you can see all interactive elements (buttons, links, inputs, forms, tables), their labels, and the page's navigation structure. You do NOT see the actual content, data values, or visual layout.

When the user asks about the page:
- Reference elements by their label and type (e.g., "the 'Submit' button", "the 'Email' input field")
- Describe what actions are possible based on the elements you see
- Suggest step-by-step plans when the user wants to accomplish something
- Be concise and practical

When the user asks you to DO something (click, type, navigate):
- Use your browser tools to execute the actions
- After each action, use get_page_state to see the updated page if needed
- Confirm what you did after completing the task
- If something fails, explain what happened and suggest alternatives

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

	let selectedSummary = '';
	if (selectedElement) {
		const attrs = Object.entries(selectedElement.attributes)
			.map(([k, v]) => `${k}="${v}"`)
			.join(', ');
		selectedSummary = `\n\n## Selected Element
The user has pointed at a specific element on the page:
- **Tag:** <${selectedElement.tag}>
- **Label:** "${selectedElement.label}"
- **Selector:** \`${selectedElement.selector}\`
- **Fallback selectors:** ${selectedElement.fallbackSelectors.map((s) => `\`${s}\``).join(', ') || 'none'}
${selectedElement.type ? `- **Type:** ${selectedElement.type}` : ''}
${attrs ? `- **Attributes:** ${attrs}` : ''}

When the user says "this element", "that", "it", or refers to something they selected, they mean THIS element. Use the provided selector.`;
	}

	return `${base}

## Current Page
- **URL:** ${pi.url || 'Unknown'}
- **Title:** ${pi.title || 'Unknown'}
- **Page type:** ${pi.pageType || 'Unknown'}

## Interactive Elements
${elementsSummary}

## Navigation Links
${navSummary}${siteSummary}${selectedSummary}`;
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
			lines.push(`  - "${el.label}" [selector: ${el.selector}]`);
		}
		if (els.length > 30) {
			lines.push(`  - ...and ${els.length - 30} more`);
		}
	}

	return lines.join('\n');
}
