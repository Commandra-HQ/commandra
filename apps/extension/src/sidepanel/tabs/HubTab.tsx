import { Clock, Loader2, MessageSquare, Plus, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActiveChat } from '../App.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface ConversationSummary {
	id: string;
	title: string;
	messageCount: number;
	updatedAt: string;
	agentId?: string | null;
	agentName?: string | null;
}

interface HubTabProps {
	activeChats: Map<string, ActiveChat>;
	onOpenConversation: (convId: string | null) => void;
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

export function HubTab({ activeChats, onOpenConversation }: HubTabProps) {
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [currentDomain, setCurrentDomain] = useState('');
	const [currentTitle, setCurrentTitle] = useState('');

	// Update elapsed time for active chats every second
	const [, setTick] = useState(0);
	useEffect(() => {
		if (activeChats.size === 0) return;
		const interval = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(interval);
	}, [activeChats.size]);

	useEffect(() => {
		loadConversations();
		loadCurrentPage();
	}, []);

	async function loadConversations() {
		try {
			setLoading(true);
			const stored = await chrome.storage.local.get('authToken');
			const token = stored.authToken;
			if (!token) return;
			const res = await fetch(`${API_URL}/api/conversations`, {
				headers: { Authorization: `Bearer ${token}` },
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

	function loadCurrentPage() {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (tab?.url) {
				try {
					setCurrentDomain(new URL(tab.url).hostname);
					setCurrentTitle(tab.title || '');
				} catch {}
			}
		});
	}

	const activeList = Array.from(activeChats.values());

	return (
		<div className="flex flex-col h-full">
			{/* Active / Running section */}
			{activeList.length > 0 && (
				<div className="border-b border-border">
					<div className="px-4 pt-3 pb-1">
						<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							Running
						</p>
					</div>
					{activeList.map((chat) => (
						<button
							key={chat.conversationId}
							onClick={() => onOpenConversation(chat.conversationId)}
							className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 transition-colors flex items-start gap-2.5"
						>
							<div className="mt-1 relative flex-shrink-0">
								<Zap size={14} className="text-yellow-500" />
								<span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-green-500 rounded-full animate-pulse" />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-xs font-medium text-foreground truncate">
									{chat.agentName}
								</p>
								<p className="text-[10px] text-muted-foreground truncate mt-0.5">
									{chat.task}
								</p>
							</div>
							<span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">
								{formatElapsed(chat.startedAt)}
							</span>
						</button>
					))}
				</div>
			)}

			{/* Quick Actions */}
			<div className="px-4 py-3 border-b border-border">
				<button
					onClick={() => onOpenConversation(null)}
					className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border hover:bg-secondary/50 transition-colors"
				>
					<Plus size={14} className="text-muted-foreground" />
					<div className="flex-1 text-left">
						<p className="text-xs font-medium text-foreground">New Chat</p>
						{currentDomain && (
							<p className="text-[10px] text-muted-foreground truncate">
								{currentDomain}
								{currentTitle ? ` — ${currentTitle}` : ''}
							</p>
						)}
					</div>
				</button>
			</div>

			{/* Recent Conversations */}
			<div className="flex-1 overflow-y-auto">
				<div className="px-4 pt-3 pb-1">
					<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
						Recent
					</p>
				</div>

				{loading && (
					<div className="flex items-center justify-center py-8">
						<Loader2 size={16} className="animate-spin text-muted-foreground" />
					</div>
				)}

				{!loading && conversations.length === 0 && (
					<div className="px-4 py-8 text-center">
						<p className="text-xs text-muted-foreground">No conversations yet.</p>
						<p className="text-xs text-muted-foreground mt-1">
							Start a new chat to get going.
						</p>
					</div>
				)}

				{conversations.map((conv) => (
					<button
						key={conv.id}
						onClick={() => onOpenConversation(conv.id)}
						className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 transition-colors"
					>
						<div className="flex items-start gap-2.5">
							<MessageSquare
								size={14}
								className="text-muted-foreground mt-0.5 flex-shrink-0"
							/>
							<div className="flex-1 min-w-0">
								<p className="text-xs text-foreground truncate">
									{conv.title || 'Untitled'}
								</p>
								<div className="flex items-center gap-2 mt-0.5">
									{conv.agentName && (
										<span className="inline-flex items-center gap-0.5 text-[10px] text-yellow-500">
											<Zap size={8} />
											{conv.agentName}
										</span>
									)}
									<span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
										<MessageSquare size={8} />
										{conv.messageCount}
									</span>
									<span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
										<Clock size={8} />
										{formatRelativeTime(new Date(conv.updatedAt).getTime())}
									</span>
								</div>
							</div>
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
