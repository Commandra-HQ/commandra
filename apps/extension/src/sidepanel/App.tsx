import { useCallback, useEffect, useState } from 'react';
import { useTheme } from './theme.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { HubTab } from './tabs/HubTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';

type Tab = 'hub' | 'chat' | 'settings';

export interface ActiveChat {
	conversationId: string;
	agentName: string;
	task: string;
	startedAt: number;
}

interface StoredUser {
	id: string;
	email: string;
}

function AuthenticatedApp({ user }: { user: StoredUser }) {
	const [activeTab, setActiveTab] = useState<Tab>('hub');
	const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
	const [activeChats, setActiveChats] = useState<Map<string, ActiveChat>>(new Map());

	// Listen for WS events forwarded from background (scheduled agent runs)
	useEffect(() => {
		function handleMessage(message: { type: string; payload?: Record<string, unknown> }) {
			if (message.type === 'SCHEDULED_AGENT_START' && message.payload) {
				const { conversationId, agentName, task } = message.payload as {
					conversationId: string;
					agentName: string;
					task: string;
				};
				setActiveChats((prev) => {
					const next = new Map(prev);
					next.set(conversationId, {
						conversationId,
						agentName: agentName || 'Scheduled Agent',
						task: task || 'Scheduled run',
						startedAt: Date.now(),
					});
					return next;
				});
			} else if (message.type === 'SCHEDULED_AGENT_END' && message.payload) {
				const { conversationId } = message.payload as { conversationId: string };
				setActiveChats((prev) => {
					const next = new Map(prev);
					next.delete(conversationId);
					return next;
				});
			}
		}
		chrome.runtime.onMessage.addListener(handleMessage);
		return () => chrome.runtime.onMessage.removeListener(handleMessage);
	}, []);

	const markChatActive = useCallback(
		(conversationId: string, agentName: string, task: string) => {
			setActiveChats((prev) => {
				const next = new Map(prev);
				next.set(conversationId, {
					conversationId,
					agentName,
					task,
					startedAt: Date.now(),
				});
				return next;
			});
		},
		[],
	);

	const markChatDone = useCallback((conversationId: string) => {
		setActiveChats((prev) => {
			const next = new Map(prev);
			next.delete(conversationId);
			return next;
		});
	}, []);

	function openConversation(convId: string | null) {
		setActiveConversationId(convId);
		setActiveTab('chat');
	}

	function goToHub() {
		setActiveTab('hub');
	}

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'hub', label: 'Hub' },
		{ id: 'chat', label: 'Chat' },
		{ id: 'settings', label: 'Settings' },
	];

	return (
		<>
			<header className="px-4 py-3 border-b border-border">
				<h1 className="text-sm font-semibold text-foreground">Commandra</h1>
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
				{activeTab === 'hub' && (
					<HubTab
						activeChats={activeChats}
						onOpenConversation={openConversation}
					/>
				)}
				{activeTab === 'chat' && (
					<ChatTab
						conversationId={activeConversationId}
						onConversationChange={setActiveConversationId}
						onBack={goToHub}
						onStreamStart={markChatActive}
						onStreamEnd={markChatDone}
					/>
				)}
				{activeTab === 'settings' && <SettingsTab user={user} />}
			</div>
		</>
	);
}

export function App() {
	const [user, setUser] = useState<StoredUser | null>(null);
	const [loading, setLoading] = useState(true);

	// Apply theme (system/light/dark) to <html> for Tailwind dark: classes
	useTheme();

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
