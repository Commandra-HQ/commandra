import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata = {
	title: 'Agents for Everyone',
	description: 'Dashboard for managing your browser agent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="min-h-screen bg-background antialiased">
				<AuthProvider>{children}</AuthProvider>
			</body>
		</html>
	);
}
