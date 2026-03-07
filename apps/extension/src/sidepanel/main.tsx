import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/chrome-extension';
import { App } from './App.js';
import '../styles.css';

const CLERK_KEY = process.env.CLERK_PUBLISHABLE_KEY!;

function Root() {
	const navigate = (to: string) => {
		// No-op for side panel — no real URL routing
	};

	return (
		<ClerkProvider
			publishableKey={CLERK_KEY}
			afterSignOutUrl="/"
			routerPush={navigate}
			routerReplace={navigate}
		>
			<MemoryRouter>
				<App />
			</MemoryRouter>
		</ClerkProvider>
	);
}

createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<Root />
	</React.StrictMode>,
);
