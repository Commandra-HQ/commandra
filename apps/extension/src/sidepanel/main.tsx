import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { initSentry } from '../lib/sentry.js';
import { App } from './App.js';
import { ActiveChatsProvider } from './contexts/active-chats.js';
import { AuthProvider } from './contexts/auth.js';
import '../styles.css';

initSentry('sidepanel');

createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<MemoryRouter>
			<AuthProvider>
				<ActiveChatsProvider>
					<App />
				</ActiveChatsProvider>
			</AuthProvider>
		</MemoryRouter>
	</React.StrictMode>,
);
