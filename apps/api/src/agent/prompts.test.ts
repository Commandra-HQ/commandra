import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './prompts.js';

describe('buildSystemPrompt', () => {
	it('returns base prompt when no page index provided', () => {
		const prompt = buildSystemPrompt();
		expect(prompt).toContain('Commandra');
		expect(prompt).toContain('No page is currently indexed');
	});

	it('includes page info when page index is provided', () => {
		const pageIndex = {
			url: 'https://example.com/dashboard',
			title: 'My Dashboard',
			pageType: 'dashboard',
			elements: [
				{ type: 'button', label: 'Submit', selector: '#submit' },
				{ type: 'link', label: 'Home', selector: 'a.home' },
			],
			navigationLinks: [{ label: 'Settings', href: '/settings' }],
		};

		const prompt = buildSystemPrompt(pageIndex);
		expect(prompt).toContain('https://example.com/dashboard');
		expect(prompt).toContain('My Dashboard');
		expect(prompt).toContain('dashboard');
		expect(prompt).toContain('Submit');
		expect(prompt).toContain('#submit');
		expect(prompt).toContain('Settings');
		expect(prompt).toContain('/settings');
	});

	it('groups elements by type', () => {
		const pageIndex = {
			url: 'https://example.com',
			title: 'Test',
			elements: [
				{ type: 'button', label: 'A', selector: '#a' },
				{ type: 'button', label: 'B', selector: '#b' },
				{ type: 'link', label: 'C', selector: '#c' },
			],
		};

		const prompt = buildSystemPrompt(pageIndex);
		expect(prompt).toContain('buttons (2)');
		expect(prompt).toContain('links (1)');
	});

	it('includes selected element context for single element', () => {
		const pageIndex = { url: 'https://example.com', title: 'Test' };
		const selected = [
			{
				selector: '#my-btn',
				fallbackSelectors: ['.btn-primary'],
				tag: 'button',
				label: 'Click Me',
				type: 'submit',
				attributes: { class: 'btn-primary' },
			},
		];

		const prompt = buildSystemPrompt(pageIndex, selected);
		expect(prompt).toContain('Selected Element');
		expect(prompt).toContain('#my-btn');
		expect(prompt).toContain('Click Me');
		expect(prompt).toContain('button');
		expect(prompt).toContain('.btn-primary');
		expect(prompt).toContain('this element');
	});

	it('includes selected elements context for multiple elements', () => {
		const pageIndex = { url: 'https://example.com', title: 'Test' };
		const selected = [
			{
				selector: '#btn1',
				fallbackSelectors: [],
				tag: 'button',
				label: 'One',
				attributes: {},
			},
			{
				selector: '#btn2',
				fallbackSelectors: [],
				tag: 'button',
				label: 'Two',
				attributes: {},
			},
		];

		const prompt = buildSystemPrompt(pageIndex, selected);
		expect(prompt).toContain('Selected Elements (2)');
		expect(prompt).toContain('#btn1');
		expect(prompt).toContain('#btn2');
	});

	it('includes domain memory when provided', () => {
		const pageIndex = { url: 'https://example.com', title: 'Test' };
		const memory = 'This app uses React. The settings page is at /admin/settings.';

		const prompt = buildSystemPrompt(pageIndex, undefined, memory);
		expect(prompt).toContain('What You Know About This App');
		expect(prompt).toContain('React');
		expect(prompt).toContain('/admin/settings');
	});

	it('truncates elements list beyond 30', () => {
		const elements = Array.from({ length: 40 }, (_, i) => ({
			type: 'button',
			label: `Button ${i}`,
			selector: `#btn-${i}`,
		}));
		const pageIndex = { url: 'https://example.com', title: 'Test', elements };

		const prompt = buildSystemPrompt(pageIndex);
		expect(prompt).toContain('...and 10 more');
	});

	it('handles empty elements array', () => {
		const pageIndex = {
			url: 'https://example.com',
			title: 'Test',
			elements: [],
		};

		const prompt = buildSystemPrompt(pageIndex);
		expect(prompt).toContain('No interactive elements found');
	});

	it('handles no navigation links', () => {
		const pageIndex = {
			url: 'https://example.com',
			title: 'Test',
			navigationLinks: [],
		};

		const prompt = buildSystemPrompt(pageIndex);
		expect(prompt).toContain('No navigation links found');
	});

	it('includes site pages when provided', () => {
		const pageIndex = {
			url: 'https://example.com',
			title: 'Test',
			sitePages: [
				{
					url: 'https://example.com/users',
					urlPattern: '/users',
					title: 'Users',
					pageType: 'table',
					elementCount: 25,
				},
			],
		};

		const prompt = buildSystemPrompt(pageIndex);
		expect(prompt).toContain('Other Indexed Pages');
		expect(prompt).toContain('Users');
		expect(prompt).toContain('25 elements');
	});
});
