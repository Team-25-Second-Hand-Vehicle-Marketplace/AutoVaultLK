SERVICES := auth-user-service marketplace-service admin-service notification-service ingestion-service
PACKAGES := $(SERVICES) web-frontend

.PHONY: help install build test typecheck lint db-up db-down

help:
	@echo "Targets: install build test typecheck lint db-up db-down"

install:
	@for p in $(PACKAGES); do (cd $$p && npm ci) || exit 1; done

build:
	@for p in $(PACKAGES); do (cd $$p && npm run build) || exit 1; done

test:
	@for p in $(SERVICES); do (cd $$p && npm run test:ci) || exit 1; done

typecheck:
	@for p in $(SERVICES); do (cd $$p && npx tsc --noEmit -p tsconfig.json) || exit 1; done

lint:
	@for p in $(SERVICES); do (cd $$p && npm run lint) || exit 1; done

db-up:
	docker compose up -d postgres

db-down:
	docker compose down
