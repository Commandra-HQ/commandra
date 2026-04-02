'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function CallbackHandler() {
	const searchParams = useSearchParams();

	useEffect(() => {
		const token = searchParams.get('token');
		if (!token) {
			window.location.href = '/sign-in';
			return;
		}

		// Store the token and do a full page load so AuthProvider picks it up
		localStorage.setItem('afe_token', token);
		window.location.href = '/';
	}, [searchParams]);

	return (
		<div className="text-center space-y-3">
			<div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent" />
			<p className="text-sm text-muted-foreground">Signing you in...</p>
		</div>
	);
}

export default function AuthCallbackPage() {
	return (
		<div className="flex items-center justify-center h-screen">
			<Suspense
				fallback={
					<div className="text-center space-y-3">
						<div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent" />
						<p className="text-sm text-muted-foreground">Loading...</p>
					</div>
				}
			>
				<CallbackHandler />
			</Suspense>
		</div>
	);
}
