import { notFound } from 'next/navigation';
import { SentryExampleButtons } from './sentry-example-buttons';

/**
 * Development-only route to verify Sentry (dashboard project).
 * Visit http://localhost:3000/sentry-example-page and click a button.
 */
export default function SentryExamplePage() {
	if (process.env.NODE_ENV !== 'development') {
		notFound();
	}

	return (
		<div className="mx-auto max-w-md px-6 py-16">
			<h1 className="text-2xl font-semibold tracking-tight">Sentry verification</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				This page exists only in development. Open your Sentry project (commandra-dashboard) →
				Issues after clicking a button.
			</p>
			<div className="mt-8">
				<SentryExampleButtons />
			</div>
		</div>
	);
}
