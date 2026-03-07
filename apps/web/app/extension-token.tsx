'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function ExtensionToken() {
	const [token, setToken] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [loading, setLoading] = useState(false);

	async function generateToken() {
		setLoading(true);
		try {
			// Get short-lived Clerk token
			const clerkRes = await fetch('/api/extension/token');
			if (!clerkRes.ok) throw new Error('Failed to get Clerk token');
			const { token: clerkToken } = await clerkRes.json();

			// Exchange for long-lived extension JWT
			const exchangeRes = await fetch(`${API_URL}/api/token/exchange`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clerkToken }),
			});
			if (!exchangeRes.ok) throw new Error('Failed to exchange token');
			const { token: extensionToken } = await exchangeRes.json();

			setToken(extensionToken);
			setCopied(false);
		} catch (err) {
			console.error('Token generation failed:', err);
			setToken(null);
		} finally {
			setLoading(false);
		}
	}

	async function copyToken() {
		if (!token) return;
		await navigator.clipboard.writeText(token);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	if (!token) {
		return (
			<button
				onClick={generateToken}
				disabled={loading}
				className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800 disabled:opacity-50"
			>
				{loading ? 'Generating...' : 'Generate Extension Token'}
			</button>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<code className="flex-1 text-xs bg-gray-100 p-3 rounded-md break-all select-all max-h-20 overflow-y-auto">
					{token}
				</code>
				<button
					onClick={copyToken}
					className="shrink-0 px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800"
				>
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
			<p className="text-xs text-gray-500">
				Paste this token in the Chrome extension side panel. Token is valid for 30 days.
			</p>
			<button
				onClick={generateToken}
				className="text-xs text-gray-500 underline hover:text-gray-700"
			>
				Generate new token
			</button>
		</div>
	);
}
