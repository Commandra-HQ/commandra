import { AuthProvider } from '@/lib/auth-context';
import { ThemedClerkProvider } from '@/components/themed-clerk-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { Providers } from './providers';
import './globals.css';

/** Avoid static prerender of routes wrapped by Clerk (invalid placeholder keys fail validation at build). */
export const dynamic = 'force-dynamic';

export const metadata = {
	title: 'Commandra',
	description: 'Dashboard for managing your browser agents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<link
					href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
					rel="stylesheet"
				/>
			</head>
			<body className="min-h-screen bg-background font-sans antialiased overflow-x-hidden">
				<Providers>
					<ThemeProvider>
						<ThemedClerkProvider>
							<AuthProvider>{children}</AuthProvider>
						</ThemedClerkProvider>
					</ThemeProvider>
				</Providers>
			</body>
		</html>
	);
}
