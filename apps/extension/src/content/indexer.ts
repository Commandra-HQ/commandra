import {
	type ElementType,
	type IndexedElement,
	type PageIndex,
	normalizeUrlPattern,
} from '@afe/shared';

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
	'[role="combobox"]',
	'[onclick]',
	'table',
	'form',
];

function getElementType(el: Element): ElementType {
	const tag = el.tagName.toLowerCase();
	const role = el.getAttribute('role');
	if (tag === 'button' || role === 'button') return 'button';
	if (tag === 'a') return 'link';
	if (tag === 'input') {
		const type = (el as HTMLInputElement).type;
		if (type === 'checkbox') return 'checkbox';
		if (type === 'radio') return 'radio';
		return 'input';
	}
	if (tag === 'select') return 'select';
	if (tag === 'textarea') return 'textarea';
	// Rich text editors / contenteditable elements (Gmail compose, Notion, etc.)
	if (el.getAttribute('contenteditable') === 'true' || role === 'textbox') return 'textarea';
	// Combobox inputs (Gmail To field, search autocompletes)
	if (role === 'combobox') return 'input';
	if (tag === 'table') return 'table';
	if (tag === 'form') return 'form';
	return 'other';
}

function getLabel(el: Element): string {
	const ariaLabel = el.getAttribute('aria-label');
	if (ariaLabel) return ariaLabel;

	// Check for associated label element
	const id = el.getAttribute('id');
	if (id) {
		try {
			const escapedId = id.replace(/"/g, '\\"');
			const label = document.querySelector(`label[for="${escapedId}"]`);
			if (label?.textContent?.trim()) return label.textContent.trim().slice(0, 100);
		} catch {
			// ID contains characters that can't be used in attribute selectors
		}
	}

	const title = el.getAttribute('title');
	if (title) return title;

	const placeholder = el.getAttribute('placeholder');
	if (placeholder) return placeholder;

	const name = el.getAttribute('name');
	if (name) return name;

	// Check child elements for labels (wrapper divs in Gmail, etc.)
	const childInput = el.querySelector(
		'input, textarea, [contenteditable="true"], [role="textbox"]',
	);
	if (childInput) {
		const childLabel =
			childInput.getAttribute('aria-label') ||
			childInput.getAttribute('placeholder') ||
			childInput.getAttribute('name');
		if (childLabel) return childLabel;
	}

	const text = el.textContent?.trim().slice(0, 100);
	if (text) return text;

	return el.tagName.toLowerCase();
}

/**
 * Escape a string for use in a CSS selector.
 * Handles special characters like : . [ ] that appear in Gmail, Google Docs, etc.
 */
function cssEscape(value: string): string {
	if (typeof CSS !== 'undefined' && CSS.escape) {
		return CSS.escape(value);
	}
	// Manual fallback for environments without CSS.escape
	return value.replace(/([^\w-])/g, '\\$1');
}

/**
 * Check if an ID looks auto-generated / unstable.
 * Apps like Gmail use IDs like ":vd", ":sr", ":qz" — short random strings with
 * special chars that change between page loads. These are useless as selectors.
 */
function isStableId(id: string): boolean {
	// Reject IDs that start with : (Gmail pattern)
	if (id.startsWith(':')) return false;
	// Reject IDs that are purely numeric
	if (/^\d+$/.test(id)) return false;
	// Reject very short IDs (likely auto-generated: "a1", "x9", etc.)
	if (id.length <= 3 && /[^a-zA-Z]/.test(id)) return false;
	// Reject IDs that look like random hashes (e.g., "r5g2k", "xk3j")
	if (id.length <= 4 && /^[a-z0-9]+$/i.test(id) && !/[aeiou]{2}/i.test(id)) return false;
	// Reject IDs with multiple special characters (auto-generated patterns)
	if ((id.match(/[^a-zA-Z0-9_-]/g) || []).length >= 2) return false;
	return true;
}

function buildSelector(el: Element): string {
	const tag = el.tagName.toLowerCase();

	// Priority: data-testid > aria-label > name > stable id > classes > nth-child
	// aria-label and name are prioritized over id because IDs on apps like Gmail,
	// Google Docs, Slack are auto-generated garbage that changes every page load.

	const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
	if (testId) return `[data-testid="${testId}"]`;

	// aria-label is the most semantically stable selector for interactive elements
	const ariaLabel = el.getAttribute('aria-label');
	if (ariaLabel) {
		const escaped = ariaLabel.replace(/"/g, '\\"');
		const selector = `${tag}[aria-label="${escaped}"]`;
		try {
			if (document.querySelectorAll(selector).length <= 3) return selector;
		} catch {
			/* fall through */
		}
	}

	// name attribute — stable for form inputs
	const name = el.getAttribute('name');
	if (name) {
		const escaped = name.replace(/"/g, '\\"');
		return `${tag}[name="${escaped}"]`;
	}

	// role attribute combined with other attributes for specificity
	const role = el.getAttribute('role');
	if (role && ariaLabel) {
		const escaped = ariaLabel.replace(/"/g, '\\"');
		return `${tag}[role="${role}"][aria-label="${escaped}"]`;
	}

	// ID — only if it looks stable (not auto-generated like Gmail's :vd, :sr)
	if (el.id && isStableId(el.id)) {
		const escaped = `#${cssEscape(el.id)}`;
		try {
			if (document.querySelector(escaped) === el) return escaped;
		} catch {
			/* fall through */
		}
	}

	// Placeholder — useful for inputs without labels
	const placeholder = el.getAttribute('placeholder');
	if (placeholder && (tag === 'input' || tag === 'textarea')) {
		const escaped = placeholder.replace(/"/g, '\\"');
		const selector = `${tag}[placeholder="${escaped}"]`;
		try {
			if (document.querySelectorAll(selector).length === 1) return selector;
		} catch {
			/* fall through */
		}
	}

	// Classes — escaped, only if unique
	const classes = Array.from(el.classList).slice(0, 3);
	if (classes.length > 0) {
		const escapedClasses = classes.map((c) => cssEscape(c)).join('.');
		const selector = `${tag}.${escapedClasses}`;
		try {
			if (document.querySelectorAll(selector).length === 1) return selector;
		} catch {
			/* fall through */
		}
	}

	// Fallback: nth-child path (always produces valid selectors)
	return buildNthChildPath(el);
}

function buildNthChildPath(el: Element): string {
	const parts: string[] = [];
	let current: Element | null = el;

	while (current && current !== document.body) {
		const parent = current.parentElement as Element | null;
		if (!parent) break;

		const siblings = Array.from(parent.children);
		const index = siblings.indexOf(current) + 1;
		const tag = current.tagName.toLowerCase();
		parts.unshift(`${tag}:nth-child(${index})`);

		if (parts.length >= 3) break; // Keep paths short
		current = parent;
	}

	return parts.join(' > ');
}

function buildFallbackSelectors(el: Element): string[] {
	const fallbacks: string[] = [];
	const primary = buildSelector(el);
	const tag = el.tagName.toLowerCase();

	// aria-label fallback
	const ariaLabel = el.getAttribute('aria-label');
	if (ariaLabel) {
		const escaped = ariaLabel.replace(/"/g, '\\"');
		const ariaSelector = `${tag}[aria-label="${escaped}"]`;
		if (ariaSelector !== primary) fallbacks.push(ariaSelector);
	}

	// name fallback
	const name = el.getAttribute('name');
	if (name) {
		const escaped = name.replace(/"/g, '\\"');
		const nameSelector = `${tag}[name="${escaped}"]`;
		if (nameSelector !== primary) fallbacks.push(nameSelector);
	}

	// Stable ID fallback
	if (el.id && isStableId(el.id)) {
		const escaped = `#${cssEscape(el.id)}`;
		if (escaped !== primary) fallbacks.push(escaped);
	}

	// nth-child fallback (always valid)
	const nthChild = buildNthChildPath(el);
	if (nthChild !== primary) fallbacks.push(nthChild);

	return fallbacks.slice(0, 3);
}

function isVisible(el: Element): boolean {
	const rect = el.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return false;

	const style = getComputedStyle(el);
	if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
		return false;

	// Check if element is within viewport (or close to it for scrollable areas)
	const viewportHeight = window.innerHeight;
	const viewportWidth = window.innerWidth;
	if (
		rect.bottom < -100 ||
		rect.top > viewportHeight + 500 ||
		rect.right < -100 ||
		rect.left > viewportWidth + 100
	)
		return false;

	return true;
}

/**
 * Check if an element is inside a modal/overlay container.
 * Used to prioritize modal elements in the index (they're on top).
 */
function isInOverlay(el: Element): boolean {
	let current: Element | null = el;
	while (current && current !== document.body) {
		const style = getComputedStyle(current);
		const role = current.getAttribute('role');
		// Common modal/overlay indicators
		if (
			role === 'dialog' ||
			role === 'alertdialog' ||
			current.getAttribute('aria-modal') === 'true' ||
			style.position === 'fixed' ||
			(style.position === 'absolute' && Number.parseInt(style.zIndex, 10) > 100)
		) {
			return true;
		}
		current = current.parentElement;
	}
	return false;
}

/**
 * Detect the logged-in user's identity from common UI patterns.
 * Looks for avatar elements, profile dropdowns, user menus, etc.
 */
function detectUserIdentity(): { username?: string; avatar?: string } | undefined {
	const identity: { username?: string; avatar?: string } = {};

	// Strategy 1: Look for avatar/profile images with alt text containing a name
	const avatarSelectors = [
		'img[alt][class*="avatar"]',
		'img[alt][class*="profile"]',
		'img[alt][data-testid*="avatar"]',
		'[class*="avatar"] img[alt]',
		'[class*="user"] img[alt]',
		'[aria-label*="profile"] img[alt]',
		'[aria-label*="account"] img[alt]',
	];
	for (const sel of avatarSelectors) {
		const el = document.querySelector(sel);
		if (el) {
			const alt = el.getAttribute('alt')?.trim();
			if (alt && alt.length > 1 && alt.length < 60 && !alt.match(/^(logo|icon|image)/i)) {
				identity.username = alt;
				identity.avatar = el.getAttribute('src') || undefined;
				break;
			}
		}
	}

	// Strategy 2: Look for user menu buttons/links with name text
	if (!identity.username) {
		const menuSelectors = [
			'[aria-label*="Account"]',
			'[aria-label*="account"]',
			'[aria-label*="profile"]',
			'[aria-label*="Profile"]',
			'[data-testid*="user"]',
			'[data-testid*="account"]',
			'button[class*="user"]',
			'button[class*="profile"]',
			'[class*="header"] [class*="user"]',
		];
		for (const sel of menuSelectors) {
			const el = document.querySelector(sel);
			if (el) {
				const ariaLabel = el.getAttribute('aria-label')?.trim();
				if (ariaLabel && ariaLabel.length > 2 && ariaLabel.length < 80) {
					// Extract name from labels like "Account menu for John Doe"
					const nameMatch = ariaLabel.match(/(?:for|of|:)\s*(.+)/i);
					if (nameMatch) {
						identity.username = nameMatch[1].trim();
						break;
					}
				}
				// Check text content
				const text = el.textContent?.trim();
				if (
					text &&
					text.length > 1 &&
					text.length < 40 &&
					!text.match(/^(sign|log|menu|account)/i)
				) {
					identity.username = text;
					break;
				}
			}
		}
	}

	// Strategy 3: Check meta tags (some apps set user info in meta)
	if (!identity.username) {
		const metaUser =
			document.querySelector('meta[name="user-login"]')?.getAttribute('content') ||
			document.querySelector('meta[name="octolytics-actor-login"]')?.getAttribute('content') ||
			document.querySelector('meta[name="user"]')?.getAttribute('content');
		if (metaUser) identity.username = metaUser;
	}

	return identity.username ? identity : undefined;
}

function detectPageType(): PageIndex['pageType'] {
	const url = window.location.pathname;
	const tables = document.querySelectorAll('table').length;
	const forms = document.querySelectorAll('form').length;

	if (url.includes('settings') || url.includes('preferences') || url.includes('config'))
		return 'settings';
	if (forms > 0 && tables === 0) return 'form';
	if (tables > 0) return 'table';
	if (url.match(/\/\d+$/) || url.match(/\/[a-f0-9-]{36}$/)) return 'detail';
	if (url === '/' || url.includes('dashboard') || url.includes('home')) return 'dashboard';
	return 'other';
}

export function indexPage(): PageIndex {
	const elements: IndexedElement[] = [];
	const seen = new Set<Element>();

	for (const selector of INTERACTIVE_SELECTORS) {
		for (const el of document.querySelectorAll(selector)) {
			if (seen.has(el)) continue;
			seen.add(el);

			if (!isVisible(el)) continue;

			const rect = el.getBoundingClientRect();
			const inOverlay = isInOverlay(el);
			elements.push({
				id: crypto.randomUUID(),
				type: getElementType(el),
				label: getLabel(el),
				selector: buildSelector(el),
				fallbackSelectors: buildFallbackSelectors(el),
				attributes: {},
				position: {
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				},
				visible: true,
				inOverlay,
				pageUrl: window.location.href,
			});
		}
	}

	const navigationLinks = Array.from(document.querySelectorAll('a[href]'))
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
		.filter((link, i, arr) => link.href && arr.findIndex((l) => l.href === link.href) === i);

	const userIdentity = detectUserIdentity();

	return {
		url: window.location.href,
		urlPattern: normalizeUrlPattern(window.location.pathname),
		title: document.title,
		pageType: detectPageType(),
		elements,
		navigationLinks,
		timestamp: Date.now(),
		...(userIdentity && { userIdentity }),
	};
}
