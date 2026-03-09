/**
 * Element Selector — injectable functions for chrome.scripting.executeScript.
 *
 * These functions are completely self-contained (no imports, no closures)
 * because executeScript serializes them to run in the page context.
 *
 * Two modes:
 *   - Click: highlight hovered element, click to select it
 *   - Drag: draw selection rectangle, capture all interactive elements inside
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Inject into page to start selector mode.
 * Sets up highlight overlay, tooltip, drag rectangle, and event listeners.
 * Communicates back via chrome.runtime.sendMessage.
 */
export function startSelectorInPage() {
	if ((window as any).__afe_selector_active) return { alreadyActive: true };
	(window as any).__afe_selector_active = true;

	// --- State ---
	let dragStart: { x: number; y: number } | null = null;
	let isDragging = false;
	const DRAG_THRESHOLD = 8;

	// --- Create UI elements ---
	const highlight = document.createElement('div');
	highlight.id = '__afe_highlight';
	Object.assign(highlight.style, {
		position: 'fixed',
		pointerEvents: 'none',
		zIndex: '2147483646',
		border: '2px solid #3b82f6',
		backgroundColor: 'rgba(59, 130, 246, 0.08)',
		borderRadius: '2px',
		transition: 'top 0.04s, left 0.04s, width 0.04s, height 0.04s',
		display: 'none',
		boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.3)',
	});
	document.documentElement.appendChild(highlight);

	const tooltip = document.createElement('div');
	tooltip.id = '__afe_tooltip';
	Object.assign(tooltip.style, {
		position: 'fixed',
		pointerEvents: 'none',
		zIndex: '2147483647',
		backgroundColor: '#1e293b',
		color: '#e2e8f0',
		fontSize: '11px',
		fontFamily: 'ui-monospace, SFMono-Regular, monospace',
		padding: '3px 8px',
		borderRadius: '3px',
		display: 'none',
		maxWidth: '320px',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
		lineHeight: '1.4',
	});
	document.documentElement.appendChild(tooltip);

	const dragRect = document.createElement('div');
	dragRect.id = '__afe_dragRect';
	Object.assign(dragRect.style, {
		position: 'fixed',
		pointerEvents: 'none',
		zIndex: '2147483645',
		border: '2px dashed #3b82f6',
		backgroundColor: 'rgba(59, 130, 246, 0.06)',
		borderRadius: '2px',
		display: 'none',
	});
	document.documentElement.appendChild(dragRect);

	// Banner at top of page
	const banner = document.createElement('div');
	banner.id = '__afe_banner';
	Object.assign(banner.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		right: '0',
		zIndex: '2147483647',
		backgroundColor: '#1e293b',
		color: '#e2e8f0',
		fontSize: '12px',
		fontFamily: 'system-ui, -apple-system, sans-serif',
		padding: '6px 16px',
		textAlign: 'center',
		boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
	});
	banner.textContent = 'Element Selector — Click to pick, drag to select area, Esc to cancel';
	document.documentElement.appendChild(banner);

	const prevCursor = document.documentElement.style.cursor;
	document.documentElement.style.cursor = 'crosshair';

	// --- Helpers ---
	const AFE_IDS = new Set(['__afe_highlight', '__afe_tooltip', '__afe_dragRect', '__afe_banner']);

	function getLabel(el: Element): string {
		const aria = el.getAttribute('aria-label');
		if (aria) return aria;
		const elId = el.getAttribute('id');
		if (elId) {
			const lbl = document.querySelector(`label[for="${elId}"]`);
			if (lbl?.textContent?.trim()) return lbl.textContent.trim().slice(0, 80);
		}
		return el.getAttribute('title')
			|| el.textContent?.trim()?.slice(0, 80)
			|| el.getAttribute('placeholder')
			|| el.getAttribute('name')
			|| '';
	}

	function buildSelector(el: Element): string {
		const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
		if (testId) return `[data-testid="${testId}"]`;
		if (el.id) return `#${CSS.escape(el.id)}`;
		const aria = el.getAttribute('aria-label');
		const tag = el.tagName.toLowerCase();
		if (aria) return `${tag}[aria-label="${aria}"]`;
		const name = el.getAttribute('name');
		if (name) return `${tag}[name="${name}"]`;
		const cls = Array.from(el.classList).slice(0, 3).join('.');
		if (cls) {
			const sel = `${tag}.${cls}`;
			if (document.querySelectorAll(sel).length === 1) return sel;
		}
		// nth-child fallback
		const parts: string[] = [];
		let cur: Element | null = el;
		while (cur && cur !== document.body && parts.length < 3) {
			const parent = cur.parentElement;
			if (!parent) break;
			const idx = Array.from(parent.children).indexOf(cur) + 1;
			parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
			cur = parent;
		}
		return parts.join(' > ');
	}

	function buildFallbacks(el: Element): string[] {
		const primary = buildSelector(el);
		const fb: string[] = [];
		if (el.id && primary !== `#${CSS.escape(el.id)}`) fb.push(`#${CSS.escape(el.id)}`);
		const tag = el.tagName.toLowerCase();
		const cls = Array.from(el.classList).slice(0, 2).join('.');
		if (cls && `${tag}.${cls}` !== primary) fb.push(`${tag}.${cls}`);
		return fb.slice(0, 3);
	}

	function getAttrs(el: Element): Record<string, string> {
		const attrs: Record<string, string> = {};
		for (const n of ['id', 'name', 'type', 'role', 'href', 'placeholder', 'data-testid']) {
			const v = el.getAttribute(n);
			if (v) attrs[n] = v;
		}
		return attrs;
	}

	function captureElement(el: Element) {
		const rect = el.getBoundingClientRect();
		return {
			selector: buildSelector(el),
			fallbackSelectors: buildFallbacks(el),
			tag: el.tagName.toLowerCase(),
			label: getLabel(el),
			type: el.getAttribute('role') || (el.tagName === 'INPUT' ? (el as HTMLInputElement).type : undefined),
			attributes: getAttrs(el),
			rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		};
	}

	function positionHighlight(el: Element) {
		const rect = el.getBoundingClientRect();
		highlight.style.display = 'block';
		highlight.style.left = `${rect.left - 1}px`;
		highlight.style.top = `${rect.top - 1}px`;
		highlight.style.width = `${rect.width + 2}px`;
		highlight.style.height = `${rect.height + 2}px`;

		// Tooltip content: <tag>#id.class "label" WxH
		const tag = el.tagName.toLowerCase();
		const idPart = el.id ? `#${el.id}` : '';
		const clsPart = !idPart && el.classList.length
			? `.${Array.from(el.classList).slice(0, 2).join('.')}`
			: '';
		const label = getLabel(el);
		const dims = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
		tooltip.textContent = `${tag}${idPart}${clsPart}${label ? ` "${label.slice(0, 35)}"` : ''} ${dims}`;
		tooltip.style.display = 'block';
		tooltip.style.left = `${Math.max(0, rect.left)}px`;
		if (rect.top > 56) { // account for banner
			tooltip.style.top = `${rect.top - 24}px`;
		} else {
			tooltip.style.top = `${rect.bottom + 4}px`;
		}
	}

	// --- Cleanup ---
	function cleanup() {
		(window as any).__afe_selector_active = false;
		(window as any).__afe_selector_cleanup = undefined;
		highlight.remove();
		tooltip.remove();
		dragRect.remove();
		banner.remove();
		document.documentElement.style.cursor = prevCursor;
		document.removeEventListener('mousemove', onMouseMove, true);
		document.removeEventListener('mousedown', onMouseDown, true);
		document.removeEventListener('mouseup', onMouseUp, true);
		document.removeEventListener('click', onClickBlock, true);
		document.removeEventListener('keydown', onKeyDown, true);
	}
	(window as any).__afe_selector_cleanup = cleanup;

	// --- Event handlers ---
	function onMouseMove(e: MouseEvent) {
		// If dragging, show selection rectangle
		if (isDragging && dragStart) {
			const left = Math.min(dragStart.x, e.clientX);
			const top = Math.min(dragStart.y, e.clientY);
			const width = Math.abs(e.clientX - dragStart.x);
			const height = Math.abs(e.clientY - dragStart.y);
			dragRect.style.display = 'block';
			dragRect.style.left = `${left}px`;
			dragRect.style.top = `${top}px`;
			dragRect.style.width = `${width}px`;
			dragRect.style.height = `${height}px`;
			highlight.style.display = 'none';
			tooltip.style.display = 'none';
			return;
		}

		// Check if drag started
		if (dragStart) {
			const dx = Math.abs(e.clientX - dragStart.x);
			const dy = Math.abs(e.clientY - dragStart.y);
			if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
				isDragging = true;
				return;
			}
		}

		// Hover highlight
		const target = document.elementFromPoint(e.clientX, e.clientY);
		if (!target || (target instanceof HTMLElement && AFE_IDS.has(target.id))) return;
		positionHighlight(target);
	}

	function onMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		dragStart = { x: e.clientX, y: e.clientY };
		isDragging = false;
	}

	function onMouseUp(e: MouseEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();

		if (isDragging && dragStart) {
			// Drag select — find interactive elements in rect
			const left = Math.min(dragStart.x, e.clientX);
			const top = Math.min(dragStart.y, e.clientY);
			const right = Math.max(dragStart.x, e.clientX);
			const bottom = Math.max(dragStart.y, e.clientY);

			const selectors = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [onclick]';
			const elements: ReturnType<typeof captureElement>[] = [];
			const seen = new Set<Element>();

			document.querySelectorAll(selectors).forEach((el) => {
				if (seen.has(el)) return;
				seen.add(el);
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;
				// Element center must be inside drag rect
				const cx = rect.left + rect.width / 2;
				const cy = rect.top + rect.height / 2;
				if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
					elements.push(captureElement(el));
				}
			});

			cleanup();
			if (elements.length > 0) {
				chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: elements });
			} else {
				chrome.runtime.sendMessage({ type: 'SELECTOR_CANCELLED' });
			}
		} else {
			// Single click
			const target = dragStart
				? document.elementFromPoint(dragStart.x, dragStart.y)
				: document.elementFromPoint(e.clientX, e.clientY);

			if (!target || (target instanceof HTMLElement && AFE_IDS.has(target.id))) {
				dragStart = null;
				return;
			}

			const captured = captureElement(target);
			cleanup();
			chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: [captured] });
		}

		dragStart = null;
		isDragging = false;
	}

	// Block actual click events from reaching page elements
	function onClickBlock(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			cleanup();
			chrome.runtime.sendMessage({ type: 'SELECTOR_CANCELLED' });
		}
	}

	// --- Attach listeners ---
	document.addEventListener('mousemove', onMouseMove, true);
	document.addEventListener('mousedown', onMouseDown, true);
	document.addEventListener('mouseup', onMouseUp, true);
	document.addEventListener('click', onClickBlock, true);
	document.addEventListener('keydown', onKeyDown, true);

	return { started: true };
}

/**
 * Inject into page to stop selector mode (cleanup).
 */
export function stopSelectorInPage() {
	const fn = (window as any).__afe_selector_cleanup;
	if (fn) {
		fn();
		return { stopped: true };
	}
	return { stopped: false };
}
