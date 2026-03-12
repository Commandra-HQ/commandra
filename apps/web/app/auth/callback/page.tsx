'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallbackPage() {
	const router = useRouter();
	const searchParams = useSearchParams();

	useEffect(() => {
		const token = searchParams.get('token');
		if (!token) {
			router.replace('/login');
			return;
		}

		// Store the token and clean up the URL
		localStorage.setItem('afe_token', token);
		window.history.replaceState({}, '', '/auth/callback');
		router.replace('/');
	}, [searchParams, router]);

	return (
		<div className="flex items-center justify-center h-screen">
			<div className="text-center space-y-3">
				<div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent" />
				<p className="text-sm text-muted-foreground">Signing you in...</p>
			</div>
		</div>
	);
}
