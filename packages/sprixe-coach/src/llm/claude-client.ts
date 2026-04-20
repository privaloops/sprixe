/**
 * Thin client that POSTs to the dev proxy at /api/coach/generate and
 * parses its Server-Sent Events stream of token deltas. Works in the
 * browser — no secrets ever touch the bundle.
 */

export interface StreamCommentInput {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StreamCommentHandlers {
  onToken(token: string): void;
  onDone?(usage?: unknown): void;
  onError?(err: string): void;
}

export async function streamComment(
  input: StreamCommentInput,
  handlers: StreamCommentHandlers,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/coach/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        maxTokens: input.maxTokens ?? 50,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
    return;
  }

  if (!response.ok || !response.body) {
    handlers.onError?.(`proxy ${response.status}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!raw.startsWith('data: ')) continue;
        const payload = raw.slice(6).trim();
        if (!payload) continue;
        let parsed: { token?: string; done?: boolean; usage?: unknown; error?: string };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.error) { handlers.onError?.(parsed.error); return; }
        if (parsed.token) handlers.onToken(parsed.token);
        if (parsed.done) { handlers.onDone?.(parsed.usage); return; }
      }
    }
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : String(e));
  }
}
