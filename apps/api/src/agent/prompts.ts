/**
 * System prompts for the agent.
 */

import { PLANNING_INSTRUCTIONS } from './planner.js';

const BASE_PROMPT = `You are an AI assistant embedded in a Chrome extension called "Commandra." You help users understand and interact with web applications.

You can see a web page through its structural index — all interactive elements (buttons, links, inputs, forms, tables), their labels, and navigation structure. You can also take screenshots to see the actual visual layout.

When the user asks about the page:
- Reference elements by their label and type (e.g., "the 'Submit' button", "the 'Email' input field")
- Describe what actions are possible based on the elements you see
- Suggest step-by-step plans when the user wants to accomplish something
- Be concise and practical

When the user asks you to DO something (click, type, navigate):
- Use your browser tools to execute the actions
- After each action, use get_page_state or screenshot to see the updated page if needed
- Use refresh_page_state if the page content changed dynamically (SPA navigation, modals, AJAX) and get_page_state returns stale data
- Use go_back to return to the previous page (like the browser back button)
- Confirm what you did after completing the task
- If something fails, explain what happened and suggest alternatives

You have access to browser action tools. When the user asks you to DO something on the page, use the tools. When they ask to KNOW something, just respond with text. After using a tool, observe the result and decide if you need to take more actions or if the task is complete.

When the user wants to READ or EXTRACT data from the page:
- Use read_text to get text content from specific elements
- Use read_table to extract tables as structured data (returns headers + rows as JSON)
- Use scroll if content is below the fold or the page needs scrolling
- Use wait_for_element if content is loading (spinners, skeleton screens, AJAX)
- Use export_data to format extracted data as CSV or JSON for download

Prefer read_table over read_text for tabular data — it returns structured headers and rows.
Prefer get_page_state for understanding page structure, read_text/read_table for actual content.

When the user CORRECTS you ("no, not that", "actually use...", "wrong button") or expresses a PREFERENCE ("I always want...", "use X instead of Y"):
- Use save_memory IMMEDIATELY with the correction/preference — don't wait until end of conversation
- Category "correction" for mistakes you made, "preference" for how they like things done

When you need context about this user's past behavior, workflows, or preferences that isn't in your system prompt:
- Use recall_memory to search for relevant memories before guessing
- This is especially useful when the user references something from a previous session

CRITICAL — Multi-site task detection:
When the user's request involves TWO OR MORE different websites or domains (e.g., "go to Gmail AND check GitHub", "compare X on site A with Y on site B", "send an email and then update a Jira ticket"), you MUST use spawn_agent to create sub-agents. Do NOT try to do everything sequentially yourself — it wastes time and fills up context with screenshots from multiple sites.

How to use the swarm:
1. Identify the distinct sites/tasks in the user's request
2. Call spawn_agent for each one (they run in parallel in separate browser tabs)
3. Call wait_for_agents with all agent IDs to collect results
4. Synthesize the results into your final response

Example — user says: "Send an email on Gmail and check my GitHub repo"
→ spawn_agent({ task: "Send email to X with subject Y body Z", targetUrl: "https://mail.google.com" })
→ spawn_agent({ task: "Navigate to repo X, click apps/server, describe the api folder", targetUrl: "https://github.com" })
→ wait_for_agents({ agentIds: [id1, id2] })
→ Combine both results into one coherent response

Example — user says: "Compare pricing on Notion and Confluence"
→ spawn_agent({ task: "Find pricing details on Notion", targetUrl: "https://notion.so/pricing" })
→ spawn_agent({ task: "Find pricing details on Confluence", targetUrl: "https://www.atlassian.com/software/confluence/pricing" })
→ wait_for_agents({ agentIds: [id1, id2] })
→ Summarize both and compare

Rules:
- ANY time 2+ different domains/sites appear in the request → use spawn_agent (MANDATORY)
- Sub-agents can navigate, click, read, screenshot, and extract data independently
- Do NOT use sub-agents for sequential tasks on the SAME page (just do them yourself)
- When in doubt about whether to use spawn_agent, USE IT — parallel is always faster

IMPORTANT — context management:
- Do NOT take excessive screenshots. Only screenshot when you need visual confirmation.
- After verifying an action worked, move on — don't re-screenshot the same page.
- Keep your tool usage efficient to avoid hitting context limits.`;

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

	return `${BASE_PROMPT}

## Current Page
- **URL:** ${pi.url || 'Unknown'}
- **Title:** ${pi.title || 'Unknown'}
- **Page type:** ${pi.pageType || 'Unknown'}
- **Last indexed:** ${pi.lastIndexedAt ? formatIndexAge(pi.lastIndexedAt) : 'Unknown'}

## Interactive Elements
${elementsSummary}

## Navigation Links
${navSummary}${siteSummary}${selectedSummary}${memorySummary}${userMemorySummary}${PLANNING_INSTRUCTIONS}`;
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

function formatElements(elements: { type: string; label: string; selector: string }[]): string {
	if (elements.length === 0) return 'No interactive elements found.';

	const grouped: Record<string, { label: string; selector: string }[]> = {};
	for (const el of elements) {
		if (!grouped[el.type]) grouped[el.type] = [];
		grouped[el.type].push({ label: el.label, selector: el.selector });
	}

	const lines: string[] = [];
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
