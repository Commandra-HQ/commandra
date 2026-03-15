/**
 * System prompts for the agent.
 */

import { PLANNING_INSTRUCTIONS } from './planner.js';

const BASE_PROMPT = `You are an AI assistant embedded in a Chrome extension called "Commandra." You help users understand and interact with web applications. You execute tasks in the user's own browser — they are already logged in, and you can see and interact with the page as they would.

## How You See the Page
You have a structural index of the current page: all interactive elements (buttons, links, inputs, forms, tables) with their labels, CSS selectors, and navigation links. You also receive:
- **Site knowledge:** Indexed pages, known workflows, and app behavior notes from domain memory
- **User context:** Personal preferences, corrections, past interactions, and saved automations
- **Prior context:** Semantically similar past conversations, relevant elements, and matching flows found via embeddings
- **User identity:** The logged-in user detected from the page (when available)
Use ALL of this context to inform your approach. Don't navigate blindly — check what you already know first.

## Core Behaviors

**When the user asks about the page:** Reference elements by label/type. Describe what's possible. Be concise.

**When the user asks you to DO something:**
- Check domain memory and indexed pages for known workflows FIRST
- Use browser tools to execute actions
- Page state auto-refreshes after click, navigate, type, and select actions — you'll see updated elements in the tool result
- **CRITICAL: After clicking buttons that open modals/dialogs/compose windows**, ALWAYS call refresh_page_state before interacting with the new elements. Modal elements won't be in the auto-refresh if they take time to render.
- For contenteditable elements (rich text editors, compose bodies, message inputs): type_text handles these — just use the selector. Most modern apps use contenteditable divs, NOT regular inputs.
- Elements marked "inOverlay: true" are in modals/dialogs — these take priority over background elements.
- Use go_back to return to the previous page
- Confirm what you did after completing the task

**When reading/extracting data:**
- read_table for tabular data (structured headers + rows)
- read_text for specific element content
- scroll for content below the fold
- wait_for_element for loading/dynamic content
- export_data to format as CSV/JSON

**Memory management:**
- Use save_memory IMMEDIATELY when the user corrects you or states a preference
- Use recall_memory to search past learnings when context is missing
- Check the "Prior Context" section — it may contain relevant past conversations and saved flows

## Sub-Agents (Parallel Work)
You can spawn sub-agents to work in parallel browser tabs. Use them ONLY when genuinely beneficial:

**When to use spawn_agent:**
- The task requires PARALLEL work on 2+ different websites (e.g., "compare pricing on Notion vs Confluence")
- You need to collect information from multiple pages simultaneously while staying on the current page
- The task explicitly asks to do things on different sites at once (e.g., "send an email on Gmail AND create a Jira ticket")

**When NOT to use spawn_agent:**
- The user mentions a single site → just navigate there yourself
- The task is sequential on the same site → do it yourself step by step
- The user says "go to GitHub" → that's a single-site task, don't spawn
- You're unsure → default to doing it yourself. Sub-agents add complexity.

**How to use:**
1. Call spawn_agent with a task + targetUrl for each parallel site
2. Call wait_for_agents to collect results
3. Synthesize into one response

## Context Efficiency
- Do NOT take excessive screenshots — page state auto-refreshes after actions
- Only screenshot when you need visual confirmation of something not in the element index
- Keep tool usage efficient to avoid context limits`;

interface SelectedElement {
	selector: string;
	fallbackSelectors: string[];
	tag: string;
	label: string;
	type?: string;
	attributes: Record<string, string>;
}

interface PageContext {
	url?: string;
	title?: string;
	pageType?: string;
	lastIndexedAt?: string | Date;
	userIdentity?: { username?: string; avatar?: string };
	elements?: { type: string; label: string; selector: string }[];
	navigationLinks?: { label: string; href: string }[];
	sitePages?: {
		url: string;
		urlPattern: string;
		title: string;
		pageType: string;
		elementCount: number;
		lastIndexedAt?: string | Date;
		keyElements?: { type: string; label: string; selector: string }[];
		navigationLinks?: { label: string; href: string }[];
	}[];
}

export function buildSystemPrompt(
	pageIndex?: unknown,
	selectedElements?: SelectedElement[],
	domainMemory?: string,
	userMemory?: string,
	priorContext?: string,
): string {
	if (!pageIndex) {
		return `${BASE_PROMPT}\n\nNo page is currently indexed. Ask the user to index a page first.`;
	}

	const pi = pageIndex as PageContext;

	const elementsSummary = pi.elements ? formatElements(pi.elements) : 'No elements indexed.';

	const navSummary = pi.navigationLinks?.length
		? pi.navigationLinks
				.slice(0, 15)
				.map((l) => `  - ${l.label || '(no label)'} → ${l.href}`)
				.join('\n')
		: 'No navigation links found.';

	let siteSummary = '';
	if (pi.sitePages?.length) {
		const pageDetails = pi.sitePages.map((p) => {
			let detail = `### ${p.title || p.urlPattern} (${p.pageType})\n  URL: ${p.url}\n  ${p.elementCount} elements`;
			if (p.lastIndexedAt) {
				const age = Date.now() - new Date(p.lastIndexedAt).getTime();
				const mins = Math.floor(age / 60000);
				detail +=
					mins < 60 ? ` (indexed ${mins}m ago)` : ` (indexed ${Math.floor(mins / 60)}h ago)`;
			}
			if (p.keyElements?.length) {
				const grouped: Record<string, string[]> = {};
				for (const el of p.keyElements) {
					if (!grouped[el.type]) grouped[el.type] = [];
					grouped[el.type].push(`"${el.label}" [${el.selector}]`);
				}
				for (const [type, els] of Object.entries(grouped)) {
					detail += `\n  ${type}s: ${els.slice(0, 8).join(', ')}${els.length > 8 ? ` (+${els.length - 8} more)` : ''}`;
				}
			}
			if (p.navigationLinks?.length) {
				detail += `\n  Links: ${p.navigationLinks.map((l) => `${l.label || '(no label)'} → ${l.href}`).join(', ')}`;
			}
			return detail;
		});

		siteSummary = `\n\n## Other Indexed Pages (${pi.sitePages.length} total)\nYou know these pages and their elements. Use navigate to go to them, then use their selectors.\n\n${pageDetails.join('\n\n')}`;
	}

	let selectedSummary = '';
	if (selectedElements?.length) {
		if (selectedElements.length === 1) {
			const el = selectedElements[0];
			const attrs = Object.entries(el.attributes)
				.map(([k, v]) => `${k}="${v}"`)
				.join(', ');
			selectedSummary = `\n\n## Selected Element
The user has pointed at a specific element on the page:
- **Tag:** <${el.tag}>
- **Label:** "${el.label}"
- **Selector:** \`${el.selector}\`
- **Fallback selectors:** ${el.fallbackSelectors.map((s) => `\`${s}\``).join(', ') || 'none'}
${el.type ? `- **Type:** ${el.type}` : ''}
${attrs ? `- **Attributes:** ${attrs}` : ''}

When the user says "this element", "that", "it", or refers to something they selected, they mean THIS element. Use the provided selector.`;
		} else {
			const elementList = selectedElements
				.map((el, i) => {
					return `${i + 1}. <${el.tag}> "${el.label}" — selector: \`${el.selector}\``;
				})
				.join('\n');
			selectedSummary = `\n\n## Selected Elements (${selectedElements.length})
The user has selected ${selectedElements.length} elements on the page by dragging over an area:
${elementList}

When the user refers to "these elements" or "the selected elements", they mean this set. Use the provided selectors.`;
		}
	}

	let memorySummary = '';
	if (domainMemory) {
		memorySummary = `\n\n## What You Know About This App\n${domainMemory}`;
	}

	let userMemorySummary = '';
	if (userMemory) {
		userMemorySummary = `\n\n## What You Know About This User\n${userMemory}`;
	}

	let priorContextSummary = '';
	if (priorContext) {
		priorContextSummary = `\n\n## Prior Context (from embeddings)\nThese are semantically similar past interactions, relevant elements, and saved automations found via vector search. Use this context to inform your approach — the user may be asking to repeat or build on previous work.\n${priorContext}`;
	}

	let identitySummary = '';
	if (pi.userIdentity?.username) {
		identitySummary = `\n- **Logged-in user:** ${pi.userIdentity.username}`;
	}

	return `${BASE_PROMPT}

## Current Page
- **URL:** ${pi.url || 'Unknown'}
- **Title:** ${pi.title || 'Unknown'}
- **Page type:** ${pi.pageType || 'Unknown'}
- **Last indexed:** ${pi.lastIndexedAt ? formatIndexAge(pi.lastIndexedAt) : 'Unknown'}${identitySummary}

## Interactive Elements
${elementsSummary}

## Navigation Links
${navSummary}${siteSummary}${selectedSummary}${memorySummary}${userMemorySummary}${priorContextSummary}${PLANNING_INSTRUCTIONS}`;
}

function formatIndexAge(lastIndexedAt: string | Date): string {
	const age = Date.now() - new Date(lastIndexedAt).getTime();
	const hours = Math.floor(age / (1000 * 60 * 60));
	const mins = Math.floor(age / (1000 * 60));

	if (hours >= 24) {
		const days = Math.floor(hours / 24);
		return `${days}d ago ⚠ STALE — page structure may have changed. Use refresh_page_state before interacting with elements.`;
	}
	if (hours >= 1) {
		return `${hours}h ago${hours > 6 ? ' ⚠ Data may be stale — consider using refresh_page_state' : ''}`;
	}
	if (mins > 5) {
		return `${mins}m ago — use refresh_page_state if elements seem wrong`;
	}
	return `${mins}m ago (fresh)`;
}

function formatElements(elements: { type: string; label: string; selector: string; inOverlay?: boolean }[]): string {
	if (elements.length === 0) return 'No interactive elements found.';

	// Separate overlay elements (modals/dialogs) from page elements
	const overlayElements = elements.filter((el) => el.inOverlay);
	const pageElements = elements.filter((el) => !el.inOverlay);

	const lines: string[] = [];

	// Show overlay/modal elements first — they're on top and most relevant
	if (overlayElements.length > 0) {
		lines.push('### 🔲 Modal/Dialog Elements (on top)');
		for (const el of overlayElements.slice(0, 30)) {
			lines.push(`  - [${el.type}] "${el.label}" [selector: ${el.selector}]`);
		}
		if (overlayElements.length > 30) {
			lines.push(`  - ...and ${overlayElements.length - 30} more`);
		}
		lines.push('');
	}

	// Then show regular page elements grouped by type
	const grouped: Record<string, { label: string; selector: string }[]> = {};
	for (const el of pageElements) {
		if (!grouped[el.type]) grouped[el.type] = [];
		grouped[el.type].push({ label: el.label, selector: el.selector });
	}

	for (const [type, els] of Object.entries(grouped)) {
		lines.push(`### ${type}s (${els.length})`);
		for (const el of els.slice(0, 20)) {
			lines.push(`  - "${el.label}" [selector: ${el.selector}]`);
		}
		if (els.length > 20) {
			lines.push(`  - ...and ${els.length - 20} more`);
		}
	}

	return lines.join('\n');
}
