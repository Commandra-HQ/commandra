'use client';

import { useEffect, useState } from 'react';
import { Globe, History, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Stats {
	conversations: number;
	actions: number;
	sites: number;
}

async function getToken(): Promise<string> {
	const res = await fetch('/api/extension/token');
	const data = await res.json();
	return data.token;
}

export function DashboardStats() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchStats();
	}, []);

	async function fetchStats() {
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/stats`, {
				headers: { Authorization: `Bearer ${token}` },
			});
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
						{loading ? <span className="text-muted-foreground">--</span> : (stats?.conversations ?? 0)}
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
