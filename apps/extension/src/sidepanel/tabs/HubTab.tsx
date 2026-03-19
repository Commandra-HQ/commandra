import { Clock, ListChecks, Loader2, MessageSquare, Plus, Zap } from 'lucide-react';
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

	// Sort: running conversations first, then by updatedAt
	const sorted = [...conversations].sort((a, b) => {
		const aRunning = activeChats.has(a.id);
		const bRunning = activeChats.has(b.id);
		if (aRunning && !bRunning) return -1;
		if (!aRunning && bRunning) return 1;
		return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
	});

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

			{/* Conversation list — scrollable, running ones float to top */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{loading && (
					<div className="flex items-center justify-center py-8">
						<Loader2 size={16} className="animate-spin text-muted-foreground" />
					</div>
				)}

				{!loading && sorted.length === 0 && (
					<div className="px-3 py-8 text-center">
						<p className="text-xs text-muted-foreground">No conversations yet.</p>
						<p className="text-[10px] text-muted-foreground mt-1">
							Start a new chat to get going.
						</p>
					</div>
				)}

				{sorted.map((conv) => {
					const active = activeChats.get(conv.id);
					const isRunning = !!active;

					return (
						<button
							key={conv.id}
							onClick={() => openConversation(conv.id)}
							className={`w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors flex items-center gap-2 ${
								isRunning ? 'bg-green-500/5' : ''
							}`}
						>
							{/* Status icon */}
							<div className="relative flex-shrink-0">
								{isRunning ? (
									<>
										<Loader2 size={12} className="text-green-500 animate-spin" />
									</>
								) : (
									<MessageSquare size={12} className="text-muted-foreground" />
								)}
							</div>

							{/* Content */}
							<div className="flex-1 min-w-0">
								<p className={`text-xs truncate ${isRunning ? 'font-medium text-foreground' : 'text-foreground'}`}>
									{conv.title || 'Untitled'}
								</p>
								<div className="flex items-center gap-1.5 mt-0.5">
									{isRunning && (
										<span className="text-[10px] text-green-500 font-medium">
											Running
										</span>
									)}
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
									{!isRunning && (
										<>
											<span className="text-[10px] text-muted-foreground">
												{conv.messageCount} msgs
											</span>
											<span className="text-[10px] text-muted-foreground">
												{formatRelativeTime(new Date(conv.updatedAt).getTime())}
											</span>
										</>
									)}
								</div>
							</div>

							{/* Elapsed time for running chats */}
							{isRunning && active && (
								<span className="text-[10px] text-green-500 tabular-nums flex-shrink-0">
									{formatElapsed(active.startedAt)}
								</span>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
