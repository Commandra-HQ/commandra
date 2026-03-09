/**
 * Plan generation and parsing.
 *
 * For complex multi-step tasks, the agent outputs a structured plan
 * before executing. The plan is embedded in the response as a JSON block
 * that the frontend can parse and render as a step list.
 *
 * Format: <!--plan:{"steps":["step1","step2"]}-->
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

For tasks that require 3 or more browser actions, ALWAYS generate a plan first. Output the plan as a structured block before executing:

<!--plan:{"steps":["Step 1 description","Step 2 description","Step 3 description"],"description":"Brief summary of what you'll do"}-->

Then WAIT for the user to approve before executing. Do NOT execute the plan until the user says "go", "execute", "yes", "do it", "proceed", or similar.

After the user approves:
- Execute each step in order
- After each step, verify the result (use get_page_state or screenshot if needed)
- If a step fails, explain what happened and propose an alternative
- Report progress as you go: "Step 1/N: [doing X]..."

For simple tasks (1-2 actions), skip the plan and just execute directly.`;

/**
 * Parse plan blocks from agent response text.
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
