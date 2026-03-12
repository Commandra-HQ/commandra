'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { user, loading } = useAuth();
	const router = useRouter();

	useEffect(() => {
		if (!loading && !user) {
			router.push('/login');
		}
	}, [loading, user, router]);

	if (loading || !user) {
		return (
			<div className="flex items-center justify-center h-screen">
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		);
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
