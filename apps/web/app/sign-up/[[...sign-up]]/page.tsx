'use client';

import { SignUp, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SignUpPage() {
	const { isSignedIn, isLoaded } = useUser();
	const router = useRouter();

	useEffect(() => {
		if (isLoaded && isSignedIn) {
			router.replace('/auth/clerk-bridge');
		}
	}, [isLoaded, isSignedIn, router]);

	if (!isLoaded || isSignedIn) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="text-center space-y-3">
					<div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<p className="text-sm text-muted-foreground">Continuing…</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<SignUp
				forceRedirectUrl="/auth/clerk-bridge"
				signInForceRedirectUrl="/auth/clerk-bridge"
			/>
		</div>
	);
}
