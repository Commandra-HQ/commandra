# Agents for Everyone — Development Commands

.PHONY: setup dev stop db-migrate db-generate db-reset build lint clean

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
	pnpm dev

dev-api:
	docker compose up -d db
	@until docker compose exec db pg_isready -U afe > /dev/null 2>&1; do sleep 1; done
	pnpm --filter @afe/api dev

dev-ext:
	pnpm --filter @afe/extension dev

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
	pnpm build

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

# ---------- Docker ----------
up:
	docker compose up -d

stop:
	docker compose down

# ---------- Cleanup ----------
clean:
	pnpm clean
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
