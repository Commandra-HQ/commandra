/**
 * Action executor — executes DOM actions requested by the agent.
 */

import { indexPage } from './indexer.js';

export interface ActionPayload {
	action: string;
	selector?: string;
	text?: string;
	value?: string;
	url?: string;
	description?: string;
}

export interface ActionResponse {
	success: boolean;
	data?: unknown;
	error?: string;
}

export function executeAction(payload: ActionPayload): ActionResponse {
	try {
		switch (payload.action) {
			case 'click_element':
				return clickElement(payload.selector!);
			case 'type_text':
				return typeText(payload.selector!, payload.text!);
			case 'select_option':
				return selectOption(payload.selector!, payload.value!);
			case 'get_page_state':
				return getPageState();
			default:
				return { success: false, error: `Unknown action: ${payload.action}` };
		}
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

function clickElement(selector: string): ActionResponse {
	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLElement)) return { success: false, error: `Element is not clickable: ${selector}` };

	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.click();

	return { success: true, data: { clicked: selector, tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 100) } };
}

function typeText(selector: string, text: string): ActionResponse {
	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
		return { success: false, error: `Element is not a text input: ${selector}` };
	}

	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.focus();

	// Clear existing value
	el.value = '';
	el.dispatchEvent(new Event('input', { bubbles: true }));

	// Set new value
	el.value = text;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.dispatchEvent(new Event('change', { bubbles: true }));

	return { success: true, data: { typed: text, selector, tag: el.tagName.toLowerCase() } };
}

function selectOption(selector: string, value: string): ActionResponse {
	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLSelectElement)) {
		return { success: false, error: `Element is not a select: ${selector}` };
	}

	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));

	return { success: true, data: { selected: value, selector } };
}

function getPageState(): ActionResponse {
	const pageIndex = indexPage();
	return { success: true, data: pageIndex };
}
