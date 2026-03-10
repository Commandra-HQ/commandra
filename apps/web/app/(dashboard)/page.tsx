import { currentUser } from '@clerk/nextjs/server';
import { Globe, History, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExtensionToken } from './extension-token';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function getStats(userId: string) {
	try {
		const res = await fetch(`${API_URL}/api/stats`, {
			headers: { 'x-user-id': userId },
			cache: 'no-store',
		});
		if (!res.ok) return null;
		return res.json();
	} catch {
		return null;
	}
}

export default async function HomePage() {
	const user = await currentUser();
	const stats = user ? await getStats(user.id) : null;

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				<p className="text-muted-foreground mt-1">
					Welcome back{user?.firstName ? `, ${user.firstName}` : ''}. Here&apos;s your agent overview.
				</p>
			</div>

			{/* Stats */}
			<div className="grid gap-4 sm:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
						<CardTitle className="text-sm font-medium">Conversations</CardTitle>
						<History size={16} className="text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats?.conversations ?? 0}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
						<CardTitle className="text-sm font-medium">Agent Actions</CardTitle>
						<Shield size={16} className="text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats?.actions ?? 0}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
						<CardTitle className="text-sm font-medium">Sites Indexed</CardTitle>
						<Globe size={16} className="text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats?.sites ?? 0}</div>
					</CardContent>
				</Card>
			</div>

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
