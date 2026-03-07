import { useUser, useClerk } from '@clerk/chrome-extension';
import { useState, useEffect } from 'react';

const API_URL = process.env.API_URL || 'http://localhost:3001';

export function SettingsTab() {
	const { user } = useUser();
	const clerk = useClerk();
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

	const statusColor = {
		checking: 'text-yellow-500',
		connected: 'text-green-600',
		disconnected: 'text-red-500',
	};

	return (
		<div className="p-4 space-y-4">
			<div>
				<p className="text-xs text-gray-500">Account</p>
				<p className="text-sm text-gray-900">{user?.primaryEmailAddress?.emailAddress}</p>
			</div>

			<div>
				<p className="text-xs text-gray-500">Backend</p>
				<p className={`text-sm capitalize ${statusColor[backendStatus]}`}>{backendStatus}</p>
			</div>

			<button
				onClick={() => clerk.signOut()}
				className="w-full py-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50"
			>
				Sign out
			</button>
		</div>
	);
}
