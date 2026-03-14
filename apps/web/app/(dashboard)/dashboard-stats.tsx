'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { Globe, History, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Stats {
	conversations: number;
	actions: number;
	sites: number;
}

export function DashboardStats() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchStats();
	}, []);

	async function fetchStats() {
		try {
			const res = await apiFetch('/api/stats');
			if (res.ok) {
				setStats(await res.json());
			}
		} catch {
			// Stats unavailable
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="grid gap-4 sm:grid-cols-3">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
					<CardTitle className="text-sm font-medium">Conversations</CardTitle>
					<History size={16} className="text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">
						{loading ? (
							<span className="text-muted-foreground">--</span>
						) : (
							(stats?.conversations ?? 0)
						)}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
					<CardTitle className="text-sm font-medium">Agent Actions</CardTitle>
					<Shield size={16} className="text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">
						{loading ? <span className="text-muted-foreground">--</span> : (stats?.actions ?? 0)}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
					<CardTitle className="text-sm font-medium">Sites Indexed</CardTitle>
					<Globe size={16} className="text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">
						{loading ? <span className="text-muted-foreground">--</span> : (stats?.sites ?? 0)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
