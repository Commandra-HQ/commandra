import { SignedIn, SignedOut, useAuth, useUser } from '@clerk/chrome-extension';
import { useState, useEffect } from 'react';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { FlowsTab } from './tabs/FlowsTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';

type Tab = 'chat' | 'flows' | 'settings';

const API_URL = process.env.API_URL || 'http://localhost:3001';

export function App() {
	const [activeTab, setActiveTab] = useState<Tab>('chat');
	const { getToken } = useAuth();

	useEffect(() => {
		syncUser();
	}, []);

	async function syncUser() {
		try {
			const token = await getToken();
			if (!token) return;
			await fetch(`${API_URL}/api/auth/sync`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
			});
		} catch {
			// Sync will retry on next load
		}
	}

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'chat', label: 'Chat' },
		{ id: 'flows', label: 'Flows' },
		{ id: 'settings', label: 'Settings' },
	];

	return (
		<div className="flex flex-col h-screen bg-white">
			<SignedOut>
				<LoginScreen />
			</SignedOut>

			<SignedIn>
				<header className="px-4 py-3 border-b border-gray-200">
					<h1 className="text-sm font-semibold text-gray-900">Agents for Everyone</h1>
				</header>

				<nav className="flex border-b border-gray-200">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={`flex-1 py-2 text-xs font-medium text-center ${
								activeTab === tab.id
									? 'text-blue-600 border-b-2 border-blue-600'
									: 'text-gray-500 hover:text-gray-700'
							}`}
						>
							{tab.label}
						</button>
					))}
				</nav>

				<div className="flex-1 overflow-y-auto">
					{activeTab === 'chat' && <ChatTab />}
					{activeTab === 'flows' && <FlowsTab />}
					{activeTab === 'settings' && <SettingsTab />}
				</div>
			</SignedIn>
		</div>
	);
}
