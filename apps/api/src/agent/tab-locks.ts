/**
 * Tab Lock Registry — prevents multiple conversations from using the same browser tab.
 *
 * When a conversation starts, it claims a tab. If the tab is already claimed by another
 * conversation, the new conversation must open a new tab. Locks are released when the
 * conversation ends or the orchestrator run completes.
 */

// tabId → conversationId
const tabLocks = new Map<number, string>();

// conversationId → tabId (reverse lookup for cleanup)
const convTabs = new Map<string, number>();

/** Try to lock a tab for a conversation. Returns true if lock acquired. */
export function lockTab(tabId: number, conversationId: string): boolean {
	const owner = tabLocks.get(tabId);

	// Already owned by this conversation
	if (owner === conversationId) return true;

	// Owned by another conversation
	if (owner) return false;

	// Acquire lock
	tabLocks.set(tabId, conversationId);
	convTabs.set(conversationId, tabId);
	console.log(`[TabLock] Tab ${tabId} locked by conv ${conversationId}`);
	return true;
}

/** Release a tab lock by conversation ID. */
export function unlockByConversation(conversationId: string): void {
	const tabId = convTabs.get(conversationId);
	if (tabId !== undefined) {
		tabLocks.delete(tabId);
		convTabs.delete(conversationId);
		console.log(`[TabLock] Tab ${tabId} unlocked (conv ${conversationId} ended)`);
	}
}

/** Release a tab lock by tab ID. */
export function unlockTab(tabId: number): void {
	const convId = tabLocks.get(tabId);
	if (convId) {
		tabLocks.delete(tabId);
		convTabs.delete(convId);
		console.log(`[TabLock] Tab ${tabId} unlocked`);
	}
}

/** Check if a tab is locked by another conversation. */
export function isTabLocked(tabId: number, conversationId: string): boolean {
	const owner = tabLocks.get(tabId);
	return !!owner && owner !== conversationId;
}

/** Get the tab ID locked by a conversation, if any. */
export function getLockedTab(conversationId: string): number | undefined {
	return convTabs.get(conversationId);
}

/** Get all active tab locks (for debugging/dashboard). */
export function getAllLocks(): Map<number, string> {
	return new Map(tabLocks);
}
