import { ListChecks, Loader2, MessageSquare, X, Zap } from 'lucide-react';
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

export function HistoryDrawer({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const { activeChats } = useActiveChats();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [loading, setLoading] = useState(true);

	const [, setTick] = useState(0);
	useEffect(() => {
		if (activeChats.size === 0) return;
		const interval = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(interval);
	}, [activeChats.size]);

	const loadConversations = useCallback(async () => {
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
	}, []);

	useEffect(() => {
		if (open) loadConversations();
	}, [open, loadConversations]);

	function openConversation(convId: string) {
		navigate(`/chat/${convId}`);
		onClose();
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

	running.sort((a, b) => b.active.startedAt - a.active.startedAt);
	completed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

	if (!open) return null;

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40"
				onClick={onClose}
				role="presentation"
			/>

			{/* Drawer */}
			<div className="fixed inset-y-0 left-0 z-50 w-[280px] bg-surface border-r border-border flex flex-col">
				{/* Header */}
				<div className="h-10 px-3 flex items-center justify-between border-b border-border">
					<span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
						History
					</span>
					<button
						onClick={onClose}
						className="p-1 text-muted-foreground hover:text-foreground transition-colors"
					>
						<X size={14} strokeWidth={1.5} />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto">
					{loading && (
						<div className="flex items-center justify-center py-8">
							<span className="status-pixel bg-muted-foreground animate-pulse" />
						</div>
					)}

					{!loading && conversations.length === 0 && (
						<div className="px-4 py-12 text-center">
							<p className="text-xs text-muted-foreground font-mono">No conversations yet</p>
						</div>
					)}

					{/* Running */}
					{running.length > 0 && (
						<div className="px-2 pt-2">
							<p className="flex items-center gap-1.5 px-2 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-success">
								<span className="status-pixel bg-success animate-pulse" />
								Running ({running.length})
							</p>
							<div className="space-y-px">
								{running.map((conv) => (
									<button
										type="button"
										key={conv.id}
										onClick={() => openConversation(conv.id)}
										className="w-full text-left px-3 py-2.5 border border-success/20 bg-success/5 hover:bg-success/10 transition-colors"
									>
										<div className="flex items-center justify-between gap-2">
											<p className="text-xs font-medium text-foreground truncate">
												{conv.title || 'Untitled'}
											</p>
											<span className="text-[10px] text-success font-mono flex-shrink-0">
												{formatElapsed(conv.active.startedAt)}
											</span>
										</div>
										<div className="flex items-center gap-1.5 mt-1">
											{conv.agentName && (
												<span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-warning">
													<Zap size={8} strokeWidth={1.5} />
													{conv.agentName}
												</span>
											)}
											{conv.planStatus && conv.planStatus.status !== 'completed' && (
												<span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-muted-foreground">
													<ListChecks size={8} strokeWidth={1.5} />
													{conv.planStatus.completedSteps}/{conv.planStatus.totalSteps}
												</span>
											)}
										</div>
									</button>
								))}
							</div>
						</div>
					)}

					{/* Completed */}
					{completed.length > 0 && (
						<div className="px-2 pt-2">
							{running.length > 0 && (
								<p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
									Recent
								</p>
							)}
							<div className="space-y-px">
								{completed.map((conv) => (
									<button
										type="button"
										key={conv.id}
										onClick={() => openConversation(conv.id)}
										className="w-full text-left px-3 py-2 hover:bg-elevated transition-colors"
									>
										<div className="flex items-center gap-2">
											<MessageSquare size={11} strokeWidth={1.5} className="text-dim flex-shrink-0" />
											<p className="text-xs text-foreground truncate flex-1">
												{conv.title || 'Untitled'}
											</p>
											<span className="text-[9px] font-mono text-dim flex-shrink-0">
												{formatRelativeTime(new Date(conv.updatedAt).getTime())}
											</span>
										</div>
										<div className="flex items-center gap-1.5 mt-0.5 pl-5">
											{conv.agentName && (
												<span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-dim">
													<Zap size={7} strokeWidth={1.5} />
													{conv.agentName}
												</span>
											)}
											<span className="text-[9px] font-mono text-dim">
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
		</>
	);
}
