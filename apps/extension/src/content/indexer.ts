import type { IndexedElement, PageIndex, ElementType } from '@afe/shared';

const INTERACTIVE_SELECTORS = [
	'button',
	'a[href]',
	'input',
	'select',
	'textarea',
	'[role="button"]',
	'[role="link"]',
	'[role="checkbox"]',
	'[role="radio"]',
	'[role="tab"]',
	'[onclick]',
	'table',
	'form',
];

function getElementType(el: Element): ElementType {
	const tag = el.tagName.toLowerCase();
	if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
	if (tag === 'a') return 'link';
	if (tag === 'input') {
		const type = (el as HTMLInputElement).type;
		if (type === 'checkbox') return 'checkbox';
		if (type === 'radio') return 'radio';
		return 'input';
	}
	if (tag === 'select') return 'select';
	if (tag === 'textarea') return 'textarea';
	if (tag === 'table') return 'table';
	if (tag === 'form') return 'form';
	return 'other';
}

function getLabel(el: Element): string {
	// Try multiple strategies to find a human-readable label
	const ariaLabel = el.getAttribute('aria-label');
	if (ariaLabel) return ariaLabel;

	const title = el.getAttribute('title');
	if (title) return title;

	const text = el.textContent?.trim().slice(0, 100);
	if (text) return text;

	const placeholder = el.getAttribute('placeholder');
	if (placeholder) return placeholder;

	const name = el.getAttribute('name');
	if (name) return name;

	return el.tagName.toLowerCase();
}

function buildSelector(el: Element): string {
	if (el.id) return `#${el.id}`;

	const tag = el.tagName.toLowerCase();
	const classes = Array.from(el.classList).slice(0, 2).join('.');
	if (classes) return `${tag}.${classes}`;

	return tag;
}

export function indexPage(): PageIndex {
	const elements: IndexedElement[] = [];
	const seen = new Set<Element>();

	for (const selector of INTERACTIVE_SELECTORS) {
		for (const el of document.querySelectorAll(selector)) {
			if (seen.has(el)) continue;
			seen.add(el);

			const rect = el.getBoundingClientRect();
			elements.push({
				id: crypto.randomUUID(),
				type: getElementType(el),
				label: getLabel(el),
				selector: buildSelector(el),
				fallbackSelectors: [],
				attributes: {},
				position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				visible: rect.width > 0 && rect.height > 0,
				pageUrl: window.location.href,
			});
		}
	}

	const navigationLinks = Array.from(document.querySelectorAll('a[href]'))
		.filter((a) => {
			const href = a.getAttribute('href') || '';
			return href.startsWith('/') || href.startsWith(window.location.origin);
		})
		.map((a) => ({
			label: a.textContent?.trim().slice(0, 80) || '',
			href: a.getAttribute('href') || '',
		}));

	return {
		url: window.location.href,
		urlPattern: window.location.pathname.replace(/\/\d+/g, '/:id'),
		title: document.title,
		pageType: 'other',
		elements,
		navigationLinks,
		timestamp: Date.now(),
	};
}
