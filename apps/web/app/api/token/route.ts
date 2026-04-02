import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function GET() {
	const { userId, orgId, orgRole } = await auth();

	if (!userId) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const user = await currentUser();

	if (!user) {
		return NextResponse.json({ error: 'User not found' }, { status: 404 });
	}

	const email =
		user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
		user.emailAddresses[0]?.emailAddress;

	if (!email) {
		return NextResponse.json({ error: 'No email address found' }, { status: 400 });
	}

	try {
		const body: Record<string, string> = {
			externalId: userId,
			email,
		};

		if (orgId) {
			body.orgExternalId = orgId;
			body.role = orgRole === 'org:admin' ? 'admin' : 'member';

			try {
				const client = await clerkClient();
				const org = await client.organizations.getOrganization({ organizationId: orgId });
				body.orgName = org.name;
			} catch {
				body.orgName = orgId;
			}
		}

		const res = await fetch(`${API_URL}/api/token/exchange`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const data = await res.json();
			return NextResponse.json(
				{ error: data.error || 'Token exchange failed' },
				{ status: res.status },
			);
		}

		const data = await res.json();
		return NextResponse.json({ token: data.token });
	} catch (err) {
		console.error('Token exchange failed:', err);
		return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
	}
}
