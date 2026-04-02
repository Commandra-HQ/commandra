import { clerkMiddleware } from '@clerk/nextjs/server';

/**
 * Clerk middleware without global auth.protect(): dashboard access is gated by
 * JWT in localStorage + useAuth(); this only wires Clerk for session/API routes.
 */
export default clerkMiddleware();

export const config = {
	matcher: [
		'/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
		'/(api|trpc)(.*)',
	],
};
