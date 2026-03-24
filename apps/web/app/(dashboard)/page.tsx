'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardStats } from './dashboard-stats';
import { ExtensionToken } from './extension-token';

export default function HomePage() {
	return (
		<div className="space-y-6">
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

			<DashboardStats />
		</div>
	);
}
