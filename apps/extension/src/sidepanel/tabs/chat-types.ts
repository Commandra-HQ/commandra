/**
 * Types, constants, and formatters for the chat interface.
 */

import type { SelectedElement } from '@commandra/shared';
import {
	ArrowRight,
	Camera,
	Clock,
	Eye,
	FileDown,
	Keyboard,
	List,
	MousePointer,
	MoveVertical,
	Pilcrow,
	Table2,
} from 'lucide-react';
import type { SSEEvent } from '@commandra/shared';

// --- Types ---

export interface StoredSite {
	domain: string;
	totalPages: number;
	totalElements: number;
	lastIndexedAt: number;
	crawlStatus: 'idle' | 'crawling' | 'complete' | 'stopped';
}

export interface StoredPage {
	domain: string;
	url: string;
	urlPattern: string;
	title: string;
	pageType: string;
	elements: {
		id: string;
		type: string;
		label: string;
		selector: string;
		fallbackSelectors: string[];
		attributes: Record<string, string>;
		visible: boolean;
		pageUrl: string;
	}[];
	navigationLinks: { label: string; href: string }[];
	indexedAt: number;
}

export type ViewMode = 'onboarding' | 'indexing' | 'crawling' | 'chat';

export interface Plan {
	steps: string[];
	description?: string;
	stepStatus?: ('pending' | 'running' | 'done' | 'error')[];
}

export type MessageBlock =
	| { type: 'thinking'; content: string }
	| { type: 'text'; content: string }
	| {
			type: 'tool_call';
			toolName: string;
			label?: string;
			args?: Record<string, unknown>;
			status: 'running' | 'success' | 'error';
			error?: string;
			result?: unknown;
			screenshot?: string;
	  }
	| { type: 'blocked'; toolName: string; reason: string }
	| { type: 'plan'; plan: Plan }
	| {
			type: 'sub_agent';
			agentId: string;
			task: string;
			targetUrl: string;
			status: 'running' | 'success' | 'error';
			actions: {
				toolName: string;
				label: string;
				status: 'running' | 'success' | 'error';
				args?: Record<string, unknown>;
				result?: unknown;
				error?: string;
				screenshot?: string;
			}[];
			summary?: string;
	  };

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	selectedElements?: SelectedElement[];
	blocks?: MessageBlock[];
}

export interface ApprovalRequest {
	requestId: string;
	action: string;
	selector?: string;
	label?: string;
	reason: string;
}

export interface PlanApprovalRequest {
	requestId: string;
	planId: string;
	description: string;
	steps: string[];
}

export interface SiteData {
	site: StoredSite | null;
	pages: StoredPage[];
}

// --- Constants ---

export const TOOL_LABELS: Record<string, string> = {
	click_element: 'Clicking',
	type_text: 'Typing',
	select_option: 'Selecting',
	navigate: 'Navigating',
	get_page_state: 'Reading page',
	screenshot: 'Taking screenshot',
	scroll: 'Scrolling',
	wait_for_element: 'Waiting for element',
	read_text: 'Reading text',
	read_table: 'Reading table',
	export_data: 'Exporting data',
	list_tabs: 'Listing tabs',
	switch_tab: 'Switching tab',
};

export const TOOL_ICON_COMPONENTS: Record<
	string,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	click_element: MousePointer,
	type_text: Keyboard,
	select_option: List,
	navigate: ArrowRight,
	get_page_state: Eye,
	screenshot: Camera,
	scroll: MoveVertical,
	wait_for_element: Clock,
	read_text: Pilcrow,
	read_table: Table2,
	export_data: FileDown,
};

// --- Formatters ---

export function formatToolLabel(toolName: string, label?: string): string {
	const verb = TOOL_LABELS[toolName] || toolName;
	return label ? `${verb}: ${label}` : verb;
}

export function formatToolArgs(toolName: string, args?: Record<string, unknown>): string | null {
	if (!args) return null;
	if (toolName === 'navigate' && args.url) return String(args.url);
	if (toolName === 'click_element' && args.selector) return String(args.selector);
	if (toolName === 'type_text' && args.text) return `"${String(args.text).slice(0, 60)}"`;
	if (toolName === 'select_option' && args.value) return String(args.value);
	return null;
}

export function parseSSEBuffer(buffer: string): [SSEEvent[], string] {
	const events: SSEEvent[] = [];
	const frames = buffer.split('\n\n');
	const remaining = frames.pop()!;

	for (const frame of frames) {
		for (const line of frame.split('\n')) {
			if (line.startsWith('data: ')) {
				try {
					events.push(JSON.parse(line.slice(6)) as SSEEvent);
				} catch {
					// Malformed JSON, skip
				}
			}
		}
	}

	return [events, remaining];
}

export function formatRelativeTime(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return 'just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return new Date(timestamp).toLocaleDateString();
}

export const API_URL = process.env.API_URL || 'http://localhost:3001';
