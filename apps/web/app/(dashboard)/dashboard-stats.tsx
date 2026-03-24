'use client';

import { Card, CardContent } from '@/components/ui/card';
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

	const items = [
		{ label: 'Conversations', value: stats?.conversations ?? 0, icon: History },
		{ label: 'Agent Actions', value: stats?.actions ?? 0, icon: Shield },
		{ label: 'Sites Indexed', value: stats?.sites ?? 0, icon: Globe },
	];

	return (
		<div className="grid gap-1 sm:grid-cols-3">
			{items.map((item) => (
				<Card key={item.label}>
					<CardContent className="p-5">
						<div className="flex items-center justify-between mb-3">
							<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
								{item.label}
							</span>
							<item.icon size={14} strokeWidth={1.5} className="text-dim" />
						</div>
						<div className="text-2xl font-mono font-medium text-foreground">
							{loading ? (
								<span className="text-muted-foreground">--</span>
							) : (
								item.value.toLocaleString()
							)}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
