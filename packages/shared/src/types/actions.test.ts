import { describe, expect, it } from 'vitest';
import { ACTION_SAFETY } from './actions.js';
import type { ActionType, SafetyLevel } from './actions.js';

describe('actions types', () => {
	it('exports ACTION_SAFETY map with all action types', () => {
		const expectedActions: ActionType[] = [
			'click',
			'type',
			'navigate',
			'scroll',
			'select',
			'extract_text',
			'extract_table',
			'screenshot',
			'get_page_state',
		];

		for (const action of expectedActions) {
			expect(ACTION_SAFETY[action]).toBeDefined();
		}
	});

	it('classifies read actions as safe', () => {
		expect(ACTION_SAFETY.navigate).toBe('safe');
		expect(ACTION_SAFETY.scroll).toBe('safe');
		expect(ACTION_SAFETY.select).toBe('safe');
		expect(ACTION_SAFETY.extract_text).toBe('safe');
		expect(ACTION_SAFETY.extract_table).toBe('safe');
		expect(ACTION_SAFETY.screenshot).toBe('safe');
		expect(ACTION_SAFETY.get_page_state).toBe('safe');
	});

	it('classifies write actions as review', () => {
		expect(ACTION_SAFETY.click).toBe('review');
		expect(ACTION_SAFETY.type).toBe('review');
	});

	it('has valid safety levels for all actions', () => {
		const validLevels: SafetyLevel[] = ['safe', 'review', 'blocked'];
		for (const level of Object.values(ACTION_SAFETY)) {
			expect(validLevels).toContain(level);
		}
	});
});
