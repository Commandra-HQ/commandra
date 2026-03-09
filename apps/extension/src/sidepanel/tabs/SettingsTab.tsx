import { useEffect, useState } from 'react';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface SettingsTabProps {
	user: { id: string; email: string; clerkId: string };
}

export function SettingsTab({ user }: SettingsTabProps) {
	const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>(
		'checking',
	);

	useEffect(() => {
		checkBackend();
	}, []);

	async function checkBackend() {
		try {
			const res = await fetch(`${API_URL}/health`);
			setBackendStatus(res.ok ? 'connected' : 'disconnected');
		} catch {
			setBackendStatus('disconnected');
		}
	}

	async function handleDisconnect() {
		await chrome.storage.local.remove(['authToken', 'user']);
		window.dispatchEvent(new Event('auth-changed'));
	}

	const statusColor = {
		checking: 'text-yellow-500',
		connected: 'text-green-600',
		disconnected: 'text-red-500',
	};

	return (
		<div className="p-4 space-y-4">
			<div>
				<p className="text-xs text-muted-foreground">Account</p>
				<p className="text-sm text-foreground">{user.email}</p>
			</div>

			<div>
				<p className="text-xs text-muted-foreground">Backend</p>
				<p className={`text-sm capitalize ${statusColor[backendStatus]}`}>{backendStatus}</p>
			</div>

			<button
				onClick={handleDisconnect}
				className="w-full py-2 text-sm text-destructive border border-destructive/20 rounded-md hover:bg-destructive/5"
			>
				Disconnect
			</button>
		</div>
	);
}
