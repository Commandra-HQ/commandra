import { useEffect, useState } from 'react';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { FlowsTab } from './tabs/FlowsTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';

type Tab = 'chat' | 'flows' | 'settings';

interface StoredUser {
	id: string;
	email: string;
}

function AuthenticatedApp({ user }: { user: StoredUser }) {
	const [activeTab, setActiveTab] = useState<Tab>('chat');

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'chat', label: 'Chat' },
		{ id: 'flows', label: 'Flows' },
		{ id: 'settings', label: 'Settings' },
	];

	return (
		<>
			<header className="px-4 py-3 border-b border-border">
				<h1 className="text-sm font-semibold text-foreground">Agents for Everyone</h1>
			</header>

			<nav className="flex border-b border-border">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`flex-1 py-2 text-xs font-medium text-center ${
							activeTab === tab.id
								? 'text-foreground border-b-2 border-foreground'
								: 'text-muted-foreground hover:text-foreground'
						}`}
					>
						{tab.label}
					</button>
				))}
			</nav>

			<div className="flex-1 overflow-y-auto">
				{activeTab === 'chat' && <ChatTab />}
				{activeTab === 'flows' && <FlowsTab />}
				{activeTab === 'settings' && <SettingsTab user={user} />}
			</div>
		</>
	);
}

export function App() {
	const [user, setUser] = useState<StoredUser | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		loadUser();
		const handler = () => loadUser();
		window.addEventListener('auth-changed', handler);
		return () => window.removeEventListener('auth-changed', handler);
	}, []);

	async function loadUser() {
		try {
			const result = await chrome.storage.local.get(['user', 'authToken']);
			if (result.user && result.authToken) {
				setUser(result.user);
			} else {
				setUser(null);
			}
		} catch {
			setUser(null);
		} finally {
			setLoading(false);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen">
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{user ? <AuthenticatedApp user={user} /> : <LoginScreen />}
		</div>
	);
}
