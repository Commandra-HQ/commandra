import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Conversation {
	id: string;
	title: string;
	outcome: string | null;
	agentId: string | null;
	agentName: string | null;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	toolData?: { tools: { name: string; args: unknown; result: unknown; success: boolean }[] } | null;
	createdAt: string;
}

export function useConversationsQuery(params: { limit?: number; offset?: number } = {}) {
	const { limit = 25, offset = 0 } = params;
	return useQuery({
		queryKey: ['conversations', { limit, offset }],
		queryFn: async () => {
			const res = await apiFetch(`/api/conversations?limit=${limit}&offset=${offset}`);
			if (!res.ok) throw new Error('Failed to fetch conversations');
			return res.json() as Promise<{ conversations: Conversation[]; total: number }>;
		},
	});
}

export function useConversationQuery(id: string | null) {
	return useQuery({
		queryKey: ['conversation', id],
		queryFn: async () => {
			const res = await apiFetch(`/api/conversations/${id}`);
			if (!res.ok) throw new Error('Failed to fetch conversation');
			return res.json() as Promise<{ conversation: Conversation; messages: Message[]; plan: unknown }>;
		},
		enabled: !!id,
	});
}
