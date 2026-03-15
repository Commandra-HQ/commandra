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

/**
 * Safely query a DOM element by selector.
 * Handles selectors with special characters that might throw DOMException.
 */
function safeQuerySelector(selector: string): Element | null {
	try {
		return document.querySelector(selector);
	} catch {
		// Selector contains invalid characters (e.g., unescaped : in Gmail IDs like #:vd)
		// Try escaping the ID portion if it looks like an ID selector
		if (selector.startsWith('#')) {
			try {
				const id = selector.slice(1);
				const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1');
				return document.querySelector(`#${escaped}`);
			} catch {
				// Still invalid — try getElementById as last resort
				const id = selector.slice(1);
				return document.getElementById(id);
			}
		}
		return null;
	}
}

function clickElement(selector: string): ActionResponse {
	const el = safeQuerySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLElement))
		return { success: false, error: `Element is not clickable: ${selector}` };

	el.scrollIntoView({ behavior: 'smooth', block: 'center' });

	// Dispatch a full MouseEvent sequence for better compatibility with overlays,
	// modals, and framework event handlers (React, Angular, etc.)
	const rect = el.getBoundingClientRect();
	const cx = rect.left + rect.width / 2;
	const cy = rect.top + rect.height / 2;
	const eventInit: MouseEventInit = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

	el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerId: 1 }));
	el.dispatchEvent(new MouseEvent('mousedown', eventInit));
	el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerId: 1 }));
	el.dispatchEvent(new MouseEvent('mouseup', eventInit));
	el.dispatchEvent(new MouseEvent('click', eventInit));

	return {
		success: true,
		data: {
			clicked: selector,
			tag: el.tagName.toLowerCase(),
			text: el.textContent?.trim().slice(0, 100),
		},
	};
}

function typeText(selector: string, text: string): ActionResponse {
	const el = safeQuerySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLElement)) {
		return { success: false, error: `Element is not an HTML element: ${selector}` };
	}

	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.focus();

	const isContentEditable =
		el.getAttribute('contenteditable') === 'true' ||
		el.getAttribute('role') === 'textbox' ||
		(el.isContentEditable && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement));

	if (isContentEditable) {
		// Contenteditable elements (Gmail compose body, Slack message input, Notion blocks, etc.)
		// Clear existing content
		el.textContent = '';
		el.dispatchEvent(new Event('input', { bubbles: true }));

		// Use execCommand for better undo support and framework compatibility (React, Angular, etc.)
		// This triggers all the right events that frameworks listen on
		if (document.execCommand) {
			document.execCommand('insertText', false, text);
		} else {
			// Fallback: set textContent directly and simulate input events
			el.textContent = text;
		}

		// Dispatch events to ensure frameworks pick up the change
		el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
		el.dispatchEvent(new Event('change', { bubbles: true }));

		return { success: true, data: { typed: text, selector, tag: el.tagName.toLowerCase(), mode: 'contenteditable' } };
	}

	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
		// Standard input/textarea elements
		// Use native setter to bypass React's synthetic event system
		const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
			el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
			'value',
		)?.set;

		if (nativeInputValueSetter) {
			nativeInputValueSetter.call(el, '');
			el.dispatchEvent(new Event('input', { bubbles: true }));
			nativeInputValueSetter.call(el, text);
		} else {
			el.value = '';
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.value = text;
		}

		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));

		return { success: true, data: { typed: text, selector, tag: el.tagName.toLowerCase(), mode: 'input' } };
	}

	return { success: false, error: `Element is not a text input or contenteditable: ${selector}` };
}

function selectOption(selector: string, value: string): ActionResponse {
	const el = safeQuerySelector(selector);
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
