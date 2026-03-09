import { describe, expect, it } from 'vitest';
import type { ElementType, IndexedElement, PageIndex, SiteIndex } from './elements.js';

describe('element types', () => {
	it('supports all ElementType values', () => {
		const types: ElementType[] = [
			'button',
			'link',
			'input',
			'select',
			'textarea',
			'checkbox',
			'radio',
			'table',
			'form',
			'other',
		];
		expect(types).toHaveLength(10);
	});

	it('can create a valid IndexedElement', () => {
		const el: IndexedElement = {
			id: '1',
			type: 'button',
			label: 'Submit',
			selector: '#submit-btn',
			fallbackSelectors: ['.submit'],
			attributes: { class: 'btn' },
			position: { x: 10, y: 20, width: 100, height: 40 },
			visible: true,
			pageUrl: 'https://example.com',
		};
		expect(el.type).toBe('button');
		expect(el.visible).toBe(true);
	});

	it('can create a valid PageIndex', () => {
		const page: PageIndex = {
			url: 'https://example.com/dashboard',
			urlPattern: '/dashboard',
			title: 'Dashboard',
			pageType: 'dashboard',
			elements: [],
			navigationLinks: [{ label: 'Home', href: '/' }],
			timestamp: Date.now(),
		};
		expect(page.pageType).toBe('dashboard');
		expect(page.navigationLinks).toHaveLength(1);
	});

	it('can create a valid SiteIndex', () => {
		const site: SiteIndex = {
			domain: 'example.com',
			pages: [],
			totalElements: 0,
			lastUpdated: Date.now(),
		};
		expect(site.domain).toBe('example.com');
	});

	it('supports all pageType values', () => {
		const types: PageIndex['pageType'][] = [
			'dashboard',
			'form',
			'table',
			'detail',
			'settings',
			'other',
		];
		expect(types).toHaveLength(6);
	});
});
