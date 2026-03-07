// Service worker — opens side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
	console.log('Agents for Everyone extension installed');
});
