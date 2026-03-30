/**
 * Passive tab registry — tracks all open browser tabs via Chrome events.
 * Zero token cost. The agent queries this on-demand via list_tabs tool.
 * The sidepanel reads this for the @mention picker and context display.
 */

export interface TrackedTab {
	tabId: number;
	title: string;
	url: string;
	domain: string;
	active: boolean;
	lastActivated: number;
}

const tabs = new Map<number, TrackedTab>();

function extractDomain(url: string): string {
	try { return new URL(url).hostname; } catch { return ''; }
}

function isTrackable(url?: string): boolean {
	if (!url) return false;
	return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && !url.startsWith('about:');
}

/** Initialize registry with all existing tabs. */
export async function initTabRegistry(): Promise<void> {
	const allTabs = await chrome.tabs.query({});
	for (const tab of allTabs) {
		if (tab.id && isTrackable(tab.url)) {
			tabs.set(tab.id, {
				tabId: tab.id,
				title: tab.title || '',
				url: tab.url || '',
				domain: extractDomain(tab.url || ''),
				active: tab.active || false,
				lastActivated: tab.active ? Date.now() : 0,
			});
		}
	}
	console.log(`[TabRegistry] Initialized with ${tabs.size} tabs`);
}

/** Start listening to Chrome tab events. Call once at extension startup. */
export function startTabEventListeners(): void {
	chrome.tabs.onCreated.addListener((tab) => {
		if (tab.id && isTrackable(tab.url || tab.pendingUrl)) {
			tabs.set(tab.id, {
				tabId: tab.id,
				title: tab.title || '',
				url: tab.url || tab.pendingUrl || '',
				domain: extractDomain(tab.url || tab.pendingUrl || ''),
				active: tab.active || false,
				lastActivated: tab.active ? Date.now() : 0,
			});
			broadcastTabUpdate();
		}
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		tabs.delete(tabId);
		broadcastTabUpdate();
	});

	chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		const existing = tabs.get(tabId);
		if (!existing && !isTrackable(tab.url)) return;

		if (isTrackable(tab.url)) {
			tabs.set(tabId, {
				tabId,
				title: changeInfo.title ?? existing?.title ?? tab.title ?? '',
				url: changeInfo.url ?? existing?.url ?? tab.url ?? '',
				domain: extractDomain(changeInfo.url ?? existing?.url ?? tab.url ?? ''),
				active: tab.active ?? existing?.active ?? false,
				lastActivated: existing?.lastActivated ?? 0,
			});
		} else {
			tabs.delete(tabId);
		}
	});

	chrome.tabs.onActivated.addListener(({ tabId }) => {
		// Mark previous active tab as inactive
		for (const [id, t] of tabs) {
			if (t.active) tabs.set(id, { ...t, active: false });
		}
		const existing = tabs.get(tabId);
		if (existing) {
			tabs.set(tabId, { ...existing, active: true, lastActivated: Date.now() });
		}
		broadcastTabUpdate();
	});
}

/** Get all tracked tabs (sorted: active first, then by last activated). */
export function getTrackedTabs(): TrackedTab[] {
	return [...tabs.values()]
		.sort((a, b) => {
			if (a.active && !b.active) return -1;
			if (!a.active && b.active) return 1;
			return b.lastActivated - a.lastActivated;
		});
}

/** Get a count summary for the system prompt (zero tokens for detail). */
export function getTabSummary(): { count: number; activeTab: TrackedTab | undefined } {
	const all = getTrackedTabs();
	return { count: all.length, activeTab: all.find((t) => t.active) };
}

/** Broadcast tab list update to sidepanel (lightweight). */
function broadcastTabUpdate(): void {
	chrome.runtime.sendMessage({
		type: 'TAB_REGISTRY_UPDATE',
		tabs: getTrackedTabs(),
	}).catch(() => {});
}
