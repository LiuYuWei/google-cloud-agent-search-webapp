# Vertex AI Search RAG demo — common tasks
# Override variables on the command line, e.g.:
#   make deploy PROJECT_ID=my-proj SERVICE=rag-demo

SHELL := /bin/bash

# Load .env.local if it exists (key=value lines).
-include .env.local
export

PROJECT_ID ?= $(GCP_PROJECT_ID)
REGION     ?= us-central1
SERVICE    ?= rag-demo
IMAGE      ?= gcr.io/$(PROJECT_ID)/$(SERVICE)

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# --- Local dev ---------------------------------------------------------------

.PHONY: install
install: ## Install npm dependencies
	npm install

.PHONY: dev
dev: ## Start Next.js dev server on http://localhost:3000
	npm run dev

.PHONY: build
build: ## Next.js production build
	npm run build

.PHONY: start
start: ## Serve the production build
	npm run start

# --- GCP setup ---------------------------------------------------------------

.PHONY: gcp-auth
gcp-auth: ## Configure Application Default Credentials for local dev
	gcloud auth application-default login
	@if [ -n "$(PROJECT_ID)" ]; then \
		gcloud auth application-default set-quota-project $(PROJECT_ID); \
	else \
		echo "PROJECT_ID not set — skipping quota project"; \
	fi

.PHONY: gcp-enable
gcp-enable: ## Enable Discovery Engine API on PROJECT_ID
	@test -n "$(PROJECT_ID)" || (echo "PROJECT_ID is required" && exit 1)
	gcloud services enable discoveryengine.googleapis.com --project $(PROJECT_ID)

# --- Container ---------------------------------------------------------------

.PHONY: docker-build
docker-build: ## Build the container image locally with Docker
	docker build -t $(SERVICE) .

.PHONY: docker-run
docker-run: ## Run the local container (passes .env.local through)
	docker run --rm -p 3000:3000 --env-file .env.local $(SERVICE)

# --- Cloud Run ---------------------------------------------------------------

.PHONY: cloud-build
cloud-build: ## Build & push image with Cloud Build
	@test -n "$(PROJECT_ID)" || (echo "PROJECT_ID is required" && exit 1)
	gcloud builds submit --tag $(IMAGE)

.PHONY: deploy
deploy: ## Deploy to Cloud Run (uses PROJECT_ID + DISCOVERY_ENGINE_ID)
	@test -n "$(PROJECT_ID)" || (echo "PROJECT_ID is required" && exit 1)
	@test -n "$(DISCOVERY_ENGINE_ID)" || (echo "DISCOVERY_ENGINE_ID is required" && exit 1)
	gcloud run deploy $(SERVICE) \
		--image $(IMAGE) \
		--region $(REGION) \
		--platform managed \
		--allow-unauthenticated \
		--set-env-vars GCP_PROJECT_ID=$(PROJECT_ID),DISCOVERY_ENGINE_ID=$(DISCOVERY_ENGINE_ID)

.PHONY: ship
ship: cloud-build deploy ## Build image + deploy in one go
