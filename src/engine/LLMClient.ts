const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.0-flash-lite-001";
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TEMPERATURE = 0.7;
const TIMEOUT_MS = 10_000;

export interface GenerateOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export class LLMClient {
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor() {
    this.apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
    this.defaultModel = process.env["OPENROUTER_MODEL"] ?? DEFAULT_MODEL;

    if (!this.apiKey) {
      console.warn(
        "Warning: OPENROUTER_API_KEY is not set. AI generation will be unavailable."
      );
    }
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateOptions = {}
  ): Promise<GenerateResult> {
    if (!this.apiKey) {
      return { ok: false, error: "OPENROUTER_API_KEY is not configured" };
    }

    const body = JSON.stringify({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "frittertopia",
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, error: "Request timed out after 10 seconds" };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `API error ${response.status}: ${body || response.statusText}`,
      };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: "Failed to parse API response as JSON" };
    }

    const text = (
      json as {
        choices?: Array<{ message?: { content?: string } }>;
      }
    )?.choices?.[0]?.message?.content;

    if (typeof text !== "string" || text.length === 0) {
      return { ok: false, error: "API returned no text content" };
    }

    return { ok: true, text };
  }
}
