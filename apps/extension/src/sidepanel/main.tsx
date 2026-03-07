import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/chrome-extension';
import { App } from './App.js';
import '../styles.css';

const CLERK_KEY = process.env.CLERK_PUBLISHABLE_KEY!;

createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/">
			<App />
		</ClerkProvider>
	</React.StrictMode>,
);
