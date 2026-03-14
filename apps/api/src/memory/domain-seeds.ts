/**
 * Pre-seeded domain knowledge for popular web applications.
 *
 * When a domain has no memory yet, these seeds give the agent
 * a baseline understanding of how the app works so it can navigate
 * without needing to "learn" through failed attempts first.
 */

import type { DomainKnowledge } from './domain.js';

const DOMAIN_SEEDS: Record<string, DomainKnowledge> = {
	'mail.google.com': {
		knownPages: [
			{ path: '/mail/u/0/#inbox', description: 'Gmail inbox — main email view', howToReach: 'Click "Inbox" in sidebar or navigate to mail.google.com' },
			{ path: '/mail/u/0/#sent', description: 'Sent emails', howToReach: 'Click "Sent" in sidebar' },
			{ path: '/mail/u/0/#drafts', description: 'Draft emails', howToReach: 'Click "Drafts" in sidebar' },
			{ path: '/mail/u/0/#search', description: 'Email search results', howToReach: 'Type in the search bar at top' },
		],
		elementNotes: [
			{ selector: '[gh="cm"]', note: 'Compose button — opens a compose modal/window at bottom-right, not a new page' },
			{ selector: '[name="to"]', note: 'To field in compose — supports autocomplete, type email and press Tab/Enter' },
			{ selector: '[name="subjectbox"]', note: 'Subject field in compose window' },
			{ selector: '[role="textbox"][aria-label*="Body"]', note: 'Email body — rich text editor, contenteditable div' },
			{ selector: '[aria-label*="Send"]', note: 'Send button in compose window — look for aria-label containing "Send"' },
		],
		workflows: [
			{
				name: 'Send an email',
				steps: [
					'Click Compose button',
					'Wait for compose window to appear (it\'s a modal, not a new page)',
					'Type recipient email in To field',
					'Tab or click to Subject field, type subject',
					'Click in body area, type message',
					'Click Send button',
				],
			},
			{
				name: 'Search emails',
				steps: ['Click search bar at top', 'Type search query', 'Press Enter or click search icon'],
			},
			{
				name: 'Reply to email',
				steps: ['Open the email by clicking on it', 'Click Reply button', 'Type reply in the text area', 'Click Send'],
			},
		],
		appNotes: [
			'Gmail is a SPA — use refresh_page_state after navigation actions',
			'Compose opens as a floating modal at bottom-right, not a separate page',
			'Email list items are clickable table rows — click to open email',
			'User profile/avatar is in top-right corner',
			'Multiple Google accounts may be signed in — check the URL for /u/0/ or /u/1/',
		],
	},

	'github.com': {
		knownPages: [
			{ path: '/', description: 'GitHub home feed / dashboard', howToReach: 'Click the GitHub logo or navigate to github.com' },
			{ path: '/:owner/:repo', description: 'Repository main page with file browser', howToReach: 'Navigate to github.com/owner/repo or search' },
			{ path: '/:owner/:repo/issues', description: 'Repository issues list', howToReach: 'Click "Issues" tab on repo page' },
			{ path: '/:owner/:repo/pulls', description: 'Repository pull requests', howToReach: 'Click "Pull requests" tab on repo page' },
			{ path: '/:owner/:repo/actions', description: 'CI/CD actions and workflow runs', howToReach: 'Click "Actions" tab on repo page' },
			{ path: '/settings/profile', description: 'User profile settings', howToReach: 'Click avatar → Settings' },
			{ path: '/notifications', description: 'Notification center', howToReach: 'Click bell icon in top-right' },
		],
		elementNotes: [
			{ selector: '[data-testid="header-search-input"]', note: 'GitHub global search bar' },
			{ selector: '.AppHeader-user', note: 'User avatar/menu in top-right — shows current logged-in user' },
			{ selector: '[data-tab-item="i-code-tab"]', note: 'Code tab on repo page' },
			{ selector: '[data-tab-item="i-issues-tab"]', note: 'Issues tab on repo page' },
			{ selector: '[data-tab-item="i-pull-requests-tab"]', note: 'Pull requests tab on repo page' },
		],
		workflows: [
			{
				name: 'Navigate to a repository',
				steps: ['Use the search bar or navigate directly to github.com/owner/repo'],
			},
			{
				name: 'Create an issue',
				steps: ['Go to repo Issues tab', 'Click "New issue" button', 'Fill in title and body', 'Click "Submit new issue"'],
			},
			{
				name: 'Browse repository files',
				steps: ['Go to repo Code tab', 'Click on folder/file names to navigate', 'Use breadcrumb to go back up'],
			},
		],
		appNotes: [
			'GitHub uses Turbo/pjax for navigation — use refresh_page_state after clicking links',
			'The logged-in user\'s avatar is in the top-right header — check this to know who is authenticated',
			'Repository tabs (Code, Issues, PRs, Actions, etc.) are the primary navigation within a repo',
			'File tree can be browsed by clicking — each click updates the URL',
			'Search supports qualifiers: repo:owner/name, is:issue, is:pr, author:username',
		],
	},

	'www.linkedin.com': {
		knownPages: [
			{ path: '/feed/', description: 'LinkedIn main feed', howToReach: 'Click Home icon or navigate to linkedin.com' },
			{ path: '/messaging/', description: 'Messages/chat', howToReach: 'Click Messaging icon in nav bar' },
			{ path: '/mynetwork/', description: 'Network connections and invitations', howToReach: 'Click "My Network" in nav' },
			{ path: '/jobs/', description: 'Job search and listings', howToReach: 'Click "Jobs" in nav' },
			{ path: '/in/:username', description: 'User profile page', howToReach: 'Click on a person\'s name or navigate to linkedin.com/in/username' },
		],
		elementNotes: [],
		workflows: [
			{
				name: 'Send a message',
				steps: ['Click Messaging in nav bar', 'Click "New message" or select existing conversation', 'Type message in text area', 'Click Send'],
			},
			{
				name: 'Search for people',
				steps: ['Click search bar at top', 'Type name or keywords', 'Press Enter', 'Filter by People tab'],
			},
		],
		appNotes: [
			'LinkedIn is a SPA — refresh_page_state after navigation',
			'Profile avatar in top nav shows current logged-in user',
			'Message compose has a floating panel at bottom-right',
		],
	},

	'app.slack.com': {
		knownPages: [
			{ path: '/client/:workspace', description: 'Slack workspace main view', howToReach: 'Navigate to app.slack.com' },
		],
		elementNotes: [
			{ selector: '[data-qa="message_input"]', note: 'Message input field — rich text editor' },
			{ selector: '[data-qa="channel_sidebar_name"]', note: 'Channel names in sidebar — click to switch channels' },
		],
		workflows: [
			{
				name: 'Send a message in a channel',
				steps: ['Click channel name in sidebar', 'Click message input at bottom', 'Type message', 'Press Enter or click Send'],
			},
			{
				name: 'Search messages',
				steps: ['Press Cmd+K or click search bar', 'Type search query', 'Press Enter'],
			},
		],
		appNotes: [
			'Slack is a SPA — always use refresh_page_state after switching channels',
			'Sidebar shows channels and DMs — click to navigate',
			'Messages are sent by pressing Enter (Shift+Enter for newline)',
			'Workspace name and user avatar are in the top-left area',
		],
	},

	'linear.app': {
		knownPages: [
			{ path: '/:team/inbox', description: 'Team inbox', howToReach: 'Click Inbox in sidebar' },
			{ path: '/:team/issues', description: 'Issues list', howToReach: 'Click Issues or team name in sidebar' },
			{ path: '/:team/projects', description: 'Projects list', howToReach: 'Click Projects in sidebar' },
		],
		elementNotes: [],
		workflows: [
			{
				name: 'Create an issue',
				steps: ['Press C or click "New Issue" button', 'Fill in title', 'Optionally add description, assignee, labels', 'Press Cmd+Enter or click Create'],
			},
		],
		appNotes: [
			'Linear is keyboard-first — C creates issue, J/K navigates list',
			'SPA — use refresh_page_state after navigation',
			'Sidebar has team/project navigation',
		],
	},

	'notion.so': {
		knownPages: [
			{ path: '/', description: 'Notion workspace home', howToReach: 'Click workspace name or navigate to notion.so' },
		],
		elementNotes: [],
		workflows: [
			{
				name: 'Create a new page',
				steps: ['Click "+" in sidebar or press Cmd+N', 'Type page title', 'Start typing content'],
			},
			{
				name: 'Search pages',
				steps: ['Press Cmd+P or click "Search" in sidebar', 'Type search query', 'Click on result to navigate'],
			},
		],
		appNotes: [
			'Notion is a SPA with block-based editor',
			'Sidebar shows page hierarchy — click to navigate',
			'Use / command to insert blocks (table, heading, toggle, etc.)',
			'Pages are contenteditable — click to start editing',
		],
	},

	'outlook.live.com': {
		knownPages: [
			{ path: '/mail/0/inbox', description: 'Outlook inbox', howToReach: 'Click Inbox in sidebar' },
			{ path: '/mail/0/sentitems', description: 'Sent items', howToReach: 'Click Sent Items in sidebar' },
		],
		elementNotes: [],
		workflows: [
			{
				name: 'Send an email',
				steps: ['Click "New mail" button', 'Type recipient in To field', 'Type subject', 'Type message body', 'Click Send'],
			},
		],
		appNotes: [
			'Outlook is a SPA — use refresh_page_state after navigation',
			'Compose opens as a panel or new window depending on settings',
			'User account info is in top-right corner',
		],
	},

	'trello.com': {
		knownPages: [
			{ path: '/:user/boards', description: 'User boards list', howToReach: 'Click Boards in header or navigate to trello.com' },
			{ path: '/b/:id/:name', description: 'Board view with lists and cards', howToReach: 'Click a board from the boards list' },
		],
		elementNotes: [],
		workflows: [
			{
				name: 'Add a card',
				steps: ['Navigate to board', 'Click "+ Add a card" at bottom of a list', 'Type card title', 'Click "Add card" or press Enter'],
			},
		],
		appNotes: [
			'Trello boards show lists in columns with cards',
			'Cards open as modals when clicked — not a separate page',
			'Drag and drop is the primary interaction for moving cards between lists',
		],
	},
};

/**
 * Look up pre-seeded domain knowledge for a given domain.
 * Returns null if no seed exists for this domain.
 */
export function getDomainSeed(domain: string): DomainKnowledge | null {
	// Exact match
	if (DOMAIN_SEEDS[domain]) return DOMAIN_SEEDS[domain];

	// Try without www prefix
	const withoutWww = domain.replace(/^www\./, '');
	if (DOMAIN_SEEDS[withoutWww]) return DOMAIN_SEEDS[withoutWww];

	// Try with www prefix
	const withWww = `www.${domain}`;
	if (DOMAIN_SEEDS[withWww]) return DOMAIN_SEEDS[withWww];

	return null;
}
