# Google Cloud Agent Search Web App

A Next.js demo that uses Google Cloud **Vertex AI Search** (Discovery Engine) to
answer student questions grounded in your own documents (PDF / PPTX / HTML).

The backend calls the Discovery Engine **Answer API** with **Sessions** to
support multi-turn conversation, and the UI shows inline citations with a
references panel.

## Architecture

```
Browser ──▶ /api/chat (Next.js route) ──▶ Discovery Engine answerQuery + Session
                                  │
                                  └─▶ Engine: <your-engine-id>
                                      Data Store: <your-data-store-id>
                                      (ingests files from GCS bucket)
```

- **Auth**: uses Application Default Credentials (ADC). Locally use
  `gcloud auth application-default login`; on Cloud Run the runtime service
  account is picked up automatically — same code, no changes.
- **Sessions**: a session is created on the first turn and reused for
  follow-ups, so Discovery Engine handles query rewriting / context.

## Prerequisites

- Node.js 20+ (tested on 24)
- `gcloud` CLI authenticated to a project that has a Vertex AI Search engine
  with at least one Data Store containing your indexed documents

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local with your project / engine IDs
```

Sign in for local ADC, set the quota project, and enable the API:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project <PROJECT_ID>
gcloud services enable discoveryengine.googleapis.com --project <PROJECT_ID>
```

## Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## Environment variables

| Var | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | (required) | Project that owns the engine |
| `DISCOVERY_ENGINE_LOCATION` | `global` | `global`, `us`, or `eu` |
| `DISCOVERY_ENGINE_COLLECTION` | `default_collection` | |
| `DISCOVERY_ENGINE_ID` | (required) | The engine ID, e.g. `your-engine_1234567890` |
| `DISCOVERY_ENGINE_SERVING_CONFIG` | `default_search` | |
| `ANSWER_PREAMBLE` | (built-in) | Override the system prompt. Defaults to a Taiwan Traditional Chinese preamble. |

## Deploy to Cloud Run

```bash
PROJECT_ID=<your-project>
REGION=us-central1
SERVICE=rag-demo

gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE

gcloud run deploy $SERVICE \
  --image gcr.io/$PROJECT_ID/$SERVICE \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars GCP_PROJECT_ID=$PROJECT_ID,DISCOVERY_ENGINE_ID=<engine-id>
```

The Cloud Run runtime service account needs the **Discovery Engine Viewer**
role (or equivalent custom role allowing `discoveryengine.servingConfigs.answer`
and `discoveryengine.sessions.*`).

## File map

- `app/page.tsx` — chat UI with inline citations and references panel
- `app/api/chat/route.ts` — POST endpoint, accepts `{query, sessionName?, userPseudoId}`
- `lib/discoveryEngine.ts` — Discovery Engine client wrapper (sessions + answer)
- `Dockerfile` — Next.js standalone build for Cloud Run
- `next.config.ts` — `output: "standalone"`
