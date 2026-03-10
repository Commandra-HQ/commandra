'use client';

import { Copy, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function ExtensionToken() {
	const [token, setToken] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [loading, setLoading] = useState(false);

	async function generateToken() {
		setLoading(true);
		try {
			const clerkRes = await fetch('/api/extension/token');
			if (!clerkRes.ok) throw new Error('Failed to get Clerk token');
			const { token: clerkToken } = await clerkRes.json();

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
			<Button onClick={generateToken} disabled={loading}>
				{loading && <Loader2 size={16} className="mr-2 animate-spin" />}
				{loading ? 'Generating...' : 'Generate Extension Token'}
			</Button>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<code className="flex-1 text-xs bg-muted p-3 rounded-md break-all select-all max-h-20 overflow-y-auto">
					{token}
				</code>
				<Button variant="outline" size="sm" onClick={copyToken}>
					{copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
					{copied ? 'Copied' : 'Copy'}
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				Paste this token in the Chrome extension side panel. Valid for 30 days.
			</p>
			<button onClick={generateToken} className="text-xs text-muted-foreground underline hover:text-foreground">
				Generate new token
			</button>
		</div>
	);
}
