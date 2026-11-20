export const accountModels = { object: "list", data: [{ id: "deepseek-v4-pro" }, { id: "fixture-model" }, { id: "fixture-model" }] };
export const accountBalance = { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "10.50" }] };
export const toolSteps = [{ index: 0, reasoning_content: "查找资料。", calls: [
  { index: 0, type: "deepseek_read_url", kind: "read_link", status: "completed", signature: "fixture-signature",
    page: { url: "https://example.com/article", title: "示例资料" } },
] }];
export const citations = [{ type: "url_citation", url_citation: {
  url: "https://example.com/article", title: "示例资料", start_index: 0, end_index: 4,
} }];
export const legacyConversation = { version: 1, apiKey: "do-not-export", messages: [
  { role: "user", content: "旧问题" }, { role: "assistant", content: "旧答案" },
] };
export const localHistory = { version: 2, active: "local", conversations: [
  { id: "local", updatedAt: 100, messages: [
    { role: "user", content: "本机问题" }, { role: "assistant", content: "本机答案" },
  ] },
] };
export const fixtureHeaderToken = "fixture-header-token";
export const fixturePdfBase64 = "JVBERi0xLjQKJSVFT0YK";
export const backupToolSteps = toolSteps.map((step) => ({ ...step, calls: step.calls.flatMap((call) => {
  const attachment = { id: "tool-file", name: "工具附件.pdf" };
  return [
    { ...call, request: { headers: [["Accept", "application/pdf"]] }, attachment },
    { ...call, index: call.index + 1, request: { headers: { Accept: "application/pdf" } }, attachment },
  ];
}) }));
export const importHistoryFixture = { version: 2, active: "local", apiKey: "fixture-embedded-key", conversations: [
  { id: "local", updatedAt: 200, messages: [
    { role: "user", content: "备份问题", attachments: [{ id: "file-backup", name: "备份.pdf", data: "fixture-raw-bytes" }] },
    { role: "assistant", content: "备份答案", reasoning_content: "最后一步", thinkingText: "完整思考", annotations: citations,
      server_tool_calls: backupToolSteps.map((step) => ({ ...step, calls: step.calls.map((call) => ({
        ...call, authorization: "fixture-tool-key", bytes: "fixture-tool-bytes",
        request: { headers: Array.isArray(call.request.headers)
          ? [["aUtHoRiZaTiOn", `Bearer ${fixtureHeaderToken}`], ["x-aUtH-tOkEn", `${fixtureHeaderToken}-pair`], ...call.request.headers]
          : { ...call.request.headers, "X-Auth-Token": `${fixtureHeaderToken}-object` } },
        attachment: { ...call.attachment, url: `data:application/pdf;base64,${fixturePdfBase64}` },
      })) })),
    },
  ] },
  { ...localHistory.conversations[0], id: "same-messages-other-id", updatedAt: 201 },
] };
export const fixturePdf = { name: "sample.pdf", type: "application/pdf", data: new TextEncoder().encode("%PDF-1.4\n%%EOF\n") };
export const fixturePng = { name: "sample.png", type: "image/png", data: new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0,
]) };
