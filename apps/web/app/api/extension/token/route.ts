import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function GET() {
	const { userId, getToken } = await auth();
	if (!userId) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const clerkToken = await getToken();
	if (!clerkToken) {
		return NextResponse.json({ error: 'No Clerk token' }, { status: 401 });
	}

	// Exchange Clerk token for our custom JWT via the API's token exchange endpoint
	try {
		const res = await fetch(`${API_URL}/api/token/exchange`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clerkToken }),
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: 'Exchange failed' }));
			return NextResponse.json(err, { status: res.status });
		}

		const data = await res.json();
		return NextResponse.json({ token: data.token, userId: data.userId });
	} catch (err) {
		console.error('Token exchange error:', err);
		return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
	}
}
