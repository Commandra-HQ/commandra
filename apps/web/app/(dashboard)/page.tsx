'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { DashboardStats } from './dashboard-stats';
import { ExtensionToken } from './extension-token';

export default function HomePage() {
	const { user } = useAuth();

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				<p className="text-muted-foreground mt-1">
					Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}. Here&apos;s your agent
					overview.
				</p>
			</div>

			{/* Stats */}
			<DashboardStats />

			{/* Extension connect */}
			<Card>
				<CardHeader>
					<CardTitle>Connect Chrome Extension</CardTitle>
					<CardDescription>
						Generate a token and paste it in the extension side panel to connect.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ExtensionToken />
				</CardContent>
			</Card>
		</div>
	);
}
