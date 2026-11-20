import { Storage } from "nsh";
import type { Citation, Message } from "./deepseek";

export const historyKey = "yantai.history";
export const legacyKey = "yantai.messages";
export type Conversation = { id: string; updatedAt: number; messages: Message[] };
export type History = { version: 2; active: string | null; conversations: Conversation[] };
export const emptyHistory = (): History => ({ version: 2, active: null, conversations: [] });

type ParsedHistory = { format: "v2" | "v1" | "单会话数组"; history: History };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isDataUrl(value: unknown): boolean {
  return typeof value === "string" && /^\s*data:/i.test(value);
}

function readCitations(values: unknown[]): Citation[] {
  return values.flatMap((value) => {
    const annotation = record(value);
    const citation = record(annotation?.url_citation);
    if (annotation?.type !== "url_citation" || !citation || typeof citation.url !== "string" || isDataUrl(citation.url)) return [];
    const { url, title, start_index, end_index } = citation;
    return [{ type: "url_citation", url_citation: {
      url, title: typeof title === "string" ? title : "",
      start_index: typeof start_index === "number" ? start_index : 0,
      end_index: typeof end_index === "number" ? end_index : 0,
    } }];
  });
}

// DeepSeek tool state is replayed as opaque JSON. Keep its fields forward-compatible
// while excluding embedded credential and raw-file fields from history.
const excludedToolFields = new Set([
  "apikey", "authorization", "credential", "credentials", "password", "accesstoken", "refreshtoken",
  "data", "bytes", "rawbytes", "filebytes", "base64", "binary", "filedata", "attachmentdata",
]);

function normalizeField(key: string): string {
  return key.trim().toLowerCase().replace(/[-_]/g, "");
}

function isSensitiveHeader(key: string): boolean {
  return excludedToolFields.has(key) || key === "proxyauthorization" || key === "xapikey" ||
    key === "xauthtoken" || key === "cookie" || key === "setcookie";
}

function cleanToolState(value: unknown, inHeaders = false): unknown {
  if (Array.isArray(value)) {
    // Headers can be serialized either as an object or as [name, value] pairs.
    return value.filter((child) => {
      if (isDataUrl(child)) return false;
      if (!inHeaders || !Array.isArray(child)) return true;
      const [name, headerValue] = child;
      return !isDataUrl(headerValue) && !(typeof name === "string" && isSensitiveHeader(normalizeField(name)));
    }).map((child) => cleanToolState(child));
  }
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(Object.entries(object).flatMap(([key, child]) => {
    const field = normalizeField(key);
    if ((inHeaders ? isSensitiveHeader(field) : excludedToolFields.has(field)) || isDataUrl(child)) return [];
    return [[key, cleanToolState(child, field === "headers")]];
  }));
}

function readMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) throw new Error("无效的消息列表。");
  return value.map((item: unknown) => {
    const message = record(item);
    if (!(message?.role === "user" || message?.role === "assistant") || typeof message.content !== "string") {
      throw new Error("无效的消息。");
    }
    const { role, content, attachments, reasoning_content, thinkingText, annotations, server_tool_calls } = message;
    const files = Array.isArray(attachments) ? attachments.flatMap((file: unknown) => {
      const attachment = record(file);
      return typeof attachment?.id === "string" && typeof attachment.name === "string"
        ? [{ id: attachment.id, name: attachment.name }] : [];
    }) : undefined;
    const citations = Array.isArray(annotations) ? readCitations(annotations) : undefined;
    return {
      role, content,
      ...(files?.length ? { attachments: files } : {}),
      ...(typeof reasoning_content === "string" ? { reasoning_content } : {}),
      ...(typeof thinkingText === "string" ? { thinkingText } : {}),
      ...(citations?.length ? { annotations: citations } : {}),
      ...(Array.isArray(server_tool_calls) ? { server_tool_calls: server_tool_calls.filter((call) => !isDataUrl(call)).map((call) => cleanToolState(call)) } : {}),
    };
  });
}

export function parseHistory(json: string): ParsedHistory {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("JSON 格式无效，请检查粘贴内容。");
  }
  const envelope = record(value);
  if (envelope?.version === 2) {
    if (!Array.isArray(envelope.conversations)) throw new Error("无效的历史记录。");
    const ids = new Set<string>();
    const conversations = envelope.conversations.map((entry: unknown): Conversation => {
      const item = record(entry);
      if (typeof item?.id !== "string" || !item.id || typeof item.updatedAt !== "number" ||
        !Number.isFinite(item.updatedAt) || ids.has(item.id)) {
        throw new Error("无效的历史记录。");
      }
      ids.add(item.id);
      return { id: item.id, updatedAt: item.updatedAt, messages: readMessages(item.messages) };
    });
    const { active } = envelope;
    return { format: "v2", history: {
      version: 2, active: typeof active === "string" && ids.has(active) ? active : null, conversations,
    } };
  }
  if (envelope && "version" in envelope && envelope.version !== 1) throw new Error("不支持的历史版本。");
  const messages = readMessages(envelope?.version === 1 ? envelope.messages : value);
  return { format: envelope?.version === 1 ? "v1" : "单会话数组", history: messages.length ? {
    version: 2, active: "legacy", conversations: [{ id: "legacy", updatedAt: Date.now(), messages }],
  } : emptyHistory() };
}

export async function restoreHistory(): Promise<History> {
  const stored = await Storage.getItem(historyKey) ?? await Storage.getItem(legacyKey);
  if (stored === null) return emptyHistory();
  const parsed = parseHistory(stored);
  if (parsed.format !== "v2") await saveHistory(parsed.history);
  return parsed.history;
}

function messageFingerprint(messages: Message[]): string {
  return JSON.stringify(readMessages(messages), (_key, value: unknown) => {
    const object = record(value);
    return object ? Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]])) : value;
  });
}

export function mergeHistory(local: History, incoming: History) {
  const ids = new Set(local.conversations.map(({ id }) => id));
  const reserved = new Set([...ids, ...incoming.conversations.map(({ id }) => id)]);
  const seen = new Set(local.conversations.map(({ messages }) => messageFingerprint(messages)));
  const additions: Conversation[] = [];
  let duplicates = 0;
  let conflicts = 0;
  let suffix = 0;
  for (const conversation of incoming.conversations) {
    const fingerprint = messageFingerprint(conversation.messages);
    if (seen.has(fingerprint)) {
      duplicates++;
      continue;
    }
    seen.add(fingerprint);
    let { id } = conversation;
    if (ids.has(id)) {
      conflicts++;
      do { id = `${conversation.id}-import-${++suffix}`; } while (reserved.has(id));
      reserved.add(id);
    }
    additions.push({ ...conversation, id });
  }
  return { history: { ...local, conversations: [...local.conversations, ...additions] },
    added: additions.length, duplicates, conflicts };
}

function serializeHistory(history: History, space?: number): string {
  return JSON.stringify({ ...history, conversations: history.conversations.map((entry) => ({
    ...entry, messages: readMessages(entry.messages),
  })) }, null, space);
}

export function saveHistory(history: History): Promise<void> {
  return Storage.setItem(historyKey, serializeHistory(history));
}

export function createHistoryWriter(write = saveHistory) {
  let pending = Promise.resolve();
  return (history: History) => {
    const next = pending.then(() => write(history));
    pending = next.catch(() => {});
    return next;
  };
}

export function conversationTitle(conversation: Conversation): string {
  const title = conversation.messages.find((message) => message.role === "user")?.content.trim();
  return title ? Array.from(title).slice(0, 28).join("") : "未命名对话";
}

export function exportHistory(history: History): string {
  return serializeHistory(history, 2);
}
