'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { useConversationQuery, useConversationsQuery } from '@/lib/queries/use-conversations';
import {
	ArrowLeft,
	ArrowRight,
	Camera,
	Check,
	Clock,
	Copy,
	Eye,
	FileDown,
	Keyboard,
	List,
	MessageSquare,
	MousePointer,
	MoveVertical,
	Pilcrow,
	Settings2,
	Table2,
	X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Tool metadata (mirrors extension) ---

const TOOL_LABELS: Record<string, string> = {
	click_element: 'Clicking',
	type_text: 'Typing',
	select_option: 'Selecting',
	navigate: 'Navigating',
	get_page_state: 'Reading page',
	refresh_page_state: 'Refreshing page',
	screenshot: 'Taking screenshot',
	scroll: 'Scrolling',
	wait_for_element: 'Waiting for element',
	read_text: 'Reading text',
	read_table: 'Reading table',
	export_data: 'Exporting data',
	go_back: 'Going back',
	save_memory: 'Saving memory',
	recall_memory: 'Recalling memory',
	save_knowledge: 'Saving knowledge',
	read_knowledge: 'Reading knowledge',
	list_knowledge: 'Listing knowledge',
	spawn_agent: 'Spawning agent',
	wait_for_agents: 'Waiting for agents',
	create_agent: 'Creating agent',
	write_scratchpad: 'Writing scratchpad',
	read_scratchpad: 'Reading scratchpad',
};

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
	click_element: MousePointer,
	type_text: Keyboard,
	select_option: List,
	navigate: ArrowRight,
	get_page_state: Eye,
	refresh_page_state: Eye,
	screenshot: Camera,
	scroll: MoveVertical,
	wait_for_element: Clock,
	read_text: Pilcrow,
	read_table: Table2,
	export_data: FileDown,
};

interface ToolCall {
	name: string;
	args: unknown;
	result: unknown;
	success: boolean;
}

interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	toolData?: { tools: ToolCall[] } | null;
	createdAt: string;
}

function formatToolLabel(name: string, args?: unknown): string {
	const verb = TOOL_LABELS[name] || name;
	if (!args || typeof args !== 'object') return verb;
	const a = args as Record<string, unknown>;
	if (name === 'navigate' && a.url) return `${verb} → ${String(a.url)}`;
	if (name === 'click_element' && (a.label || a.selector))
		return `${verb}: ${String(a.label || a.selector)}`;
	if (name === 'type_text' && a.text) return `${verb}: "${String(a.text).slice(0, 50)}"`;
	if (name === 'select_option' && a.value) return `${verb}: ${String(a.value)}`;
	return verb;
}

// --- Components ---

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}, [text]);

	return (
		<button
			onClick={handleCopy}
			className="p-1 text-muted-foreground hover:text-foreground transition-colors"
			title="Copy"
		>
			{copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
		</button>
	);
}

function UserBubble({ msg }: { msg: Message }) {
	return (
		<div className="group/msg flex justify-end min-w-0">
			<div className="relative max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words bg-primary text-primary-foreground">
				<div className="absolute -left-8 top-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
					<CopyButton text={msg.content} />
				</div>
				{msg.content}
			</div>
		</div>
	);
}

function ToolCallCard({ tool }: { tool: ToolCall }) {
	const [expanded, setExpanded] = useState(false);
	const Icon = TOOL_ICONS[tool.name] || Settings2;
	const label = formatToolLabel(tool.name, tool.args);

	const statusColor = tool.success
		? 'border-success/30 bg-success/5'
		: 'border-error/30 bg-error/5';

	const statusIcon = tool.success ? (
		<Check size={12} className="text-success shrink-0" />
	) : (
		<X size={12} className="text-error shrink-0" />
	);

	return (
		<div className={`border text-xs min-w-0 overflow-hidden ${statusColor}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left min-w-0"
			>
				<Icon size={13} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 truncate text-foreground font-mono">{label}</span>
				{statusIcon}
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
					{tool.args != null && (
						<div>
							<span className="text-muted-foreground">Args: </span>
							<code className="text-[10px] text-foreground/70 font-mono break-all">
								{JSON.stringify(tool.args, null, 2)}
							</code>
						</div>
					)}
					{tool.result != null && (
						<div>
							<span className="text-muted-foreground">Result: </span>
							<code className="text-[10px] text-foreground/70 font-mono break-all">
								{typeof tool.result === 'string'
									? tool.result.slice(0, 500)
									: JSON.stringify(tool.result).slice(0, 500)}
							</code>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function AssistantBubble({ msg }: { msg: Message }) {
	const hasTools = msg.toolData?.tools && msg.toolData.tools.length > 0;
	const hasContent = msg.content.trim().length > 0;

	if (!hasContent && !hasTools) return null;

	return (
		<div className="group/msg flex justify-start w-full min-w-0">
			<div className="relative w-full lg:w-[90%] space-y-2 min-w-0">
				{hasContent && (
					<>
						<div className="absolute -right-7 top-0 opacity-0 group-hover/msg:opacity-100 transition-opacity hidden lg:block">
							<CopyButton text={msg.content} />
						</div>
						<div className="rounded-lg px-3 py-2 text-sm bg-secondary text-foreground prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-xs overflow-hidden break-words">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
						</div>
					</>
				)}
				{hasTools && (
					<div className="space-y-1 min-w-0">
						{msg.toolData!.tools.map((tool, i) => (
							<ToolCallCard key={i} tool={tool} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// --- Conversation list item ---

const outcomeStyles: Record<string, string> = {
	success: 'bg-success',
	failure: 'bg-error',
	partial: 'bg-warning',
};

function formatRelative(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return 'just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}

// --- Main page ---

export default function HistoryPage() {
	const [offset, setOffset] = useState(0);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const limit = 25;
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const { data: convData, isLoading } = useConversationsQuery({ limit, offset });
	const { data: msgData, isLoading: loadingMessages } = useConversationQuery(selectedId);

	const conversations = convData?.conversations ?? [];
	const total = convData?.total ?? 0;
	const messages = (msgData?.messages ?? []) as Message[];

	useEffect(() => {
		if (messages.length > 0) {
			messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		}
	}, [messages]);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-8">
				<div className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading...</p>
			</div>
		);
	}

	if (conversations.length === 0 && offset === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<MessageSquare size={32} className="mx-auto text-muted-foreground mb-3" />
					<p className="text-sm text-muted-foreground font-mono">
						No conversations yet. Start chatting in the extension.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
			{/* Main content area — grid with constrained height */}
			<div className="grid gap-1 lg:grid-cols-[300px_1fr] flex-1 min-h-0 min-w-0 overflow-hidden">
				{/* Conversation list — hidden on mobile when chat is open */}
				<div className={`border border-border overflow-y-auto min-w-0 ${selectedId ? 'hidden lg:block' : ''}`}>
					{conversations.map((conv) => (
						<button
							key={conv.id}
							onClick={() => setSelectedId(conv.id)}
							className={`w-full text-left p-3 border-b border-border last:border-0 transition-colors ${
								selectedId === conv.id ? 'bg-elevated' : 'hover:bg-elevated/50'
							}`}
						>
							<div className="flex items-center gap-2">
								{conv.outcome && (
									<div
										className={`status-pixel ${outcomeStyles[conv.outcome] || 'bg-muted-foreground'}`}
									/>
								)}
								<p className="text-sm font-mono truncate flex-1">
									{conv.title || 'Untitled'}
								</p>
							</div>
							<div className="flex items-center gap-2 mt-1.5 ml-[10px]">
								<span className="text-[10px] font-mono text-muted-foreground">
									{conv.messageCount} msgs
								</span>
								<span className="text-[10px] font-mono text-muted-foreground">
									{formatRelative(conv.updatedAt)}
								</span>
							</div>
						</button>
					))}
				</div>

				{/* Chat thread — flex column: sticky header + scrollable messages */}
				<div className={`border border-border flex flex-col min-h-0 min-w-0 overflow-hidden ${!selectedId ? 'hidden lg:flex' : ''}`}>
					{selectedId && (
						<div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface flex-shrink-0">
							<button
								onClick={() => setSelectedId(null)}
								className="lg:hidden p-1 text-muted-foreground hover:text-foreground transition-colors"
							>
								<ArrowLeft size={16} />
							</button>
							<span className="text-sm font-mono font-medium truncate">
								{conversations.find((c) => c.id === selectedId)?.title || 'Untitled'}
							</span>
							<span className="text-[10px] font-mono text-muted-foreground ml-auto whitespace-nowrap">
								{conversations.find((c) => c.id === selectedId)?.messageCount} messages
							</span>
						</div>
					)}

					<div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
						{!selectedId ? (
							<div className="flex items-center justify-center h-full">
								<p className="text-sm text-muted-foreground font-mono">
									Select a conversation to view.
								</p>
							</div>
						) : loadingMessages ? (
							<div className="flex items-center justify-center h-full">
								<div className="flex items-center gap-2">
									<div className="status-pixel bg-muted-foreground animate-pulse" />
									<p className="text-sm font-mono text-muted-foreground">Loading...</p>
								</div>
							</div>
						) : messages.length === 0 ? (
							<div className="flex items-center justify-center h-full">
								<p className="text-sm text-muted-foreground font-mono">No messages found.</p>
							</div>
						) : (
							<>
								{messages.map((msg) =>
									msg.role === 'user' ? (
										<UserBubble key={msg.id} msg={msg} />
									) : (
										<AssistantBubble key={msg.id} msg={msg} />
									),
								)}
								<div ref={messagesEndRef} />
							</>
						)}
					</div>
				</div>
			</div>

			{/* Pagination — sticky at bottom, full width */}
			<div className="flex-shrink-0 border border-border border-t-0 px-3 py-2 bg-surface">
				<Pagination offset={offset} limit={limit} total={total} onPageChange={setOffset} />
			</div>
		</div>
	);
}
