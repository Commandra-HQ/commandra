# Commandra — Development Commands

include .env
export

.PHONY: setup dev stop db-migrate db-generate db-reset build lint clean test test-watch test-coverage test-api test-ext test-shared

# ---------- First-time setup ----------
setup:
	cp -n .env.example .env || true
	pnpm install
	docker compose up -d db
	@echo "Waiting for Postgres to be ready..."
	@until docker compose exec db pg_isready -U afe > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @afe/shared build
	pnpm --filter @afe/api db:generate
	pnpm --filter @afe/api db:migrate
	@echo "\n--- Setup complete. Run 'make dev' to start. ---"

# ---------- Development ----------
dev:
	docker compose up -d db
	@until docker compose exec db pg_isready -U afe > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @afe/shared build
	cd apps/api && npx drizzle-kit studio &
	pnpm dev

dev-api:
	docker compose up -d db
	@until docker compose exec db pg_isready -U afe > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @afe/shared build
	pnpm --filter @afe/api dev

dev-ext:
	pnpm --filter @afe/shared build
	pnpm --filter @afe/extension dev

dev-web:
	pnpm --filter @afe/shared build
	pnpm --filter @afe/web dev

db-studio:
	cd apps/api && npx drizzle-kit studio

# ---------- Database ----------
db-generate:
	pnpm --filter @afe/api db:generate

db-migrate:
	pnpm --filter @afe/api db:migrate

db-reset:
	docker compose down -v
	docker compose up -d db
	@until docker compose exec db pg_isready -U afe > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @afe/api db:generate
	pnpm --filter @afe/api db:migrate
	@echo "Database reset complete."

# ---------- Build & Quality ----------
build:
	pnpm --filter @afe/shared build
	pnpm build

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

# ---------- Tests ----------
test:
	pnpm --filter @afe/shared build
	pnpm test

test-watch:
	pnpm --filter @afe/shared build
	pnpm test:watch

test-coverage:
	pnpm --filter @afe/shared build
	pnpm test:coverage

test-api:
	pnpm --filter @afe/shared build
	pnpm --filter @afe/api test

test-ext:
	pnpm --filter @afe/shared build
	pnpm --filter @afe/extension test

test-shared:
	pnpm --filter @afe/shared test

# ---------- CI (runs all checks) ----------
ci: lint test build

# ---------- Docker ----------
up:
	docker compose up -d

stop:
	docker compose down

# ---------- Cleanup ----------
clean:
	pnpm clean
	find . -name '*.tsbuildinfo' -delete
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
