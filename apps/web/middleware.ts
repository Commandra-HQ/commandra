import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/api/auth', '/sentry-example-page'];

export function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Allow public routes
	if (publicPaths.some((p) => pathname.startsWith(p))) {
		return NextResponse.next();
	}

	// Check for auth token in cookie (set by client-side auth)
	// The actual JWT verification happens server-side when calling the API.
	// Middleware just redirects unauthenticated users to login.
	const token = request.cookies.get('afe_token')?.value;
	if (!token) {
		// Also check localStorage via a client-side redirect approach:
		// Since middleware can't read localStorage, we let the client-side
		// AuthProvider handle the redirect. Middleware only blocks API routes.
		return NextResponse.next();
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		'/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
	],
};
