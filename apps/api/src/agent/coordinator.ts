/**
 * Coordinator Agent
 *
 * The top-level agent that receives user messages and orchestrates
 * subagents (navigator, data-extractor, form-filler, page-analyzer).
 *
 * Uses Claude Agent SDK for:
 * - Agentic loop (plan -> act -> observe -> replan)
 * - Subagent dispatch
 * - PreToolUse hooks (safety classification)
 * - PostToolUse hooks (audit logging)
 * - Sessions (resume interrupted runs)
 *
 * TODO: Wire up Agent SDK once dependency is installed
 */

export interface AgentContext {
	connectionId: string;
	userId: string;
	siteId: string;
	conversationId: string;
}

export async function runCoordinator(context: AgentContext, userMessage: string) {
	console.log(`[Coordinator] Starting for user ${context.userId}: "${userMessage}"`);

	// Placeholder — Agent SDK integration goes here
	// 1. Create coordinator agent with MCP browser-bridge tools
	// 2. Add PreToolUse hook for safety classification
	// 3. Add PostToolUse hook for audit logging
	// 4. Run agent with user message + page context
	// 5. Return result

	return {
		response: 'Agent coordinator ready. Agent SDK integration is the next step.',
	};
}
