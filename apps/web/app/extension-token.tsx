'use client';

import { useState } from 'react';

export function ExtensionToken() {
	const [token, setToken] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [loading, setLoading] = useState(false);

	async function generateToken() {
		setLoading(true);
		try {
			const res = await fetch('/api/extension/token');
			if (!res.ok) throw new Error('Failed to generate token');
			const data = await res.json();
			setToken(data.token);
			setCopied(false);
		} catch {
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
				Paste this token in the Chrome extension side panel. Tokens expire after 60 seconds — generate a new one if needed.
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
