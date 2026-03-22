import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	externalId: text('external_id').unique(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const organizations = pgTable('organizations', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	externalId: text('external_id').unique(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orgMembers = pgTable('org_members', {
	id: uuid('id').primaryKey().defaultRandom(),
	orgId: uuid('org_id')
		.references(() => organizations.id)
		.notNull(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	role: text('role').notNull().default('member'), // 'admin' | 'member' | 'viewer'
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sites = pgTable('sites', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	orgId: uuid('org_id').references(() => organizations.id),
	domain: text('domain').notNull(),
	name: text('name'),
	totalPages: integer('total_pages').default(0),
	totalElements: integer('total_elements').default(0),
	lastCrawledAt: timestamp('last_crawled_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const pages = pgTable('pages', {
	id: uuid('id').primaryKey().defaultRandom(),
	siteId: uuid('site_id')
		.references(() => sites.id)
		.notNull(),
	url: text('url').notNull(),
	urlPattern: text('url_pattern'),
	title: text('title'),
	pageType: text('page_type'),
	elements: jsonb('elements').$type<unknown[]>().default([]),
	navigationLinks: jsonb('navigation_links').$type<unknown[]>().default([]),
	lastIndexedAt: timestamp('last_indexed_at').defaultNow(),
});

export const conversations = pgTable('conversations', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	orgId: uuid('org_id').references(() => organizations.id),
	siteId: uuid('site_id').references(() => sites.id),
	agentId: uuid('agent_id').references(() => agents.id),
	title: text('title'),
	outcome: text('outcome'), // 'success' | 'failure' | 'partial' | null
	planStatus: jsonb('plan_status').$type<{
		totalSteps: number;
		completedSteps: number;
		status: 'pending' | 'approved' | 'in_progress' | 'completed' | 'failed';
	}>(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	conversationId: uuid('conversation_id')
		.references(() => conversations.id)
		.notNull(),
	role: text('role').notNull(), // 'user' | 'assistant' | 'system'
	content: text('content').notNull(),
	/** Structured tool call data (tool names, args, results) for multi-turn context */
	toolData: jsonb('tool_data').$type<{
		tools?: { name: string; args: unknown; result: unknown; success: boolean }[];
		streamBlocks?: { type: string; content?: string; toolName?: string; ts: number }[];
	}>(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const domainMemory = pgTable('domain_memory', {
	id: uuid('id').primaryKey().defaultRandom(),
	domain: text('domain').notNull().unique(),
	knownPages: jsonb('known_pages')
		.$type<{ path: string; description: string; howToReach: string }[]>()
		.default([]),
	elementNotes: jsonb('element_notes').$type<{ selector: string; note: string }[]>().default([]),
	workflows: jsonb('workflows').$type<{ name: string; steps: string[] }[]>().default([]),
	appNotes: jsonb('app_notes').$type<string[]>().default([]),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSettings = pgTable('user_settings', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id),
	llmProvider: text('llm_provider').default('anthropic'),
	llmApiKey: text('llm_api_key'),
	llmModelStrong: text('llm_model_strong').default('sonnet'),
	llmModelFast: text('llm_model_fast').default('haiku'),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userMemory = pgTable('user_memory', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	domain: text('domain').notNull(),
	category: text('category').notNull(), // 'preference' | 'correction' | 'terminology' | 'workflow'
	content: text('content').notNull(),
	source: text('source').notNull().default('auto'), // 'auto' | 'explicit'
	confidence: integer('confidence').default(1),
	timesReinforced: integer('times_reinforced').default(1),
	lastUsedAt: timestamp('last_used_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const agents = pgTable('agents', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	orgId: uuid('org_id').references(() => organizations.id),
	slug: text('slug').notNull(),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	model: text('model'),
	maxIterations: integer('max_iterations'),
	tools: jsonb('tools').$type<string[]>(),
	domains: jsonb('domains').$type<string[]>(),
	trigger: jsonb('trigger').$type<{ cron?: string; enabled?: boolean; alertWebhook?: string }>(),
	hooks: jsonb('hooks').$type<import('@afe/shared').AgentHooks>(),
	llmConfig: jsonb('llm_config').$type<import('@afe/shared').AgentLLMConfig>(),
	limits: jsonb('limits').$type<import('@afe/shared').AgentLimits>(),
	domainAutonomy: jsonb('domain_autonomy').$type<Record<string, import('@afe/shared').AgentAutonomy>>(),
	autonomy: text('autonomy').default('supervised'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const agentRuns = pgTable('agent_runs', {
	id: uuid('id').primaryKey().defaultRandom(),
	agentId: uuid('agent_id')
		.references(() => agents.id, { onDelete: 'cascade' })
		.notNull(),
	conversationId: uuid('conversation_id').references(() => conversations.id),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	status: text('status').notNull(), // 'running' | 'completed' | 'failed'
	toolCalls: integer('tool_calls').default(0),
	tokensUsed: integer('tokens_used').default(0),
	durationMs: integer('duration_ms'),
	error: text('error'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	orgId: uuid('org_id').references(() => organizations.id),
	action: text('action').notNull(),
	safetyLevel: text('safety_level').notNull(),
	approved: boolean('approved').notNull(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
