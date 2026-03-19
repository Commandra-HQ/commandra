import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface ActiveChat {
	conversationId: string;
	agentName: string;
	task: string;
	startedAt: number;
}

interface ActiveChatsContextValue {
	activeChats: Map<string, ActiveChat>;
	markActive: (conversationId: string, agentName: string, task: string) => void;
	markDone: (conversationId: string) => void;
}

const ActiveChatsContext = createContext<ActiveChatsContextValue>({
	activeChats: new Map(),
	markActive: () => {},
	markDone: () => {},
});

export function ActiveChatsProvider({ children }: { children: React.ReactNode }) {
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

	const markActive = useCallback(
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

	const markDone = useCallback((conversationId: string) => {
		setActiveChats((prev) => {
			const next = new Map(prev);
			next.delete(conversationId);
			return next;
		});
	}, []);

	return (
		<ActiveChatsContext.Provider value={{ activeChats, markActive, markDone }}>
			{children}
		</ActiveChatsContext.Provider>
	);
}

export function useActiveChats() {
	return useContext(ActiveChatsContext);
}
