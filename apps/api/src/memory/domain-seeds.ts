/**
 * Pre-seeded domain knowledge for popular web applications.
 *
 * These seeds provide BEHAVIORAL understanding — how apps work, what patterns
 * to expect, and common pitfalls. They do NOT contain hardcoded selectors.
 * The agent discovers selectors from the live page index.
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
		elementNotes: [],
		workflows: [
			{
				name: 'Send an email',
				steps: [
					'Click the Compose button (look for a button with "Compose" label in the sidebar area)',
					'IMPORTANT: Compose opens as a floating modal at the bottom-right, not a new page. After clicking Compose, ALWAYS call refresh_page_state to see the new compose modal elements.',
					'Find the To/recipients field in the compose modal — it is typically a combobox or input. Type the full email address, then press Tab or Enter to confirm the recipient.',
					'Find and type the Subject in the subject field.',
					'Find the Message Body area — it is a contenteditable div (rich text editor), NOT a regular input. The type_text tool handles contenteditable elements.',
					'Click the Send button (requires user approval).',
				],
			},
			{
				name: 'Search emails',
				steps: ['Click the search bar at the top of the page', 'Type search query', 'Press Enter or click the search icon'],
			},
			{
				name: 'Reply to email',
				steps: ['Open the email by clicking on it in the list', 'Click the Reply button', 'Type your reply in the reply text area (contenteditable)', 'Click Send'],
			},
		],
		appNotes: [
			'Gmail is a SPA — always use refresh_page_state after navigation or clicking buttons that open modals',
			'Compose opens as a floating modal at bottom-right, NOT a separate page — you MUST refresh_page_state to see compose fields',
			'The email body, reply areas, and compose body are contenteditable divs, not regular inputs. The type_text tool handles these.',
			'The To/recipients field is a combobox — type the email and press Tab to confirm',
			'Email list items are clickable — click to open an email',
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
		elementNotes: [],
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
				steps: ['Click Messaging in nav bar', 'Click "New message" or select existing conversation', 'Type message in the message input (contenteditable)', 'Click Send or press Enter'],
			},
			{
				name: 'Search for people',
				steps: ['Click search bar at top', 'Type name or keywords', 'Press Enter', 'Filter by People tab'],
			},
		],
		appNotes: [
			'LinkedIn is a SPA — refresh_page_state after navigation',
			'Message compose has a floating panel at bottom-right — refresh_page_state after opening it',
			'Most text inputs in messaging are contenteditable divs, not regular inputs',
		],
	},

	'app.slack.com': {
		knownPages: [
			{ path: '/client/:workspace', description: 'Slack workspace main view', howToReach: 'Navigate to app.slack.com' },
		],
		elementNotes: [],
		workflows: [
			{
				name: 'Send a message in a channel',
				steps: ['Click channel name in sidebar', 'Click message input at bottom (contenteditable rich text editor)', 'Type message', 'Press Enter or click Send'],
			},
			{
				name: 'Search messages',
				steps: ['Press Cmd+K or click search bar', 'Type search query', 'Press Enter'],
			},
		],
		appNotes: [
			'Slack is a SPA — always use refresh_page_state after switching channels',
			'Sidebar shows channels and DMs — click to navigate',
			'The message input is a contenteditable rich text editor, not a regular input',
			'Messages are sent by pressing Enter (Shift+Enter for newline)',
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
			'Issue creation opens as a modal — refresh_page_state after clicking New Issue',
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
				steps: ['Click "+" in sidebar or press Cmd+N', 'Type page title', 'Start typing content (contenteditable blocks)'],
			},
			{
				name: 'Search pages',
				steps: ['Press Cmd+P or click "Search" in sidebar', 'Type search query', 'Click on result to navigate'],
			},
		],
		appNotes: [
			'Notion is a SPA with block-based contenteditable editor',
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
				steps: [
					'Click "New mail" button',
					'Compose opens as a panel — refresh_page_state to see compose fields',
					'Type recipient in To field',
					'Type subject',
					'Type message body (contenteditable)',
					'Click Send',
				],
			},
		],
		appNotes: [
			'Outlook is a SPA — use refresh_page_state after navigation and after opening compose',
			'Compose opens as a panel — refresh_page_state to see the new fields',
			'Email body is a contenteditable rich text editor',
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
			'Cards open as modals when clicked — refresh_page_state after opening a card to see its fields',
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
