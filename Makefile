# Commandra — Development Commands

include .env
export

.PHONY: setup dev stop db-migrate db-generate db-reset build lint clean test test-watch test-coverage test-api test-ext test-shared

# ---------- First-time setup ----------
setup:
	cp -n .env.example .env || true
	pnpm install
	pnpm supabase:local
	pnpm --filter @commandra/shared build
	pnpm --filter @commandra/api db:generate
	pnpm --filter @commandra/api db:migrate
	@echo "\n--- Setup complete. Run 'make dev' to start. ---"

# ---------- Development ----------
dev:
	@cd docker/supabase && docker compose up -d
	@echo "Waiting for Supabase Postgres..."
	@until cd docker/supabase && docker compose exec -T db pg_isready -U postgres -h localhost > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @commandra/shared build
	cd apps/api && npx drizzle-kit studio &
	pnpm dev

dev-api:
	@cd docker/supabase && docker compose up -d
	@until cd docker/supabase && docker compose exec -T db pg_isready -U postgres -h localhost > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @commandra/shared build
	pnpm --filter @commandra/api dev

dev-ext:
	pnpm --filter @commandra/shared build
	pnpm --filter @commandra/extension dev

dev-web:
	pnpm --filter @commandra/shared build
	pnpm --filter @commandra/web dev

db-studio:
	cd apps/api && npx drizzle-kit studio

# ---------- Database ----------
db-generate:
	pnpm --filter @commandra/api db:generate

db-migrate:
	pnpm --filter @commandra/api db:migrate

db-reset:
	cd docker/supabase && docker compose down -v && docker compose up -d
	@echo "Waiting for Supabase Postgres..."
	@until cd docker/supabase && docker compose exec -T db pg_isready -U postgres -h localhost > /dev/null 2>&1; do sleep 1; done
	@sleep 5
	pnpm --filter @commandra/api db:generate
	pnpm --filter @commandra/api db:migrate
	@echo "Database reset complete."

# ---------- Build & Quality ----------
build:
	pnpm --filter @commandra/shared build
	pnpm build

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

# ---------- Tests ----------
test:
	pnpm --filter @commandra/shared build
	pnpm test

test-watch:
	pnpm --filter @commandra/shared build
	pnpm test:watch

test-coverage:
	pnpm --filter @commandra/shared build
	pnpm test:coverage

test-api:
	pnpm --filter @commandra/shared build
	pnpm --filter @commandra/api test

test-ext:
	pnpm --filter @commandra/shared build
	pnpm --filter @commandra/extension test

test-shared:
	pnpm --filter @commandra/shared test

# ---------- CI (runs all checks) ----------
ci: lint test build

# ---------- Docker ----------
up:
	cd docker/supabase && docker compose up -d

stop:
	cd docker/supabase && docker compose down

# ---------- Cleanup ----------
clean:
	pnpm clean
	find . -name '*.tsbuildinfo' -delete
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
