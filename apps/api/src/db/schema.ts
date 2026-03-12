import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	vector,
} from 'drizzle-orm/pg-core';

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

export const elementEmbeddings = pgTable('element_embeddings', {
	id: uuid('id').primaryKey().defaultRandom(),
	pageId: uuid('page_id')
		.references(() => pages.id, { onDelete: 'cascade' })
		.notNull(),
	elementLabel: text('element_label').notNull(),
	elementType: text('element_type').notNull(),
	selector: text('selector').notNull(),
	labelHash: text('label_hash'),
	embeddingModel: text('embedding_model'),
	embedding: vector('embedding', { dimensions: 1536 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const flowEmbeddings = pgTable('flow_embeddings', {
	id: uuid('id').primaryKey().defaultRandom(),
	flowId: uuid('flow_id')
		.references(() => flows.id, { onDelete: 'cascade' })
		.notNull(),
	text: text('text').notNull(),
	embeddingModel: text('embedding_model'),
	embedding: vector('embedding', { dimensions: 1536 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memoryEmbeddings = pgTable('memory_embeddings', {
	id: uuid('id').primaryKey().defaultRandom(),
	siteId: uuid('site_id')
		.references(() => sites.id, { onDelete: 'cascade' })
		.notNull(),
	memoryKey: text('memory_key').notNull(),
	memoryText: text('memory_text').notNull(),
	embeddingModel: text('embedding_model'),
	embedding: vector('embedding', { dimensions: 1536 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	orgId: uuid('org_id').references(() => organizations.id),
	siteId: uuid('site_id').references(() => sites.id),
	title: text('title'),
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
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const flows = pgTable('flows', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	orgId: uuid('org_id').references(() => organizations.id),
	siteId: uuid('site_id')
		.references(() => sites.id)
		.notNull(),
	name: text('name').notNull(),
	description: text('description'),
	steps: jsonb('steps').$type<unknown[]>().default([]),
	parameters: jsonb('parameters').$type<unknown[]>().default([]),
	status: text('status').default('draft').notNull(),
	lastRunAt: timestamp('last_run_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const flowRuns = pgTable('flow_runs', {
	id: uuid('id').primaryKey().defaultRandom(),
	flowId: uuid('flow_id')
		.references(() => flows.id)
		.notNull(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	parameterValues: jsonb('parameter_values').$type<Record<string, string>>().default({}),
	stepResults: jsonb('step_results').$type<unknown[]>().default([]),
	status: text('status').notNull(),
	stepsCompleted: integer('steps_completed').default(0),
	totalSteps: integer('total_steps').notNull(),
	error: text('error'),
	startedAt: timestamp('started_at').defaultNow().notNull(),
	completedAt: timestamp('completed_at'),
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
