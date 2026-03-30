import * as Sentry from '@sentry/browser';

export function initSentry(context: 'sidepanel' | 'background'): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
	if (!dsn) return;

	const version = chrome.runtime.getManifest().version;

	Sentry.init({
		dsn,
		environment: import.meta.env.PROD ? 'production' : 'development',
		release: `commandra-extension@${version}`,
		sendDefaultPii: false,
		tracesSampleRate: 0,
		initialScope: {
			tags: { extension_context: context },
		},
	});
}
