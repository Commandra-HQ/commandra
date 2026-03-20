/**
 * Page-injected scripts — functions that run IN the page context via chrome.scripting.executeScript.
 * These are self-contained: they cannot import modules or access outer scope.
 * Each function is exported so the action handler can pass it to executeScript.
 */

export function clickInPage(selector: string, fallbacks: string, label: string, elementType: string) {
	// Inline findElement — chrome.scripting.executeScript can't access outer functions
	function findElement(
		s: string,
		fb: string,
		l: string,
		et: string,
	): { element: Element | null; usedSelector: string; method: string } {
		let el = document.querySelector(s);
		if (el) return { element: el, usedSelector: s, method: 'primary' };
		const fbs = fb ? fb.split('|||') : [];
		for (const f of fbs) {
			if (!f) continue;
			el = document.querySelector(f);
			if (el) return { element: el, usedSelector: f, method: 'fallback' };
		}
		if (!l) return { element: null, usedSelector: s, method: 'none' };
		const ts: Record<string, string> = {
			button: 'button, [role="button"], input[type="submit"], input[type="button"]',
			link: 'a[href], [role="link"]',
			input:
				'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
			select: 'select',
			textarea: 'textarea',
			checkbox: 'input[type="checkbox"], [role="checkbox"]',
			radio: 'input[type="radio"], [role="radio"]',
			tab: '[role="tab"]',
		};
		const qs =
			ts[et] || 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]';
		const candidates = document.querySelectorAll(qs);
		const ll = l.toLowerCase().trim();
		let bestMatch: Element | null = null;
		let bestScore = 0;
		for (const c of candidates) {
			if (!(c instanceof HTMLElement)) continue;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cl = (
				c.getAttribute('aria-label') ||
				c.getAttribute('title') ||
				c.textContent?.trim().slice(0, 100) ||
				c.getAttribute('placeholder') ||
				c.getAttribute('name') ||
				''
			)
				.toLowerCase()
				.trim();
			if (!cl) continue;
			if (cl === ll) return { element: c, usedSelector: 'fuzzy:exact', method: 'fuzzy' };
			let score = 0;
			if (cl.includes(ll) || ll.includes(cl)) {
				score = 0.8;
			} else {
				const lw = ll.split(/\s+/);
				const cw = cl.split(/\s+/);
				score = lw.filter((w) => cw.includes(w)).length / Math.max(lw.length, 1);
			}
			if (score > bestScore && score > 0.4) {
				bestScore = score;
				bestMatch = c;
			}
		}
		if (bestMatch)
			return { element: bestMatch, usedSelector: `fuzzy:${bestScore.toFixed(2)}`, method: 'fuzzy' };
		return { element: null, usedSelector: s, method: 'none' };
	}
	const {
		element: el,
		usedSelector,
		method,
	} = findElement(selector, fallbacks, label, elementType);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLElement)) return { success: false, error: `Not clickable: ${selector}` };
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.click();
	return {
		success: true,
		data: {
			clicked: usedSelector,
			method,
			tag: el.tagName.toLowerCase(),
			text: el.textContent?.trim().slice(0, 100),
		},
	};
}

export function typeInPage(selector: string, text: string, fallbacks: string, label: string) {
	// Inline findElement — chrome.scripting.executeScript can't access outer functions
	function findElement(
		s: string,
		fb: string,
		l: string,
		et: string,
	): { element: Element | null; usedSelector: string; method: string } {
		let el = document.querySelector(s);
		if (el) return { element: el, usedSelector: s, method: 'primary' };
		const fbs = fb ? fb.split('|||') : [];
		for (const f of fbs) {
			if (!f) continue;
			el = document.querySelector(f);
			if (el) return { element: el, usedSelector: f, method: 'fallback' };
		}
		if (!l) return { element: null, usedSelector: s, method: 'none' };
		const ts: Record<string, string> = {
			button: 'button, [role="button"], input[type="submit"], input[type="button"]',
			link: 'a[href], [role="link"]',
			input:
				'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], [role="textbox"]',
			select: 'select',
			textarea: 'textarea, [contenteditable="true"], [role="textbox"]',
			checkbox: 'input[type="checkbox"], [role="checkbox"]',
			radio: 'input[type="radio"], [role="radio"]',
			tab: '[role="tab"]',
		};
		const qs =
			ts[et] ||
			'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [role="textbox"]';
		const candidates = document.querySelectorAll(qs);
		const ll = l.toLowerCase().trim();
		let bestMatch: Element | null = null;
		let bestScore = 0;
		for (const c of candidates) {
			if (!(c instanceof HTMLElement)) continue;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cl = (
				c.getAttribute('aria-label') ||
				c.getAttribute('title') ||
				c.textContent?.trim().slice(0, 100) ||
				c.getAttribute('placeholder') ||
				c.getAttribute('name') ||
				''
			)
				.toLowerCase()
				.trim();
			if (!cl) continue;
			if (cl === ll) return { element: c, usedSelector: 'fuzzy:exact', method: 'fuzzy' };
			let score = 0;
			if (cl.includes(ll) || ll.includes(cl)) {
				score = 0.8;
			} else {
				const lw = ll.split(/\s+/);
				const cw = cl.split(/\s+/);
				score = lw.filter((w) => cw.includes(w)).length / Math.max(lw.length, 1);
			}
			if (score > bestScore && score > 0.4) {
				bestScore = score;
				bestMatch = c;
			}
		}
		if (bestMatch)
			return { element: bestMatch, usedSelector: `fuzzy:${bestScore.toFixed(2)}`, method: 'fuzzy' };
		return { element: null, usedSelector: s, method: 'none' };
	}
	const { element: el, usedSelector, method } = findElement(selector, fallbacks, label, 'input');
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	const htmlEl = el as HTMLElement;
	htmlEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
	htmlEl.focus();

	// Handle contenteditable elements (Gmail compose body, Notion, rich text editors)
	if (
		htmlEl.isContentEditable ||
		htmlEl.getAttribute('contenteditable') === 'true' ||
		htmlEl.getAttribute('role') === 'textbox'
	) {
		// Clear existing content
		htmlEl.innerHTML = '';
		// Insert text using execCommand (works with contenteditable and undo stack)
		document.execCommand('insertText', false, text);
		// Also dispatch input event for frameworks that listen
		htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
		return {
			success: true,
			data: { typed: text, selector: usedSelector, method, inputType: 'contenteditable' },
		};
	}

	// Standard input/textarea
	if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
		return { success: false, error: `Not a text input or contenteditable element: ${selector}` };
	}
	el.value = '';
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.value = text;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return {
		success: true,
		data: { typed: text, selector: usedSelector, method, inputType: 'standard' },
	};
}

export function selectInPage(selector: string, value: string, fallbacks: string, label: string) {
	// Inline findElement — chrome.scripting.executeScript can't access outer functions
	function findElement(
		s: string,
		fb: string,
		l: string,
		et: string,
	): { element: Element | null; usedSelector: string; method: string } {
		let el = document.querySelector(s);
		if (el) return { element: el, usedSelector: s, method: 'primary' };
		const fbs = fb ? fb.split('|||') : [];
		for (const f of fbs) {
			if (!f) continue;
			el = document.querySelector(f);
			if (el) return { element: el, usedSelector: f, method: 'fallback' };
		}
		if (!l) return { element: null, usedSelector: s, method: 'none' };
		const ts: Record<string, string> = {
			button: 'button, [role="button"], input[type="submit"], input[type="button"]',
			link: 'a[href], [role="link"]',
			input:
				'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
			select: 'select',
			textarea: 'textarea',
			checkbox: 'input[type="checkbox"], [role="checkbox"]',
			radio: 'input[type="radio"], [role="radio"]',
			tab: '[role="tab"]',
		};
		const qs =
			ts[et] || 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]';
		const candidates = document.querySelectorAll(qs);
		const ll = l.toLowerCase().trim();
		let bestMatch: Element | null = null;
		let bestScore = 0;
		for (const c of candidates) {
			if (!(c instanceof HTMLElement)) continue;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cl = (
				c.getAttribute('aria-label') ||
				c.getAttribute('title') ||
				c.textContent?.trim().slice(0, 100) ||
				c.getAttribute('placeholder') ||
				c.getAttribute('name') ||
				''
			)
				.toLowerCase()
				.trim();
			if (!cl) continue;
			if (cl === ll) return { element: c, usedSelector: 'fuzzy:exact', method: 'fuzzy' };
			let score = 0;
			if (cl.includes(ll) || ll.includes(cl)) {
				score = 0.8;
			} else {
				const lw = ll.split(/\s+/);
				const cw = cl.split(/\s+/);
				score = lw.filter((w) => cw.includes(w)).length / Math.max(lw.length, 1);
			}
			if (score > bestScore && score > 0.4) {
				bestScore = score;
				bestMatch = c;
			}
		}
		if (bestMatch)
			return { element: bestMatch, usedSelector: `fuzzy:${bestScore.toFixed(2)}`, method: 'fuzzy' };
		return { element: null, usedSelector: s, method: 'none' };
	}
	const { element: el, usedSelector, method } = findElement(selector, fallbacks, label, 'select');
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLSelectElement))
		return { success: false, error: `Not a select: ${selector}` };
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return { success: true, data: { selected: value, selector: usedSelector, method } };
}

export function getPageStateInPage() {
	// Lightweight page indexer — inline version for action context
	const elements: { type: string; label: string; selector: string }[] = [];
	const interactiveSelectors =
		'a, button, input, select, textarea, [contenteditable="true"], [role="textbox"], [role="button"], [role="link"], [role="tab"], [onclick]';

	document.querySelectorAll(interactiveSelectors).forEach((el) => {
		if (!(el instanceof HTMLElement)) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return;
		if (getComputedStyle(el).display === 'none') return;

		const type = el.tagName.toLowerCase();
		const label =
			el.getAttribute('aria-label') ||
			el.textContent?.trim().slice(0, 60) ||
			el.getAttribute('placeholder') ||
			el.getAttribute('title') ||
			'';

		if (!label) return;

		// Build a selector
		let selector = '';
		if (el.id) selector = `#${el.id}`;
		else if (el.getAttribute('data-testid'))
			selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
		else if (el.getAttribute('name')) selector = `${type}[name="${el.getAttribute('name')}"]`;
		else if (el.className && typeof el.className === 'string')
			selector = `${type}.${el.className.split(' ').filter(Boolean)[0]}`;
		else selector = type;

		elements.push({ type, label, selector });
	});

	return {
		success: true,
		data: {
			url: window.location.href,
			title: document.title,
			elements: elements.slice(0, 200),
		},
	};
}

export function scrollInPage(direction: string, selector: string, amountStr: string) {
	const amount = Number(amountStr) || 500;

	// If selector provided, scroll that element into view
	if (selector) {
		const el = document.querySelector(selector);
		if (!el) return { success: false, error: `Element not found: ${selector}` };
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		return {
			success: true,
			data: {
				scrolledTo: selector,
				scrollY: window.scrollY,
				pageHeight: document.documentElement.scrollHeight,
				viewportHeight: window.innerHeight,
			},
		};
	}

	// Directional scroll
	const before = window.scrollY;
	switch (direction) {
		case 'top':
			window.scrollTo({ top: 0, behavior: 'smooth' });
			break;
		case 'bottom':
			window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
			break;
		case 'up':
			window.scrollBy({ top: -amount, behavior: 'smooth' });
			break;
		default:
			window.scrollBy({ top: amount, behavior: 'smooth' });
			break;
	}

	return {
		success: true,
		data: {
			direction: direction || 'down',
			scrolledFrom: before,
			scrollY: window.scrollY,
			pageHeight: document.documentElement.scrollHeight,
			viewportHeight: window.innerHeight,
			hasMoreBelow:
				window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 10,
		},
	};
}

export async function waitForElementInPage(
	selector: string,
	state: string,
	timeoutStr: string,
): Promise<unknown> {
	const timeout = Number(timeoutStr) || 10000;
	const interval = 200;
	const start = Date.now();

	return new Promise((resolve) => {
		function check() {
			const el = document.querySelector(selector);
			const elapsed = Date.now() - start;

			if (state === 'visible') {
				if (el instanceof HTMLElement) {
					const rect = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					const isVisible =
						rect.width > 0 &&
						rect.height > 0 &&
						style.display !== 'none' &&
						style.visibility !== 'hidden';
					if (isVisible) {
						return resolve({
							success: true,
							data: {
								found: true,
								selector,
								elapsed,
								text: el.textContent?.trim().slice(0, 200),
							},
						});
					}
				}
			} else if (state === 'hidden') {
				if (!el) {
					return resolve({
						success: true,
						data: { found: false, selector, elapsed, state: 'removed' },
					});
				}
				if (el instanceof HTMLElement) {
					const style = getComputedStyle(el);
					if (style.display === 'none' || style.visibility === 'hidden') {
						return resolve({
							success: true,
							data: { found: false, selector, elapsed, state: 'hidden' },
						});
					}
				}
			} else if (state === 'attached') {
				if (el) {
					return resolve({
						success: true,
						data: {
							found: true,
							selector,
							elapsed,
							text: (el as HTMLElement).textContent?.trim().slice(0, 200),
						},
					});
				}
			}

			if (elapsed >= timeout) {
				return resolve({
					success: false,
					error: `Timeout after ${timeout}ms waiting for "${selector}" to be ${state}`,
				});
			}

			setTimeout(check, interval);
		}

		check();
	});
}

export function readTextInPage(selector: string, allStr: string, maxLengthStr: string) {
	const all = allStr === 'true';
	const maxLength = Number(maxLengthStr) || 2000;

	if (all) {
		const elements = document.querySelectorAll(selector);
		if (elements.length === 0) {
			return { success: false, error: `No elements found matching: ${selector}` };
		}
		const texts = Array.from(elements).map((el) => ({
			text: (el.textContent || '').trim().slice(0, maxLength),
			tag: el.tagName.toLowerCase(),
		}));
		return {
			success: true,
			data: { selector, matchCount: elements.length, texts },
		};
	}

	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };

	return {
		success: true,
		data: {
			selector,
			text: (el.textContent || '').trim().slice(0, maxLength),
			tag: el.tagName.toLowerCase(),
		},
	};
}

export function readTableInPage(selector: string, maxRowsStr: string, includeLinksStr: string) {
	const maxRows = Number(maxRowsStr) || 100;
	const includeLinks = includeLinksStr === 'true';

	// Find the table — try direct match first, then look inside a container
	let table = document.querySelector(selector);
	if (table && table.tagName.toLowerCase() !== 'table') {
		const inner = table.querySelector('table');
		if (inner) table = inner;
	}

	// Try role="grid" data grids
	if (table && table.tagName.toLowerCase() !== 'table' && !table.querySelector('table')) {
		return readDataGrid(table, maxRows, includeLinks, selector);
	}

	if (!table || table.tagName.toLowerCase() !== 'table') {
		return { success: false, error: `No table found at: ${selector}` };
	}

	// Extract headers
	const headers: string[] = [];
	const thead = table.querySelector('thead');
	const headerRow = thead ? thead.querySelector('tr') : table.querySelector('tr');

	if (headerRow) {
		for (const cell of headerRow.querySelectorAll('th, td')) {
			headers.push((cell.textContent || '').trim());
		}
	}

	// Extract rows from tbody (or all tr except first if no thead)
	const tbody = table.querySelector('tbody');
	const allRows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll('tr');

	const startIdx = !thead && headerRow ? 1 : 0; // skip header row if no thead
	const rows: Record<string, string>[] = [];
	let totalRows = 0;

	for (let i = startIdx; i < allRows.length; i++) {
		totalRows++;
		if (rows.length >= maxRows) continue; // count but don't extract past limit

		const row = allRows[i];
		const cells = row.querySelectorAll('td, th');
		const rowData: Record<string, string> = {};

		cells.forEach((cell, j) => {
			const header = headers[j] || `column_${j}`;
			let value = (cell.textContent || '').trim();

			if (includeLinks) {
				const link = cell.querySelector('a[href]');
				if (link) {
					const href = link.getAttribute('href') || '';
					value = `${value} [${href}]`;
				}
			}

			rowData[header] = value;
		});

		rows.push(rowData);
	}

	return {
		success: true,
		data: {
			selector,
			headers,
			rows,
			totalRows,
			truncated: totalRows > maxRows,
		},
	};
}

/** Handle div-based data grids (role="grid", role="row", role="cell") */
export function readDataGrid(
	container: Element,
	maxRows: number,
	includeLinks: boolean,
	selector: string,
) {
	const gridRows = container.querySelectorAll('[role="row"]');
	if (gridRows.length === 0) {
		return { success: false, error: `No table or data grid found at: ${selector}` };
	}

	// First row is usually headers
	const headers: string[] = [];
	const headerRow = gridRows[0];
	for (const cell of headerRow.querySelectorAll('[role="columnheader"], [role="cell"], th, td')) {
		headers.push((cell.textContent || '').trim());
	}

	const rows: Record<string, string>[] = [];
	let totalRows = 0;

	for (let i = 1; i < gridRows.length; i++) {
		totalRows++;
		if (rows.length >= maxRows) continue;

		const cells = gridRows[i].querySelectorAll('[role="cell"], [role="gridcell"], td');
		const rowData: Record<string, string> = {};

		cells.forEach((cell, j) => {
			const header = headers[j] || `column_${j}`;
			let value = (cell.textContent || '').trim();
			if (includeLinks) {
				const link = cell.querySelector('a[href]');
				if (link) value = `${value} [${link.getAttribute('href') || ''}]`;
			}
			rowData[header] = value;
		});

		rows.push(rowData);
	}

	return {
		success: true,
		data: { selector, headers, rows, totalRows, truncated: totalRows > maxRows },
	};
}

export function goBackInPage() {
	window.history.back();
	return { success: true };
}

export function refreshPageStateInPage() {
	// Full re-index — same as content script indexer but inline for executeScript
	const INTERACTIVE_SELECTORS = [
		'button',
		'a[href]',
		'input',
		'select',
		'textarea',
		'[contenteditable="true"]',
		'[role="textbox"]',
		'[role="button"]',
		'[role="link"]',
		'[role="checkbox"]',
		'[role="radio"]',
		'[role="tab"]',
		'[role="menuitem"]',
		'[onclick]',
		'table',
		'form',
	];

	type ElemType =
		| 'button'
		| 'link'
		| 'input'
		| 'select'
		| 'textarea'
		| 'checkbox'
		| 'radio'
		| 'table'
		| 'form'
		| 'other';

	function getElemType(el: Element): ElemType {
		const tag = el.tagName.toLowerCase();
		const role = el.getAttribute('role');
		if (tag === 'button' || role === 'button') return 'button';
		if (tag === 'a') return 'link';
		if (tag === 'input') {
			const t = (el as HTMLInputElement).type;
			if (t === 'checkbox') return 'checkbox';
			if (t === 'radio') return 'radio';
			return 'input';
		}
		if (tag === 'select') return 'select';
		if (tag === 'textarea') return 'textarea';
		if (tag === 'table') return 'table';
		if (tag === 'form') return 'form';
		return 'other';
	}

	function getLabel(el: Element): string {
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel) return ariaLabel;
		const id = el.getAttribute('id');
		if (id) {
			const lbl = document.querySelector(`label[for="${id}"]`);
			if (lbl?.textContent?.trim()) return lbl.textContent.trim().slice(0, 100);
		}
		return (
			el.getAttribute('title') ||
			el.textContent?.trim().slice(0, 100) ||
			el.getAttribute('placeholder') ||
			el.getAttribute('name') ||
			el.tagName.toLowerCase()
		);
	}

	function buildSel(el: Element): string {
		const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
		if (testId) return `[data-testid="${testId}"]`;
		if (el.id) return `#${el.id}`;
		const tag = el.tagName.toLowerCase();
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;
		const name = el.getAttribute('name');
		if (name) return `${tag}[name="${name}"]`;
		const cls = Array.from(el.classList).slice(0, 3).join('.');
		if (cls) {
			const s = `${tag}.${cls}`;
			if (document.querySelectorAll(s).length === 1) return s;
		}
		// nth-child fallback
		const parts: string[] = [];
		let cur: Element | null = el;
		for (let d = 0; d < 3 && cur && cur !== document.body; d++) {
			const parent = cur.parentElement;
			if (!parent) break;
			const idx = Array.from(parent.children).indexOf(cur) + 1;
			parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
			cur = parent;
		}
		return parts.join(' > ');
	}

	const elements: unknown[] = [];
	const seen = new Set<Element>();

	for (const sel of INTERACTIVE_SELECTORS) {
		for (const el of document.querySelectorAll(sel)) {
			if (seen.has(el)) continue;
			seen.add(el);
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden') continue;

			elements.push({
				id: crypto.randomUUID(),
				type: getElemType(el),
				label: getLabel(el),
				selector: buildSel(el),
				fallbackSelectors: [],
				attributes: {},
				position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				visible: true,
				pageUrl: window.location.href,
			});
		}
	}

	const navLinks = Array.from(document.querySelectorAll('a[href]'))
		.filter((a) => {
			const href = a.getAttribute('href') || '';
			return (
				(href.startsWith('/') || href.startsWith(window.location.origin)) &&
				!href.startsWith('javascript:') &&
				!href.match(/\.(pdf|png|jpg|jpeg|gif|svg|css|js|zip|csv)$/i)
			);
		})
		.map((a) => ({
			label: a.textContent?.trim().slice(0, 80) || '',
			href: new URL(a.getAttribute('href') || '', window.location.origin).pathname,
		}))
		.filter((l, i, arr) => l.href && arr.findIndex((x) => x.href === l.href) === i);

	const path = window.location.pathname;
	let pageType = 'other';
	if (path.includes('settings') || path.includes('preferences')) pageType = 'settings';
	else if (
		document.querySelectorAll('form').length > 0 &&
		document.querySelectorAll('table').length === 0
	)
		pageType = 'form';
	else if (document.querySelectorAll('table').length > 0) pageType = 'table';
	else if (path.match(/\/\d+$/) || path.match(/\/[a-f0-9-]{36}$/)) pageType = 'detail';
	else if (path === '/' || path.includes('dashboard') || path.includes('home'))
		pageType = 'dashboard';

	const pageIndex = {
		url: window.location.href,
		urlPattern: path.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9-]{36}/g, '/:id'),
		title: document.title,
		pageType,
		elements,
		navigationLinks: navLinks,
		timestamp: Date.now(),
	};

	return {
		success: true,
		data: {
			url: window.location.href,
			title: document.title,
			elements: elements.slice(0, 200),
			pageIndex,
		},
	};
}
