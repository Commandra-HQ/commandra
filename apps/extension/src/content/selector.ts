/**
 * Element Selector — hover-to-highlight, click-to-select.
 * Activated from the side panel, runs in the page context.
 */

import type { SelectedElement } from '@afe/shared';

let active = false;
let overlay: HTMLDivElement | null = null;
let tooltip: HTMLDivElement | null = null;
let currentTarget: Element | null = null;

const OVERLAY_ID = 'afe-selector-overlay';
const TOOLTIP_ID = 'afe-selector-tooltip';

export function startSelector() {
	if (active) return;
	active = true;

	// Create overlay
	overlay = document.createElement('div');
	overlay.id = OVERLAY_ID;
	Object.assign(overlay.style, {
		position: 'fixed',
		pointerEvents: 'none',
		zIndex: '2147483646',
		border: '2px solid #3b82f6',
		backgroundColor: 'rgba(59, 130, 246, 0.1)',
		borderRadius: '3px',
		transition: 'all 0.05s ease-out',
		display: 'none',
	});
	document.body.appendChild(overlay);

	// Create tooltip
	tooltip = document.createElement('div');
	tooltip.id = TOOLTIP_ID;
	Object.assign(tooltip.style, {
		position: 'fixed',
		pointerEvents: 'none',
		zIndex: '2147483647',
		backgroundColor: '#1e293b',
		color: '#f8fafc',
		fontSize: '11px',
		fontFamily: 'system-ui, -apple-system, sans-serif',
		padding: '3px 8px',
		borderRadius: '4px',
		whiteSpace: 'nowrap',
		maxWidth: '300px',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		display: 'none',
	});
	document.body.appendChild(tooltip);

	document.addEventListener('mouseover', onMouseOver, true);
	document.addEventListener('click', onClick, true);
	document.addEventListener('keydown', onKeyDown, true);

	// Change cursor
	document.body.style.cursor = 'crosshair';
}

export function stopSelector() {
	if (!active) return;
	active = false;
	currentTarget = null;

	document.removeEventListener('mouseover', onMouseOver, true);
	document.removeEventListener('click', onClick, true);
	document.removeEventListener('keydown', onKeyDown, true);

	overlay?.remove();
	tooltip?.remove();
	overlay = null;
	tooltip = null;

	document.body.style.cursor = '';
}

function onMouseOver(e: MouseEvent) {
	const target = e.target as Element;
	if (!target || target.id === OVERLAY_ID || target.id === TOOLTIP_ID) return;

	currentTarget = target;
	const rect = target.getBoundingClientRect();

	if (overlay) {
		overlay.style.display = 'block';
		overlay.style.left = `${rect.left}px`;
		overlay.style.top = `${rect.top}px`;
		overlay.style.width = `${rect.width}px`;
		overlay.style.height = `${rect.height}px`;
	}

	if (tooltip) {
		const tag = target.tagName.toLowerCase();
		const label = getLabel(target);
		tooltip.textContent = label ? `<${tag}> ${label}` : `<${tag}>`;
		tooltip.style.display = 'block';

		// Position tooltip above the element, or below if no room
		const tooltipHeight = 22;
		if (rect.top > tooltipHeight + 4) {
			tooltip.style.top = `${rect.top - tooltipHeight - 4}px`;
		} else {
			tooltip.style.top = `${rect.bottom + 4}px`;
		}
		tooltip.style.left = `${rect.left}px`;
	}
}

function onClick(e: MouseEvent) {
	if (!active || !currentTarget) return;

	e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();

	const el = currentTarget;
	const rect = el.getBoundingClientRect();

	const selected: SelectedElement = {
		selector: buildSelector(el),
		fallbackSelectors: buildFallbackSelectors(el),
		tag: el.tagName.toLowerCase(),
		label: getLabel(el),
		type: getElementType(el),
		attributes: getKeyAttributes(el),
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
	};

	stopSelector();
	chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: selected });
}

function onKeyDown(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		e.preventDefault();
		e.stopPropagation();
		stopSelector();
		chrome.runtime.sendMessage({ type: 'SELECTOR_CANCELLED' });
	}
}

// --- Helpers (mirror indexer logic) ---

function getLabel(el: Element): string {
	const ariaLabel = el.getAttribute('aria-label');
	if (ariaLabel) return ariaLabel;

	const id = el.getAttribute('id');
	if (id) {
		const label = document.querySelector(`label[for="${id}"]`);
		if (label?.textContent?.trim()) return label.textContent.trim().slice(0, 100);
	}

	const title = el.getAttribute('title');
	if (title) return title;

	const text = el.textContent?.trim().slice(0, 100);
	if (text) return text;

	const placeholder = el.getAttribute('placeholder');
	if (placeholder) return placeholder;

	const name = el.getAttribute('name');
	if (name) return name;

	return '';
}

function getElementType(el: Element): string {
	const tag = el.tagName.toLowerCase();
	const role = el.getAttribute('role');
	if (role) return role;
	if (tag === 'input') return (el as HTMLInputElement).type || 'text';
	return tag;
}

function getKeyAttributes(el: Element): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const name of ['id', 'name', 'type', 'role', 'href', 'value', 'placeholder', 'data-testid']) {
		const val = el.getAttribute(name);
		if (val) attrs[name] = val;
	}
	return attrs;
}

function buildSelector(el: Element): string {
	const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
	if (testId) return `[data-testid="${testId}"]`;

	if (el.id) return `#${el.id}`;

	const ariaLabel = el.getAttribute('aria-label');
	if (ariaLabel) {
		const tag = el.tagName.toLowerCase();
		return `${tag}[aria-label="${ariaLabel}"]`;
	}

	const tag = el.tagName.toLowerCase();
	const name = el.getAttribute('name');
	if (name) return `${tag}[name="${name}"]`;

	const classes = Array.from(el.classList).slice(0, 3).join('.');
	if (classes) {
		const selector = `${tag}.${classes}`;
		if (document.querySelectorAll(selector).length === 1) return selector;
	}

	return buildNthChildPath(el);
}

function buildNthChildPath(el: Element): string {
	const parts: string[] = [];
	let current: Element | null = el;

	while (current && current !== document.body) {
		const parent = current.parentElement;
		if (!parent) break;

		const siblings = Array.from(parent.children);
		const index = siblings.indexOf(current) + 1;
		const tag = current.tagName.toLowerCase();
		parts.unshift(`${tag}:nth-child(${index})`);

		if (parts.length >= 3) break;
		current = parent;
	}

	return parts.join(' > ');
}

function buildFallbackSelectors(el: Element): string[] {
	const fallbacks: string[] = [];
	const primary = buildSelector(el);

	if (el.id && primary !== `#${el.id}`) fallbacks.push(`#${el.id}`);

	const tag = el.tagName.toLowerCase();
	const classes = Array.from(el.classList).slice(0, 2).join('.');
	if (classes) {
		const classSelector = `${tag}.${classes}`;
		if (classSelector !== primary) fallbacks.push(classSelector);
	}

	const nthChild = buildNthChildPath(el);
	if (nthChild !== primary) fallbacks.push(nthChild);

	return fallbacks.slice(0, 3);
}
