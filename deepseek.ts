const origin = "https://api.deepseek.com";
export const endpoint = `${origin}/chat/completions`;
export const models = ["deepseek-flash", "deepseek-v4-pro"] as const;
export type Model = string;

export type Attachment = { id: string; name: string };
export type Citation = { type: "url_citation"; url_citation: {
  url: string; title: string; start_index: number; end_index: number;
} };
export type Message = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  reasoning_content?: string;
  thinkingText?: string;
  thinkingSeconds?: number;
  annotations?: Citation[];
  server_tool_calls?: unknown[];
};
export type ChatOptions = { thinking?: boolean; search?: boolean; readLinks?: boolean };
type Delta = Pick<Message, "content" | "reasoning_content" | "annotations" | "server_tool_calls">;
type Chunk = { error?: unknown; choices?: {
  delta?: Partial<Delta>; finish_reason?: string | null; server_tool_event?: { type?: string };
}[] };

export function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export async function readCompletion(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onThinking?: (text: string) => void,
): Promise<Message> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const answer: Message = { role: "assistant", content: "" };
  let thinking = "";
  let lastStep = "";
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const data = buffer.slice(0, boundary.index).split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (!data) continue;
        if (data === "[DONE]") {
          if (thinking) {
            answer.reasoning_content = lastStep;
            answer.thinkingText = thinking;
          }
          return answer;
        }
        const chunk = JSON.parse(data) as Chunk;
        if (chunk.error) throw new Error("DeepSeek 返回了流式错误。");
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason === "content_filter") throw new CompletionError("DeepSeek 拒绝了此次回答。");
        if (choice?.finish_reason === "length") throw new CompletionError("回答达到长度上限，原问题已保留。");
        const delta = choice?.delta;
        if (typeof delta?.reasoning_content === "string") {
          lastStep += delta.reasoning_content;
          thinking += delta.reasoning_content;
          onThinking?.(thinking);
        }
        if (choice?.server_tool_event?.type === "step_reasoning_done") lastStep = "";
        if (typeof delta?.content === "string" && delta.content) {
          answer.content += delta.content;
          onText(delta.content);
        }
        if (Array.isArray(delta?.annotations)) answer.annotations = delta.annotations;
        if (Array.isArray(delta?.server_tool_calls)) answer.server_tool_calls = delta.server_tool_calls;
      }
      if (done) throw new Error("回答连接提前结束，请重试。");
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class CompletionError extends Error {}

export async function apiRequest(path: "/models" | "/user/balance" | "/chat/completions" | "/files", key: string, signal: AbortSignal, body?: object) {
  let response: Response;
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal,
      headers: { Authorization: `Bearer ${key}`, ...(!body || multipart ? {} : { "Content-Type": "application/json" }) },
      body: body ? multipart ? body : JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("无法直连 DeepSeek，请检查网络或浏览器跨域设置。");
  }
  if (response.ok) return response;
  if (response.status === 401) throw new Error("API Key 未通过验证。");
  if (response.status === 402) throw new Error("DeepSeek 账户余额不足。");
  if (response.status === 429) throw new Error("请求过于频繁，请稍后重试。");
  throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）。`);
}

export async function loadModels(key: string, signal: AbortSignal): Promise<string[]> {
  const payload = await (await apiRequest("/models", key, signal)).json();
  if (!Array.isArray(payload?.data)) throw new Error("模型列表响应格式异常。");
  const ids = payload.data.map((item: { id?: unknown } | null) => item?.id)
    .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0);
  if (!ids.length) throw new Error("当前账户没有可用模型。");
  return [...new Set<string>(ids)];
}

export async function loadBalance(key: string, signal: AbortSignal): Promise<string> {
  const payload = await (await apiRequest("/user/balance", key, signal)).json();
  if (typeof payload?.is_available !== "boolean") throw new Error("余额响应格式异常。");
  const rows: ({ currency?: string; total_balance?: string } | null)[] = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
  const amounts = rows.flatMap((row) => typeof row?.currency === "string" && typeof row.total_balance === "string"
    ? [`${row.currency} ${row.total_balance}`] : []);
  return [payload.is_available ? "账户可用" : "账户余额不足", ...amounts].join(" · ");
}

export async function complete(
  key: string, model: Model, messages: Message[], signal: AbortSignal,
  onText: (text: string) => void, options: ChatOptions = {}, onThinking?: (text: string) => void,
) {
  const tools = [options.search && { type: "deepseek_web_search" }, options.readLinks && { type: "deepseek_read_url" }].filter(Boolean);
  const context = messages.map(({ role, content, attachments, reasoning_content, server_tool_calls, annotations }) => ({
    role,
    content: attachments?.length ? [{ type: "text", text: content }, ...attachments.map(({ id }) => ({ type: "file", file_id: id }))] : content,
    ...(server_tool_calls ? { server_tool_calls, annotations, reasoning_content } :
      tools.length && role === "assistant" ? { reasoning_content: reasoning_content ?? "" } : {}),
  }));
  const response = await apiRequest("/chat/completions", key, signal, {
    model, messages: context, stream: true, thinking: { type: options.thinking ? "enabled" : "disabled" },
    ...(tools.length ? { tools } : {}),
  });
  if (!response.body) throw new Error("DeepSeek 没有返回回答流。");
  try {
    return await readCompletion(response.body, onText, onThinking);
  } catch (error) {
    if (error instanceof CompletionError) throw error;
    throw new Error("回答流中断或格式异常，请重试。");
  }
}
