import { describe, expect, it } from 'vitest';
import { getToolDefinitions, hasTool } from './registry.js';

describe('tool registry', () => {
	it('registers all expected browser tools', () => {
		const expectedTools = [
			'click_element',
			'type_text',
			'select_option',
			'navigate',
			'get_page_state',
			'screenshot',
		];

		for (const name of expectedTools) {
			expect(hasTool(name)).toBe(true);
		}
	});

	it('returns false for unregistered tools', () => {
		expect(hasTool('nonexistent_tool')).toBe(false);
		expect(hasTool('')).toBe(false);
	});

	it('getToolDefinitions returns array of tool definitions', () => {
		const defs = getToolDefinitions();
		expect(Array.isArray(defs)).toBe(true);
		expect(defs.length).toBeGreaterThanOrEqual(6);
	});

	it('each tool definition has required fields', () => {
		const defs = getToolDefinitions();
		for (const def of defs) {
			expect(def.name).toBeTruthy();
			expect(typeof def.name).toBe('string');
			expect(def.description).toBeTruthy();
			expect(typeof def.description).toBe('string');
			expect(def.parameters).toBeDefined();
			expect(def.parameters.type).toBe('object');
			expect(def.parameters.properties).toBeDefined();
		}
	});

	it('click_element tool has selector parameter', () => {
		const defs = getToolDefinitions();
		const click = defs.find((d) => d.name === 'click_element');
		expect(click).toBeDefined();
		if (!click) return;
		expect(click.parameters.properties).toHaveProperty('selector');
		expect(click.parameters.required).toContain('selector');
	});

	it('navigate tool has url parameter', () => {
		const defs = getToolDefinitions();
		const nav = defs.find((d) => d.name === 'navigate');
		expect(nav).toBeDefined();
		if (!nav) return;
		expect(nav.parameters.properties).toHaveProperty('url');
		expect(nav.parameters.required).toContain('url');
	});

	it('type_text tool has selector and text parameters', () => {
		const defs = getToolDefinitions();
		const type = defs.find((d) => d.name === 'type_text');
		expect(type).toBeDefined();
		if (!type) return;
		expect(type.parameters.properties).toHaveProperty('selector');
		expect(type.parameters.properties).toHaveProperty('text');
	});

	it('tool names are unique', () => {
		const defs = getToolDefinitions();
		const names = defs.map((d) => d.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
