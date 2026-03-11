import { currentUser } from '@clerk/nextjs/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExtensionToken } from './extension-token';
import { DashboardStats } from './dashboard-stats';

export default async function HomePage() {
	const user = await currentUser();

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				<p className="text-muted-foreground mt-1">
					Welcome back{user?.firstName ? `, ${user.firstName}` : ''}. Here&apos;s your agent overview.
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
