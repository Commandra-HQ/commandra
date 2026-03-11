'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { user, loading } = useAuth();
	const router = useRouter();

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen">
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		);
	}

	if (!user) {
		router.push('/login');
		return null;
	}

	return (
		<div className="flex h-screen">
			<Sidebar />
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
			</main>
		</div>
	);
}
