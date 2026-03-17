/**
 * Theme config: single place for theme storage key and options.
 * Styling uses Tailwind's class-based dark mode (class on <html>).
 */

import { useCallback, useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'theme';

export type Theme = 'system' | 'light' | 'dark';

export const DEFAULT_THEME: Theme = 'system';

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
	{ value: 'system', label: 'System theme' },
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
];

export type ResolvedTheme = 'light' | 'dark';

export function getSystemPrefersDark(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(theme: Theme): ResolvedTheme {
	if (theme === 'dark') return 'dark';
	if (theme === 'light') return 'light';
	return getSystemPrefersDark() ? 'dark' : 'light';
}

export function applyResolvedTheme(resolved: ResolvedTheme) {
	const root = document.documentElement;
	if (resolved === 'dark') {
		root.classList.add('dark');
	} else {
		root.classList.remove('dark');
	}
}

export function useTheme() {
	const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
		resolveTheme(DEFAULT_THEME),
	);

	// Load theme from storage on mount
	useEffect(() => {
		chrome.storage.local.get([THEME_STORAGE_KEY], (result) => {
			const stored = (result[THEME_STORAGE_KEY] as Theme) || DEFAULT_THEME;
			setThemeState(stored);
			setResolvedTheme(resolveTheme(stored));
		});
	}, []);

	// Apply resolved theme to <html> and react to system preference when theme is 'system'
	useEffect(() => {
		const resolved = resolveTheme(theme);
		setResolvedTheme(resolved);
		applyResolvedTheme(resolved);

		if (theme !== 'system') return;

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const listener = () => {
			const r = getSystemPrefersDark() ? 'dark' : 'light';
			setResolvedTheme(r);
			applyResolvedTheme(r);
		};
		mq.addEventListener('change', listener);
		return () => mq.removeEventListener('change', listener);
	}, [theme]);

	// Listen for storage changes (e.g. from another tab or popup)
	useEffect(() => {
		const listener = (
			changes: { [key: string]: chrome.storage.StorageChange },
			areaName: string,
		) => {
			if (areaName !== 'local' || !(THEME_STORAGE_KEY in changes)) return;
			const next = (changes[THEME_STORAGE_KEY]?.newValue as Theme) ?? DEFAULT_THEME;
			setThemeState(next);
		};
		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, []);

	const setTheme = useCallback((next: Theme) => {
		setThemeState(next);
		chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
	}, []);

	return { theme, setTheme, resolvedTheme };
}
