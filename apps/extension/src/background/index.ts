// Open side panel when extension icon is clicked
chrome.sidePanel
	.setPanelBehavior({ openPanelOnActionClick: true })
	.catch((err: unknown) => console.error('Failed to set panel behavior:', err));

// Also handle via action click as fallback
chrome.action.onClicked.addListener(async (tab) => {
	if (tab.id) {
		await chrome.sidePanel.open({ tabId: tab.id });
	}
});

chrome.runtime.onInstalled.addListener(() => {
	console.log('Agents for Everyone extension installed');
});
