'use client';

import { MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Conversation {
	id: string;
	title: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: string;
}

export default function HistoryPage() {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchConversations();
	}, []);

	async function fetchConversations() {
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/conversations`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setConversations(data.conversations || []);
			}
		} catch (err) {
			console.error('Failed to fetch conversations:', err);
		} finally {
			setLoading(false);
		}
	}

	async function fetchMessages(convId: string) {
		setSelectedId(convId);
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/conversations/${convId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setMessages(data.messages || []);
			}
		} catch (err) {
			console.error('Failed to fetch messages:', err);
		}
	}

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">History</h1>
				<p className="text-muted-foreground">Loading conversations...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">History</h1>
				<p className="text-muted-foreground mt-1">Browse past conversations with your agent.</p>
			</div>

			{conversations.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<MessageSquare size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">No conversations yet. Start chatting in the extension.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 lg:grid-cols-[320px_1fr]">
					{/* Conversation list */}
					<div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
						{conversations.map((conv) => (
							<button
								key={conv.id}
								onClick={() => fetchMessages(conv.id)}
								className={`w-full text-left p-3 rounded-lg border transition-colors ${
									selectedId === conv.id
										? 'border-primary bg-primary/5'
										: 'border-border hover:bg-muted/50'
								}`}
							>
								<p className="text-sm font-medium truncate">{conv.title || 'Untitled'}</p>
								<div className="flex items-center gap-2 mt-1">
									<Badge variant="secondary" className="text-[10px]">
										{conv.messageCount} msgs
									</Badge>
									<span className="text-[10px] text-muted-foreground">
										{formatRelative(conv.updatedAt)}
									</span>
								</div>
							</button>
						))}
					</div>

					{/* Message thread */}
					<Card className="max-h-[calc(100vh-200px)] overflow-y-auto">
						<CardContent className="p-4 space-y-3">
							{!selectedId ? (
								<p className="text-sm text-muted-foreground text-center py-12">
									Select a conversation to view messages.
								</p>
							) : messages.length === 0 ? (
								<p className="text-sm text-muted-foreground text-center py-12">No messages found.</p>
							) : (
								messages.map((msg) => (
									<div
										key={msg.id}
										className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
									>
										<div
											className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
												msg.role === 'user'
													? 'bg-primary text-primary-foreground'
													: 'bg-muted'
											}`}
										>
											{msg.content}
										</div>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	);
}

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

async function getToken(): Promise<string> {
	const res = await fetch('/api/extension/token');
	const data = await res.json();
	return data.token;
}
