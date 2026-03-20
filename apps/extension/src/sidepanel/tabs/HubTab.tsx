import { ListChecks, Loader2, MessageSquare, Plus, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
	planStatus?: {
		totalSteps: number;
		completedSteps: number;
		status: string;
	} | null;
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

	const updateDomain = useCallback(() => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (tab?.url) {
				try {
					setCurrentDomain(new URL(tab.url).hostname);
				} catch {}
			}
		});
	}, []);

	useEffect(() => {
		loadConversations();
		updateDomain();

		const onActivated = () => updateDomain();
		chrome.tabs.onActivated.addListener(onActivated);
		chrome.tabs.onUpdated.addListener(onActivated);
		return () => {
			chrome.tabs.onActivated.removeListener(onActivated);
			chrome.tabs.onUpdated.removeListener(onActivated);
		};
	}, [updateDomain]);

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

	// Partition into running and completed
	const running: (ConversationSummary & {
		active: NonNullable<ReturnType<typeof activeChats.get>>;
	})[] = [];
	const completed: ConversationSummary[] = [];

	for (const conv of conversations) {
		const active = activeChats.get(conv.id);
		if (active) {
			running.push({ ...conv, active });
		} else {
			completed.push(conv);
		}
	}

	// Sort running by most recently started, completed by most recently updated
	running.sort((a, b) => b.active.startedAt - a.active.startedAt);
	completed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* New Chat button */}
			<div className="px-3 pt-3 pb-2 flex-shrink-0">
				<button
					type="button"
					onClick={() => openConversation(null)}
					className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
				>
					<Plus size={14} className="flex-shrink-0" />
					<div className="flex-1 min-w-0 text-left">
						<p className="text-xs font-medium">New Chat</p>
						{currentDomain && <p className="text-[10px] opacity-70 truncate">{currentDomain}</p>}
					</div>
				</button>
			</div>

			{/* Chat list */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{loading && (
					<div className="flex items-center justify-center py-8">
						<Loader2 size={16} className="animate-spin text-muted-foreground" />
					</div>
				)}

				{!loading && conversations.length === 0 && (
					<div className="px-4 py-12 text-center">
						<div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
							<MessageSquare size={18} className="text-muted-foreground" />
						</div>
						<p className="text-sm text-foreground font-medium">No conversations yet</p>
						<p className="text-xs text-muted-foreground mt-1">Start a new chat to begin</p>
					</div>
				)}

				{/* Running section */}
				{running.length > 0 && (
					<div className="px-3 pt-2">
						<p className="text-[10px] font-medium text-green-500 uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
							</span>
							Running ({running.length})
						</p>
						<div className="space-y-0.5">
							{running.map((conv) => (
								<button
									type="button"
									key={conv.id}
									onClick={() => openConversation(conv.id)}
									className="w-full text-left px-3 py-2.5 rounded-lg border border-green-500/20 bg-green-500/5 hover:bg-green-500/10 transition-colors"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0 flex-1">
											<Loader2 size={12} className="text-green-500 animate-spin flex-shrink-0" />
											<p className="text-xs font-medium text-foreground truncate">
												{conv.title || 'Untitled'}
											</p>
										</div>
										<span className="text-[10px] text-green-500 tabular-nums flex-shrink-0 font-mono">
											{formatElapsed(conv.active.startedAt)}
										</span>
									</div>
									<div className="flex items-center gap-1.5 mt-1 pl-5">
										{conv.agentName && (
											<span className="inline-flex items-center gap-0.5 text-[10px] text-yellow-500">
												<Zap size={8} />
												{conv.agentName}
											</span>
										)}
										{conv.planStatus && conv.planStatus.status !== 'completed' && (
											<span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400">
												<ListChecks size={8} />
												{conv.planStatus.completedSteps}/{conv.planStatus.totalSteps}
											</span>
										)}
									</div>
								</button>
							))}
						</div>
					</div>
				)}

				{/* Completed section */}
				{completed.length > 0 && (
					<div className="px-3 pt-2">
						{running.length > 0 && (
							<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
								Recent
							</p>
						)}
						<div className="space-y-0.5">
							{completed.map((conv) => (
								<button
									type="button"
									key={conv.id}
									onClick={() => openConversation(conv.id)}
									className="w-full text-left px-3 py-2 rounded-lg hover:bg-secondary/50 transition-colors group"
								>
									<div className="flex items-center gap-2">
										<MessageSquare size={12} className="text-muted-foreground flex-shrink-0" />
										<p className="text-xs text-foreground truncate flex-1">
											{conv.title || 'Untitled'}
										</p>
										<span className="text-[10px] text-muted-foreground flex-shrink-0">
											{formatRelativeTime(new Date(conv.updatedAt).getTime())}
										</span>
									</div>
									<div className="flex items-center gap-1.5 mt-0.5 pl-5">
										{conv.agentName && (
											<span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
												<Zap size={8} />
												{conv.agentName}
											</span>
										)}
										<span className="text-[10px] text-muted-foreground">
											{conv.messageCount} msgs
										</span>
									</div>
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
