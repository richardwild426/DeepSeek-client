import { apiRequest, type Attachment } from "./deepseek";

const limit = 20 * 1024 * 1024;
const types = ["png", "jpg", "jpeg", "gif", "webp", "pdf"];
export const attachmentFilters = [{ name: "图片与 PDF", extensions: types }];

async function purposeOf(file: File): Promise<"user_data" | "text_recognition"> {
  if (file.size === 0 || file.size > limit) throw new Error("附件必须非空且不超过 20 MiB。");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = Array.from(header, (byte) => String.fromCharCode(byte)).join("");
  if (/\.pdf$/i.test(file.name) && ascii.startsWith("%PDF-")) return "text_recognition";
  if ((/\.png$/i.test(file.name) && ascii.startsWith("\x89PNG\r\n\x1a\n")) ||
      (/\.jpe?g$/i.test(file.name) && ascii.startsWith("\xff\xd8\xff")) ||
      (/\.gif$/i.test(file.name) && /^GIF8[79]a/.test(ascii)) ||
      (/\.webp$/i.test(file.name) && /^RIFF....WEBP/s.test(ascii))) return "user_data";
  throw new Error("请选择有效的 JPEG、PNG、GIF、WebP 或 PDF 文件。");
}

export async function validateAttachment(file: File): Promise<void> {
  await purposeOf(file);
}

export async function uploadAttachment(file: File, key: string, signal: AbortSignal): Promise<Attachment> {
  const data = new FormData();
  data.append("purpose", await purposeOf(file));
  data.append("expires_after[anchor]", "created_at");
  data.append("expires_after[seconds]", "604800");
  data.append("file", file, file.name);
  const result = await (await apiRequest("/files", key, signal, data)).json();
  if (typeof result?.id !== "string" || !/^file-api-[\w-]+$/.test(result.id)) {
    throw new Error("DeepSeek 上传响应缺少文件 ID。");
  }
  return { id: result.id, name: file.name };
}
