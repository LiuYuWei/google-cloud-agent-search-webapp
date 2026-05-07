<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project: Vertex AI Search RAG demo (Next.js + Discovery Engine)

## Architecture (one-line summary)

Browser → `/api/chat` (Next.js route) → Discovery Engine `answerQuery` + Sessions
(engine + data store live in GCP; documents are ingested from a GCS bucket).

Key files:
- `app/page.tsx` — chat UI (markdown, inline citations, references panel)
- `app/api/chat/route.ts` — POST endpoint, accepts `{query, sessionName?, userPseudoId}`
- `lib/discoveryEngine.ts` — Discovery Engine client wrapper (sessions + answer)
- `Dockerfile` + `next.config.ts` (`output: "standalone"`) — Cloud Run build

## Common commands

- `npm run dev` — start dev server on http://localhost:3000
- `npm run build` / `npm run start` — production build / serve
- No test command configured.

## Documentation: keep both READMEs in sync

There are two READMEs:

- `README.md` (English, canonical)
- `README.zh-TW.md` (Traditional Chinese)

When you change one, update the other in the same commit. Each README links to the other at the top.

## Example/config files: never commit real values

`.env.local.example` and any other `*.example` / sample config files MUST contain only placeholders
(`your-gcp-project-id`, `your-engine-id`, etc.). Real project IDs, engine IDs, account names,
or anything tied to a specific GCP environment belong in `.env.local` (git-ignored), never in tracked files
— including code comments, READMEs, and architecture diagrams.

If a real value lands in a tracked file, treat it like a leak: scrub the working tree AND rewrite git
history (`git filter-branch` / `git filter-repo`) before pushing. Once on GitHub, even a force-push
leaves cached commit SHAs accessible for a while.

## GCP / Discovery Engine notes

- **Auth**: Application Default Credentials (ADC). Local: `gcloud auth application-default login`
  + `gcloud auth application-default set-quota-project <PROJECT_ID>`. Cloud Run: runtime
  service account is picked up automatically — same code path, no conditional logic.
- **API**: enable `discoveryengine.googleapis.com` on the project.
- **IAM for Cloud Run runtime SA**: needs **Discovery Engine Viewer** (or a custom role allowing
  `discoveryengine.servingConfigs.answer` and `discoveryengine.sessions.*`).
- **Sessions**: created on the first turn, reused for follow-ups so Discovery Engine handles
  query rewriting and conversation context. Don't reinvent that logic in the app.
- **Locations**: `DISCOVERY_ENGINE_LOCATION` is `global` / `us` / `eu`. The client wrapper
  selects the right regional endpoint — don't hardcode hosts.
- **Preamble**: Answer API system prompt defaults to a Taiwan Traditional Chinese preamble.
  Override via `ANSWER_PREAMBLE` env var; do not hardcode preamble text in route handlers.
