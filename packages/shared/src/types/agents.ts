/**
 * Agent types for the agent marketplace system.
 */

export interface Agent {
	id: string;
	userId: string;
	orgId?: string;
	name: string;
	slug: string;
	description: string;
	instructions: string;
	domains: string[];
	tools: string[];
	safetyRules: { allowWrite?: boolean; allowDelete?: boolean };
	icon: string;
	category: AgentCategory;
	tags: string[];
	isPublic: boolean;
	version: string;
	forkedFrom?: string;
	installs: number;
	status: AgentPublishStatus;
	author?: { id: string; email: string };
	createdAt: string;
	updatedAt: string;
}

export interface AgentInstall {
	id: string;
	agentId: string;
	agent: Agent;
	settings?: Record<string, unknown>;
	installedAt: string;
}

export interface AgentRating {
	id: string;
	agentId: string;
	userId: string;
	rating: number;
	review?: string;
	createdAt: string;
}

export type AgentCategory =
	| 'productivity'
	| 'data-extraction'
	| 'outreach'
	| 'devtools'
	| 'social-media'
	| 'crm'
	| 'finance'
	| 'other';

export type AgentPublishStatus = 'draft' | 'published' | 'archived';

export const AGENT_CATEGORIES: { value: AgentCategory; label: string }[] = [
	{ value: 'productivity', label: 'Productivity' },
	{ value: 'data-extraction', label: 'Data Extraction' },
	{ value: 'outreach', label: 'Outreach' },
	{ value: 'devtools', label: 'Developer Tools' },
	{ value: 'social-media', label: 'Social Media' },
	{ value: 'crm', label: 'CRM' },
	{ value: 'finance', label: 'Finance' },
	{ value: 'other', label: 'Other' },
];
