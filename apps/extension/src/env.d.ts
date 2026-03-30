/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare namespace process {
	const env: {
		API_URL: string;
		WS_URL?: string;
		DASHBOARD_URL?: string;
		GOODBYE_URL?: string;
	};
}
