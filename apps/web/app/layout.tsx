import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata = {
	title: 'Agents for Everyone',
	description: 'Dashboard for managing your browser agent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<ClerkProvider>
			<html lang="en">
				<body className="min-h-screen bg-background antialiased">{children}</body>
			</html>
		</ClerkProvider>
	);
}
