/**
 * System prompts for the agent.
 */

const BASE_PROMPT = `You are an AI assistant embedded in a Chrome extension called "Agents for Everyone." You help users understand and interact with web applications.

You can see a web page through its structural index — all interactive elements (buttons, links, inputs, forms, tables), their labels, and navigation structure. You can also take screenshots to see the actual visual layout.

When the user asks about the page:
- Reference elements by their label and type (e.g., "the 'Submit' button", "the 'Email' input field")
- Describe what actions are possible based on the elements you see
- Suggest step-by-step plans when the user wants to accomplish something
- Be concise and practical

When the user asks you to DO something (click, type, navigate):
- Use your browser tools to execute the actions
- After each action, use get_page_state or screenshot to see the updated page if needed
- Confirm what you did after completing the task
- If something fails, explain what happened and suggest alternatives

You have access to browser action tools. When the user asks you to DO something on the page, use the tools. When they ask to KNOW something, just respond with text. After using a tool, observe the result and decide if you need to take more actions or if the task is complete.`;

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
	elements?: { type: string; label: string; selector: string }[];
	navigationLinks?: { label: string; href: string }[];
	sitePages?: { url: string; urlPattern: string; title: string; pageType: string; elementCount: number }[];
}

export function buildSystemPrompt(
	pageIndex?: unknown,
	selectedElements?: SelectedElement[],
	domainMemory?: string,
): string {
	if (!pageIndex) {
		return `${BASE_PROMPT}\n\nNo page is currently indexed. Ask the user to index a page first.`;
	}

	const pi = pageIndex as PageContext;

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
	if (selectedElements?.length) {
		if (selectedElements.length === 1) {
			const el = selectedElements[0];
			const attrs = Object.entries(el.attributes).map(([k, v]) => `${k}="${v}"`).join(', ');
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
			const elementList = selectedElements.map((el, i) => {
				return `${i + 1}. <${el.tag}> "${el.label}" — selector: \`${el.selector}\``;
			}).join('\n');
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

	return `${BASE_PROMPT}

## Current Page
- **URL:** ${pi.url || 'Unknown'}
- **Title:** ${pi.title || 'Unknown'}
- **Page type:** ${pi.pageType || 'Unknown'}

## Interactive Elements
${elementsSummary}

## Navigation Links
${navSummary}${siteSummary}${selectedSummary}${memorySummary}`;
}

function formatElements(
	elements: { type: string; label: string; selector: string }[],
): string {
	if (elements.length === 0) return 'No interactive elements found.';

	const grouped: Record<string, { label: string; selector: string }[]> = {};
	for (const el of elements) {
		if (!grouped[el.type]) grouped[el.type] = [];
		grouped[el.type].push({ label: el.label, selector: el.selector });
	}

	const lines: string[] = [];
	for (const [type, els] of Object.entries(grouped)) {
		lines.push(`### ${type}s (${els.length})`);
		for (const el of els.slice(0, 30)) {
			lines.push(`  - "${el.label}" [selector: ${el.selector}]`);
		}
		if (els.length > 30) {
			lines.push(`  - ...and ${els.length - 30} more`);
		}
	}

	return lines.join('\n');
}
