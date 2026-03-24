import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata = {
	title: 'Commandra',
	description: 'Dashboard for managing your browser agents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<head>
				<link
					href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
					rel="stylesheet"
				/>
			</head>
			<body className="min-h-screen bg-background font-sans antialiased">
				<AuthProvider>{children}</AuthProvider>
			</body>
		</html>
	);
}
