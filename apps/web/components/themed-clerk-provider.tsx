'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';
import { useSyncExternalStore, type ReactNode } from 'react';

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const sharedElements = {
	rootBox: 'mx-auto',
	card: 'shadow-md',
} as const;

export function ThemedClerkProvider({ children }: { children: ReactNode }) {
	const { resolvedTheme } = useTheme();
	const mounted = useSyncExternalStore(
		subscribe,
		getClientSnapshot,
		getServerSnapshot,
	);

	/** Until client mount, assume dark (matches ThemeProvider defaultTheme). Treat unknown resolvedTheme as dark. */
	const useDark = !mounted || resolvedTheme !== 'light';

	return (
		<ClerkProvider
			appearance={{
				baseTheme: useDark ? dark : undefined,
				elements: sharedElements,
			}}
		>
			{children}
		</ClerkProvider>
	);
}
