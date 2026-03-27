/**
 * Thin React hook for conversation streaming — delegates to the Zustand store.
 *
 * No shared refs. All state is per-conversation in the store.
 * This hook just provides convenience methods scoped to the current conversation.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveChats } from '../contexts/active-chats.js';
import {
	sendMessageToConv,
	subscribeToConvRun,
	useConversationStore,
} from '../stores/conversation-store.js';

export function useConversationStream(convId: string | undefined) {
	const navigate = useNavigate();
	const { markActive, markDone } = useActiveChats();
	const store = useConversationStore();

	// Read this conversation's state from the store (reactive — re-renders on change)
	const conv = convId ? store.conversations.get(convId) : undefined;

	const sendMessage = useCallback(
		async (text: string, extraBody: Record<string, unknown>) => {
			await sendMessageToConv(convId, text, extraBody, navigate, markActive, markDone);
		},
		[convId, navigate, markActive, markDone],
	);

	const subscribeToRun = useCallback(
		async (targetConvId: string) => {
			await subscribeToConvRun(targetConvId, navigate, markActive, markDone);
		},
		[navigate, markActive, markDone],
	);

	const handleStop = useCallback(() => {
		if (convId) {
			store.stopStream(convId);
		}
		try {
			chrome.action.setBadgeText({ text: '' });
		} catch {}
	}, [convId, store]);

	const handleNewConversation = useCallback(() => {
		// Stop the current stream (doesn't kill the server-side run)
		if (convId) {
			const c = store.conversations.get(convId);
			if (c?.sseController) c.sseController.abort();
			store.updateConv(convId, { sseController: null, isActive: false });
		}
		store.setActiveConv(null);
		navigate('/chat', { replace: true });
	}, [convId, store, navigate]);

	return {
		// State (from store, reactive)
		messages: conv?.messages ?? [],
		isActive: conv?.isActive ?? false,
		contextStatus: conv?.contextStatus ?? null,
		usageTotal: conv?.usageTotal ?? null,
		planState: conv?.planState ?? null,
		showPlanPanel: conv?.showPlanPanel ?? false,
		pendingApprovals: conv?.pendingApprovals ?? [],

		// Actions
		sendMessage,
		subscribeToRun,
		handleStop,
		handleNewConversation,

		// Store-level actions
		setMessages: (msgs: Parameters<typeof store.setMessages>[1]) =>
			convId && store.setMessages(convId, msgs),
		setShowPlanPanel: (v: boolean) =>
			convId && store.updateConv(convId, { showPlanPanel: v }),
		setPlanState: (v: Parameters<typeof store.updateConv>[1]['planState']) =>
			convId && store.updateConv(convId, { planState: v ?? null }),
		setContextStatus: (v: Parameters<typeof store.updateConv>[1]['contextStatus']) =>
			convId && store.updateConv(convId, { contextStatus: v ?? null }),
		setUsageTotal: (v: Parameters<typeof store.updateConv>[1]['usageTotal']) =>
			convId && store.updateConv(convId, { usageTotal: v ?? null }),
	};
}
