'use client';

import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

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
				<div className="flex items-center gap-2">
					<div className="status-pixel bg-muted-foreground animate-pulse" />
					<p className="text-sm font-mono text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-screen overflow-x-hidden">
			<Sidebar />
			<div className="flex-1 flex flex-col min-w-0 overflow-hidden">
				<Topbar />
				<main className="flex-1 flex flex-col overflow-y-auto bg-background px-4 py-4 md:px-6">
					{children}
				</main>
			</div>
		</div>
	);
}
