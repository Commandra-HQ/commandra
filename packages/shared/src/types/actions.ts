export type SafetyLevel = 'safe' | 'review' | 'blocked';

export type ActionType =
	| 'click'
	| 'type'
	| 'navigate'
	| 'scroll'
	| 'select'
	| 'extract_text'
	| 'extract_table'
	| 'screenshot'
	| 'get_page_state';

export interface BrowserAction {
	id: string;
	type: ActionType;
	selector?: string;
	value?: string;
	url?: string;
	safetyLevel: SafetyLevel;
	timestamp: number;
}

export interface ActionResult {
	actionId: string;
	success: boolean;
	data?: unknown;
	error?: string;
	timestamp: number;
}

/** Maps action types to their default safety classification */
export const ACTION_SAFETY: Record<ActionType, SafetyLevel> = {
	click: 'review',
	type: 'review',
	navigate: 'safe',
	scroll: 'safe',
	select: 'safe',
	extract_text: 'safe',
	extract_table: 'safe',
	screenshot: 'safe',
	get_page_state: 'safe',
};
