import { AiProviderError, type AiProvider, type JsonRequest, type JsonResult } from "./provider.js";

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI Chat Completions with Structured Outputs (json_schema, strict).
 * Uses only `max_completion_tokens` and no sampling parameters, so it stays compatible across model families.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(o: OpenAiOptions) {
    this.apiKey = o.apiKey;
    this.model = o.model;
    this.baseUrl = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.timeoutMs = o.timeoutMs ?? 60_000;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async generateJson(req: JsonRequest): Promise<JsonResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          max_completion_tokens: req.maxOutputTokens,
          response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
        }),
      });
    } catch (e) {
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") throw new AiProviderError("timeout", "The AI service took too long to respond");
      throw new AiProviderError("unavailable", "Could not reach the AI service");
    }

    if (!res.ok) {
      // Read the provider's error message but keep it short and never echo our own request.
      let detail = "";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = (body.error?.message ?? "").slice(0, 200);
      } catch { /* ignore */ }
      if (res.status === 401 || res.status === 403) throw new AiProviderError("auth", "The AI service rejected the configured credentials");
      if (res.status === 429) throw new AiProviderError("rate_limit", "The AI service is rate-limiting or out of quota. Try again shortly");
      if (res.status >= 500) throw new AiProviderError("unavailable", "The AI service is temporarily unavailable");
      throw new AiProviderError("bad_response", `The AI service rejected the request (${res.status})${detail ? `: ${detail}` : ""}`);
    }

    const body = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const msg = body?.choices?.[0]?.message;
    if (msg?.refusal) throw new AiProviderError("refused", "The AI service declined this request");
    if (!msg?.content) throw new AiProviderError("bad_response", "The AI service returned an empty response");
    let json: unknown;
    try {
      json = JSON.parse(msg.content);
    } catch {
      throw new AiProviderError("bad_response", "The AI service returned malformed data");
    }
    return {
      json,
      model: body?.model ?? this.model,
      usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens },
    };
  }
}
