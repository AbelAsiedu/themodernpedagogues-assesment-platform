/**
 * Provider-agnostic AI interface. Everything above this line (prompts, validation, saving drafts)
 * is independent of which vendor is behind it. The API key lives inside a provider instance on the
 * backend and is never part of any request/response type here.
 */

export interface JsonRequest {
  system: string;
  user: string;
  /** Name for the structured-output schema (letters, digits, underscores). */
  schemaName: string;
  /** JSON Schema describing the object the model must return. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface JsonResult {
  json: unknown;
  model: string;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateJson(req: JsonRequest): Promise<JsonResult>;
}

export type AiErrorKind = "auth" | "rate_limit" | "timeout" | "unavailable" | "bad_response" | "refused";

/** Safe to show to a user: never contains keys, prompts or raw provider payloads. */
export class AiProviderError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
  }
}
