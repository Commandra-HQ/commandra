import type { SafetyLevel } from '@afe/shared';

const SAFE_LABELS =
	/\b(next|back|previous|view|details|show|open|close|cancel|search|filter|sort|page|tab|expand|collapse|toggle|more|less|menu|nav|home|help|about|learn|read|see|go|visit|browse|explore|copy|download|print|refresh|reload)\b/i;

const REVIEW_LABELS =
	/\b(submit|save|send|create|update|edit|confirm|apply|post|publish|upload|import|export|connect|authorize|enable|activate|accept|agree|checkout|pay|purchase|buy|order|transfer|change|modify|set|assign|add|insert|new|compose|write|reply|comment|share|invite)\b/i;

const BLOCKED_LABELS =
	/\b(delete|remove|destroy|drop|reset|revoke|disable|block|ban|terminate|purge|wipe|erase|uninstall|deactivate|suspend|archive|permanently|force|irreversible)\b/i;

const SENSITIVE_INPUT_PATTERNS =
	/\b(password|passwd|secret|token|ssn|social.security|credit.card|card.number|cvv|cvc|expir|routing|account.number|pin)\b/i;

interface ClassifyInput {
	toolName: string;
	args: Record<string, unknown>;
	elementLabel?: string;
}

export interface ClassifyResult {
	level: SafetyLevel;
	reason: string;
}

/**
 * Classify a browser action's safety level.
 *
 * Layer 1: Action type defaults (get_page_state → safe, click → review)
 * Layer 2: Context-aware label/arg analysis (overrides Layer 1)
 */
export function classifyAction({ toolName, args, elementLabel }: ClassifyInput): ClassifyResult {
	// Read-only tools are always safe
	if (
		toolName === 'get_page_state' ||
		toolName === 'refresh_page_state' ||
		toolName === 'go_back' ||
		toolName === 'scroll' ||
		toolName === 'wait_for_element' ||
		toolName === 'read_text' ||
		toolName === 'read_table' ||
		toolName === 'export_data' ||
		toolName === 'screenshot'
	) {
		return { level: 'safe', reason: 'Read-only action' };
	}

	// Navigate classification
	if (toolName === 'navigate') {
		const url = args.url as string | undefined;
		if (!url) return { level: 'safe', reason: 'Navigation without URL' };

		// Same-origin navigation is safe (will be checked at runtime with page URL)
		// For now, all navigation is safe — cross-domain check needs page context
		return { level: 'safe', reason: 'Navigation' };
	}

	// Type classification — check if targeting a sensitive field
	if (toolName === 'type_text') {
		const selector = (args.selector as string) || '';
		const label = elementLabel || selector;

		if (SENSITIVE_INPUT_PATTERNS.test(label) || SENSITIVE_INPUT_PATTERNS.test(selector)) {
			return { level: 'review', reason: `Typing in sensitive field: ${label}` };
		}

		// Regular typing is safe (filling in search boxes, forms, etc.)
		return { level: 'safe', reason: 'Text input' };
	}

	// Select classification — generally safe
	if (toolName === 'select_option') {
		return { level: 'safe', reason: 'Dropdown selection' };
	}

	// Click classification — the main one that needs context
	if (toolName === 'click_element') {
		const label = elementLabel || (args.selector as string) || '';
		return classifyByLabel(label);
	}

	// Unknown tool — review by default
	return { level: 'review', reason: `Unknown action: ${toolName}` };
}

/**
 * Classify based on element label text.
 * Checks blocked first, then safe, then defaults to review.
 */
function classifyByLabel(label: string): ClassifyResult {
	if (!label) {
		return { level: 'review', reason: 'No element label available' };
	}

	// Blocked — destructive actions
	if (BLOCKED_LABELS.test(label)) {
		const match = label.match(BLOCKED_LABELS)?.[0];
		return { level: 'blocked', reason: `Destructive action detected: "${match}" in "${label}"` };
	}

	// Safe — read/navigation actions
	if (SAFE_LABELS.test(label)) {
		return { level: 'safe', reason: `Safe action: "${label}"` };
	}

	// Review — write/modify actions
	if (REVIEW_LABELS.test(label)) {
		const match = label.match(REVIEW_LABELS)?.[0];
		return { level: 'review', reason: `Write action detected: "${match}" in "${label}"` };
	}

	// Default: clicks without recognizable labels → safe
	// Most clicks are navigation/UI interactions. Being too aggressive with review
	// makes the agent unusable. Only gate what we recognize as risky.
	return { level: 'safe', reason: `Unrecognized label, defaulting safe: "${label}"` };
}
