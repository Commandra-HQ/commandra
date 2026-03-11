'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

export function ExtensionToken() {
	const { token } = useAuth();
	const [copied, setCopied] = useState(false);
	const [revealed, setRevealed] = useState(false);

	async function copyToken() {
		if (!token) return;
		await navigator.clipboard.writeText(token);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	if (!token) {
		return <p className="text-sm text-muted-foreground">Sign in to generate a token.</p>;
	}

	if (!revealed) {
		return (
			<Button onClick={() => setRevealed(true)}>
				Reveal Extension Token
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
		</div>
	);
}
