import { pgTable, text, timestamp, uuid, jsonb, integer, boolean, vector } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	clerkId: text('clerk_id').notNull().unique(),
	email: text('email').notNull().unique(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sites = pgTable('sites', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
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
		.references(() => pages.id)
		.notNull(),
	elementLabel: text('element_label').notNull(),
	elementType: text('element_type').notNull(),
	selector: text('selector').notNull(),
	embedding: vector('embedding', { dimensions: 256 }),
});

export const conversations = pgTable('conversations', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
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
	siteId: uuid('site_id')
		.references(() => sites.id)
		.notNull(),
	name: text('name').notNull(),
	description: text('description'),
	steps: jsonb('steps').$type<unknown[]>().default([]),
	parameters: jsonb('parameters').$type<unknown[]>().default([]),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	action: text('action').notNull(),
	safetyLevel: text('safety_level').notNull(),
	approved: boolean('approved').notNull(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
