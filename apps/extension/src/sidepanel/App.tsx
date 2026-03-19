import { useCallback, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { useTheme } from './theme.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { HubTab } from './tabs/HubTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';

type Page = 'hub' | 'chat' | 'settings';

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
	const [page, setPage] = useState<Page>('hub');
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
		setPage('chat');
	}

	function goToHub() {
		setPage('hub');
	}

	return (
		<>
			{/* Global header — visible on hub only (chat/settings have their own back nav) */}
			{page === 'hub' && (
				<header className="px-4 py-3 border-b border-border flex items-center justify-between">
					<h1 className="text-sm font-semibold text-foreground">Commandra</h1>
					<button
						onClick={() => setPage('settings')}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
						title="Settings"
					>
						<Settings size={16} />
					</button>
				</header>
			)}

			<div className="flex-1 overflow-hidden">
				{page === 'hub' && (
					<HubTab
						activeChats={activeChats}
						onOpenConversation={openConversation}
					/>
				)}
				{page === 'chat' && (
					<ChatTab
						conversationId={activeConversationId}
						onConversationChange={setActiveConversationId}
						onBack={goToHub}
						onStreamStart={markChatActive}
						onStreamEnd={markChatDone}
					/>
				)}
				{page === 'settings' && (
					<SettingsTab user={user} onBack={goToHub} />
				)}
			</div>
		</>
	);
}

export function App() {
	const [user, setUser] = useState<StoredUser | null>(null);
	const [loading, setLoading] = useState(true);

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
