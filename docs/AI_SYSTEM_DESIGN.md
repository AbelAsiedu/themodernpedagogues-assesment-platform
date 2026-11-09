# AI system — PARTLY IMPLEMENTED (question generation only)

**Built (Phase 3):** AI Question Studio — generate draft MCQ, true/false, short-answer and essay questions with OpenAI.
**Not built:** paper generation, AI marking/explanations, validation of existing questions, OCR, document/PDF upload,
bulk/queued jobs, provider/model management UI, cost reporting. Those remain design intent below.

**Verification status:** exercised against a simulated provider and a local mock HTTP server. The live OpenAI call has
**not** been run from the build environment (no outbound access). Treat it as untested against the real service until you run it.

## How it works today
- `AiProvider` interface (`src/ai/provider.ts`); `OpenAiProvider` (`src/ai/openai.ts`) calls Chat Completions with Structured
  Outputs (strict JSON Schema, `max_completion_tokens`, no sampling parameters so it works across model families).
- The key is read from `AI_API_KEY` on the backend only (`apps/api/.env`, gitignored). It is never in the web app, the database,
  logs, docs or error messages; provider error text is reduced to fixed safe messages.
- `src/ai/questionGen.ts`: builds the prompt (`PROMPT_VERSION=qgen-1`), calls the model, validates every item with the same Zod
  schemas as manual entry, drops invalid or duplicate items, re-shuffles MCQ options (models over-use some letters) keeping the
  key attached, retries **once** on a malformed response, and does not retry auth/quota/outage/refusal.
- **All AI output is saved as `needs_review`, `source = ai`.** Only `POST /questions/:id/review` by a user with `questions.review`
  can approve it; a database CHECK refuses an approved AI question without a reviewer.
- Every request is logged in `ai_generations` (provider, model, prompt version, token usage, latency, counts, error). Per-user daily
  quota (`AI_DAILY_LIMIT_PER_USER`) and a per-IP limit on the endpoint.
- Teacher notes ("grounding text", ≤12,000 chars) are fenced in the prompt as untrusted reference text and the system rules tell
  the model never to follow instructions inside them. Only the text's length is stored. The model has no tools or data access.
- Copyright: the prompt asks for original questions and forbids reproducing past papers/marking schemes; the UI tells teachers to
  paste only notes they wrote or may use. Third-party papers are not ingested.
- AI is never in any examination submission path (no exam engine exists yet; the rule stands for Phase 5/6).

## Still planned
- Queued jobs for long work (documents, bulk), status polling; spend caps per institution; admin-managed providers/models.
- Document-grounded generation with source references from uploaded files; OCR with confidence flags.
- Maths/science answer keys verified by deterministic computation where possible.
- Marking proposals (see MARKING_AND_GRADING.md): AI only proposes against an approved rubric; teacher moderation is final.
- Privacy: strip identifiers from any marking prompts; send student data only when needed and authorised.
