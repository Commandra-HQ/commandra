/**
 * Plan generation and approval.
 *
 * Plans are submitted via the submit_plan tool, persisted as PLAN.md in
 * Supabase Storage, and require explicit user approval before execution.
 * Steps are updated via update_plan as the agent executes.
 */

export interface Plan {
	steps: string[];
	description?: string;
}

/**
 * Planning instructions appended to the system prompt.
 */
export const PLANNING_INSTRUCTIONS = `
## Planning

For tasks that require 3 or more browser actions, you MUST call the submit_plan tool FIRST. This sends the plan to the user for approval.

**How planning works:**
1. Call submit_plan with a description and steps array
2. The user sees the plan and can approve or reject it
3. If approved, execute each step in order
4. After each step, call update_plan with the stepIndex and status ("completed" or "failed")
5. If a step fails, call update_plan with status "failed" and an error message, then explain to the user

**IMPORTANT:** Do NOT execute multi-step tasks without calling submit_plan first. The tool blocks until the user responds — you cannot skip it.

For simple tasks (1-2 actions), skip the plan and just execute directly.

### Planning Patterns for Common Tasks

**Sending emails/messages (Gmail, Outlook, Slack, etc.):**
1. Navigate to the app (if not already there)
2. Click compose/new message button
3. Wait for compose UI to appear (often a modal or panel, not a new page)
4. Fill in recipient field, subject, body
5. Click Send (this will require user approval)

**Reading/extracting data from a page:**
1. Navigate to the target page
2. Use read_table for tables or read_text for specific elements
3. If content is below the fold, scroll down and read more
4. Use export_data to format as CSV/JSON for the user

**Navigating to a specific page/section:**
1. Check the "Other Indexed Pages" section — if the target page is already known, use its URL
2. If not indexed, look for navigation links that might lead there
3. Use the search functionality of the app (if available) to find the target
4. After navigating, the page state auto-refreshes so you have current elements

**Filling out forms:**
1. Navigate to the form page
2. Read all visible input fields to understand what's needed
3. Fill fields in order (top to bottom) — each type_text auto-refreshes state
4. Review filled values before submitting
5. Click submit (requires approval)

**Multi-page workflows (comparing, aggregating):**
1. If data is on 2+ different sites → use spawn_agent for parallel work
2. If data is on the same site but different pages → navigate sequentially, read_text/read_table on each
3. Synthesize results after collecting all data

### Key Principles
- **Use what you know:** Check domain memory, indexed pages, and prior context FIRST. Don't navigate blindly.
- **SPAs are tricky:** After click/navigate, the page state auto-updates. Check the updated elements before your next action.
- **Wait for dynamic content:** If you expect a modal, dropdown, or AJAX content, use wait_for_element before interacting.
- **Identify yourself:** Check the "Logged-in user" in Current Page section. The user is already authenticated — you don't need to log in.
- **Leverage embeddings:** If a user says "do that thing again" or references past work, check the Prior Context section for related conversations.`;

/**
 * Parse plan blocks from agent response text.
 * @deprecated Use submit_plan tool instead. Kept for backward compatibility.
 */
export function parsePlan(text: string): Plan | null {
	const match = text.match(/<!--plan:(.*?)-->/s);
	if (!match) return null;

	try {
		const plan = JSON.parse(match[1]) as Plan;
		if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) return null;
		return plan;
	} catch {
		return null;
	}
}

/**
 * Check if a user message is approving a plan.
 * @deprecated Approval now handled via WS approval gate in submit_plan tool.
 */
export function isPlanApproval(message: string): boolean {
	const normalized = message.toLowerCase().trim();
	const approvalPhrases = [
		'go',
		'go ahead',
		'execute',
		'yes',
		'do it',
		'proceed',
		'run it',
		'start',
		'ok',
		'okay',
		'sure',
		'approved',
		'lets go',
		"let's go",
		'yep',
		'yeah',
		'y',
	];
	return approvalPhrases.includes(normalized);
}
