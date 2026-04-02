'use client';

import { useEffect, useState } from 'react';

/**
 * Clerk proves who you are in the browser; the Commandra API only accepts our JWT.
 * This calls GET /api/token (server reads Clerk → POST /api/token/exchange) and stores
 * `afe_token` for API calls. Brief redirect after sign-in.
 */
export default function ClerkBridgePage() {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function bridge() {
			try {
				const res = await fetch('/api/token');
				if (!res.ok) {
					const data = await res.json();
					setError(data.error || 'Failed to get token');
					return;
				}
				const data = await res.json();
				localStorage.setItem('afe_token', data.token);
				window.location.href = '/';
			} catch {
				setError('Failed to connect to server');
			}
		}
		bridge();
	}, []);

	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center space-y-4">
					<p className="text-destructive">{error}</p>
					<a href="/sign-in" className="text-sm text-muted-foreground underline">
						Back to sign in
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center">
			<div className="text-center space-y-3">
				<div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent" />
				<p className="text-sm text-muted-foreground">Signing you in...</p>
			</div>
		</div>
	);
}
