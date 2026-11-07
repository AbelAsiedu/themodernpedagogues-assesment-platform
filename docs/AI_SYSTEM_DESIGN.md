# AI system — DESIGN INTENT, NOT IMPLEMENTED

No AI provider is connected; no AI code exists. `AI_PROVIDER` / `AI_API_KEY` are reserved names only.
**Needs from TMP:** the provider/model choice and an API key (kept on the backend only).

## Planned structure
- A provider-agnostic `AiProvider` interface (`generateStructured(schema, prompt, options)`), with providers and approved models
  configured by admins. Separate task modules: question generation, validation, paper generation, marking, explanations, OCR.
- **Structured outputs validated with Zod**; invalid output is retried with a bounded policy, then marked failed.
- Long work (documents, bulk generation) runs as **queued jobs** with status, never blocking a request.
- Every call records provider, model, prompt version, token usage, cost, latency and outcome; quotas per user and per institution.

## Content rules
- AI output is always a **draft**: `needs_review` until a teacher approves. Never auto-approved into an exam.
- Document-grounded generation carries source references; the model is instructed not to add unsupported facts unless asked.
- Maths/science answer keys are verified by deterministic computation where possible.
- Copyright: no reproduction of protected papers or marking schemes.

## Safety/privacy
- Don't send student personal data to providers unless needed and authorised; strip identifiers from marking prompts.
- Treat uploaded documents as untrusted input (prompt-injection aware); the model has no tools or data access beyond what's in the prompt.
