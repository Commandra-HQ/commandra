import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './contexts/auth.js';
import { ActiveChatsProvider } from './contexts/active-chats.js';
import '../styles.css';

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
