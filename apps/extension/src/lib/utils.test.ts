import { describe, expect, it } from 'vitest';
import { cn } from './utils.js';

describe('cn utility', () => {
	it('merges class names', () => {
		expect(cn('foo', 'bar')).toBe('foo bar');
	});

	it('handles conditional classes', () => {
		expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
	});

	it('merges tailwind classes correctly', () => {
		// tailwind-merge should resolve conflicts
		expect(cn('p-4', 'p-2')).toBe('p-2');
		expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
	});

	it('handles undefined and null', () => {
		expect(cn('base', undefined, null, 'end')).toBe('base end');
	});

	it('handles empty input', () => {
		expect(cn()).toBe('');
	});

	it('handles array syntax from clsx', () => {
		expect(cn(['foo', 'bar'])).toBe('foo bar');
	});

	it('handles object syntax from clsx', () => {
		expect(cn({ hidden: true, visible: false })).toBe('hidden');
	});
});
