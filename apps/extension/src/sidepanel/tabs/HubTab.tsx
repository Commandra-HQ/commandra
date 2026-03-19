import { Clock, Loader2, MessageSquare, Plus, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveChats } from '../contexts/active-chats.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface ConversationSummary {
	id: string;
	title: string;
	messageCount: number;
	updatedAt: string;
	agentId?: string | null;
	agentName?: string | null;
}

function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function formatElapsed(startedAt: number): string {
	const seconds = Math.floor((Date.now() - startedAt) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${minutes}m ${secs}s`;
}

export function HubTab() {
	const navigate = useNavigate();
	const { activeChats } = useActiveChats();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [currentDomain, setCurrentDomain] = useState('');

	// Tick for elapsed time on active chats
	const [, setTick] = useState(0);
	useEffect(() => {
		if (activeChats.size === 0) return;
		const interval = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(interval);
	}, [activeChats.size]);

	useEffect(() => {
		loadConversations();
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (tab?.url) {
				try {
					setCurrentDomain(new URL(tab.url).hostname);
				} catch {}
			}
		});
	}, []);

	async function loadConversations() {
		try {
			setLoading(true);
			const stored = await chrome.storage.local.get('authToken');
			if (!stored.authToken) return;
			const res = await fetch(`${API_URL}/api/conversations`, {
				headers: { Authorization: `Bearer ${stored.authToken}` },
			});
			if (res.ok) {
				const data = await res.json();
				setConversations(data.conversations || []);
			}
		} catch (err) {
			console.error('Failed to load conversations:', err);
		} finally {
			setLoading(false);
		}
	}

	function openConversation(convId: string | null) {
		if (convId) {
			navigate(`/chat/${convId}`);
		} else {
			navigate('/chat');
		}
	}

	const activeList = Array.from(activeChats.values());

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* New Chat */}
			<div className="px-3 pt-3 pb-2 flex-shrink-0">
				<button
					onClick={() => openConversation(null)}
					className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:bg-secondary/50 transition-colors"
				>
					<Plus size={14} className="text-muted-foreground flex-shrink-0" />
					<div className="flex-1 min-w-0 text-left">
						<p className="text-xs font-medium text-foreground">New Chat</p>
						{currentDomain && (
							<p className="text-[10px] text-muted-foreground truncate">
								{currentDomain}
							</p>
						)}
					</div>
				</button>
			</div>

			{/* Active / Running */}
			{activeList.length > 0 && (
				<div className="flex-shrink-0 border-b border-border">
					<p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
						Running
					</p>
					{activeList.map((chat) => (
						<button
							key={chat.conversationId}
							onClick={() => openConversation(chat.conversationId)}
							className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors flex items-center gap-2"
						>
							<div className="relative flex-shrink-0">
								<Zap size={12} className="text-yellow-500" />
								<span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-xs font-medium text-foreground truncate">
									{chat.agentName}
								</p>
								<p className="text-[10px] text-muted-foreground truncate">
									{chat.task}
								</p>
							</div>
							<span className="text-[10px] text-muted-foreground flex-shrink-0">
								{formatElapsed(chat.startedAt)}
							</span>
						</button>
					))}
				</div>
			)}

			{/* Recent Conversations — scrollable */}
			<div className="flex-1 overflow-y-auto min-h-0">
				<p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					Recent
				</p>

				{loading && (
					<div className="flex items-center justify-center py-8">
						<Loader2 size={16} className="animate-spin text-muted-foreground" />
					</div>
				)}

				{!loading && conversations.length === 0 && (
					<div className="px-3 py-8 text-center">
						<p className="text-xs text-muted-foreground">No conversations yet.</p>
						<p className="text-[10px] text-muted-foreground mt-1">
							Start a new chat to get going.
						</p>
					</div>
				)}

				{conversations.map((conv) => (
					<button
						key={conv.id}
						onClick={() => openConversation(conv.id)}
						className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors flex items-center gap-2"
					>
						<MessageSquare
							size={12}
							className="text-muted-foreground flex-shrink-0"
						/>
						<div className="flex-1 min-w-0">
							<p className="text-xs text-foreground truncate">
								{conv.title || 'Untitled'}
							</p>
							<div className="flex items-center gap-1.5 mt-0.5">
								{conv.agentName && (
									<span className="inline-flex items-center gap-0.5 text-[10px] text-yellow-500">
										<Zap size={8} />
										{conv.agentName}
									</span>
								)}
								<span className="text-[10px] text-muted-foreground">
									{conv.messageCount} msgs
								</span>
								<span className="text-[10px] text-muted-foreground">
									{formatRelativeTime(new Date(conv.updatedAt).getTime())}
								</span>
							</div>
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
