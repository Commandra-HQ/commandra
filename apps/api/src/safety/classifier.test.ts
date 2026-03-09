import { describe, expect, it } from 'vitest';
import { classifyAction } from './classifier.js';

describe('classifyAction', () => {
	// --- get_page_state ---
	it('classifies get_page_state as safe', () => {
		const result = classifyAction({ toolName: 'get_page_state', args: {} });
		expect(result.level).toBe('safe');
	});

	// --- navigate ---
	it('classifies navigate as safe', () => {
		const result = classifyAction({
			toolName: 'navigate',
			args: { url: 'https://example.com/dashboard' },
		});
		expect(result.level).toBe('safe');
	});

	it('classifies navigate without url as safe', () => {
		const result = classifyAction({ toolName: 'navigate', args: {} });
		expect(result.level).toBe('safe');
	});

	// --- type_text ---
	it('classifies type_text in regular fields as safe', () => {
		const result = classifyAction({
			toolName: 'type_text',
			args: { selector: '#search', text: 'hello' },
			elementLabel: 'Search',
		});
		expect(result.level).toBe('safe');
	});

	it('classifies type_text in password fields as review', () => {
		const result = classifyAction({
			toolName: 'type_text',
			args: { selector: 'input[type=password]', text: 'secret' },
			elementLabel: 'Password',
		});
		expect(result.level).toBe('review');
	});

	it('classifies type_text targeting sensitive selector as review', () => {
		const result = classifyAction({
			toolName: 'type_text',
			args: { selector: '#credit-card-number', text: '4111' },
		});
		expect(result.level).toBe('review');
	});

	it('classifies type_text targeting SSN field as review', () => {
		const result = classifyAction({
			toolName: 'type_text',
			args: { selector: '#ssn', text: '123' },
			elementLabel: 'Social Security Number',
		});
		expect(result.level).toBe('review');
	});

	// --- select_option ---
	it('classifies select_option as safe', () => {
		const result = classifyAction({
			toolName: 'select_option',
			args: { selector: '#country', value: 'US' },
		});
		expect(result.level).toBe('safe');
	});

	// --- click_element with safe labels ---
	it('classifies click on View button as safe', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#view-btn' },
			elementLabel: 'View Details',
		});
		expect(result.level).toBe('safe');
	});

	it('classifies click on Next button as safe', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#next' },
			elementLabel: 'Next Page',
		});
		expect(result.level).toBe('safe');
	});

	it('classifies click on Search as safe', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#search' },
			elementLabel: 'Search',
		});
		expect(result.level).toBe('safe');
	});

	it('classifies click on Filter as safe', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#filter' },
			elementLabel: 'Filter results',
		});
		expect(result.level).toBe('safe');
	});

	// --- click_element with review labels ---
	it('classifies click on Submit button as review', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#submit' },
			elementLabel: 'Submit Form',
		});
		expect(result.level).toBe('review');
	});

	it('classifies click on Save button as review', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#save' },
			elementLabel: 'Save Changes',
		});
		expect(result.level).toBe('review');
	});

	it('classifies click on Create button as review', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#create' },
			elementLabel: 'Create New User',
		});
		expect(result.level).toBe('review');
	});

	it('classifies click on Send as review', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#send' },
			elementLabel: 'Send Message',
		});
		expect(result.level).toBe('review');
	});

	// --- click_element with blocked labels ---
	it('classifies click on Delete button as blocked', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#delete' },
			elementLabel: 'Delete Account',
		});
		expect(result.level).toBe('blocked');
	});

	it('classifies click on Remove as blocked', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#remove' },
			elementLabel: 'Remove User',
		});
		expect(result.level).toBe('blocked');
	});

	it('classifies click on Destroy as blocked', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#destroy' },
			elementLabel: 'Destroy Resource',
		});
		expect(result.level).toBe('blocked');
	});

	it('classifies click on Permanently Delete as blocked', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#perm-delete' },
			elementLabel: 'Permanently Delete All Data',
		});
		expect(result.level).toBe('blocked');
	});

	it('classifies click on Reset as blocked', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#reset' },
			elementLabel: 'Reset Password',
		});
		expect(result.level).toBe('blocked');
	});

	// --- click_element with no/unknown labels ---
	it('classifies click with empty label as review', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: {},
		});
		expect(result.level).toBe('review');
	});

	it('classifies click with unrecognized selector as safe (default)', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#unknown' },
		});
		expect(result.level).toBe('safe');
	});

	it('classifies click with unrecognized label as safe', () => {
		const result = classifyAction({
			toolName: 'click_element',
			args: { selector: '#random' },
			elementLabel: 'Some Random Thing',
		});
		expect(result.level).toBe('safe');
	});

	// --- unknown tools ---
	it('classifies unknown tools as review', () => {
		const result = classifyAction({
			toolName: 'some_new_tool',
			args: {},
		});
		expect(result.level).toBe('review');
	});

	// --- reason is always provided ---
	it('always includes a reason', () => {
		const tests = [
			{ toolName: 'get_page_state', args: {} },
			{ toolName: 'navigate', args: { url: 'https://x.com' } },
			{ toolName: 'type_text', args: { selector: '#x', text: 'y' } },
			{ toolName: 'click_element', args: { selector: '#x' }, elementLabel: 'Delete' },
			{ toolName: 'click_element', args: { selector: '#x' }, elementLabel: 'View' },
			{ toolName: 'click_element', args: { selector: '#x' }, elementLabel: 'Submit' },
		];

		for (const test of tests) {
			const result = classifyAction(test);
			expect(result.reason).toBeTruthy();
			expect(typeof result.reason).toBe('string');
		}
	});
});
