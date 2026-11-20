import { expect, open, test, type App } from "nsh/test";
import { endpoint, readCompletion } from "./deepseek";
import { accountBalance, accountModels, backupToolSteps, citations, fixtureHeaderToken, fixturePdf, fixturePdfBase64, fixturePng, importHistoryFixture, legacyConversation, localHistory, toolSteps } from "./fixtures";
import { createHistoryWriter, emptyHistory, historyKey, legacyKey } from "./history";

const request = `POST ${endpoint}`;
const eventStream = { "content-type": "text/event-stream" };
const stream = (parts: string[]) => parts.map((content) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`,
).join("") + "data: [DONE]\r\n\r\n";

async function setKey(app: App) {
  await app.press("id:settings");
  await app.type("id:key", "fake-test-key");
  await app.press("id:close-settings");
}

async function openHistory(app: App) {
  if (!app.shows("id:history-legacy") && app.shows("id:menu")) await app.press("id:menu");
}

async function ask(app: App, text: string) {
  await app.type("id:question", text);
  await app.press("id:send");
}

test("SSE decodes UTF-8 and CRLF split across byte chunks", async () => {
  const bytes = new TextEncoder().encode(": keep-alive\r\n\r\n" + stream(["砚", "台"]));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const parts: string[] = [];
  await readCompletion(body, (part) => parts.push(part));
  expect(parts).toEqual(["砚", "台"]);
});

test("platform smoke renders and opens settings", async () => {
  const app = await open("./App.tsx");
  await app.waitFor("text:砚台");
  await app.press("id:settings");
  await app.waitFor("id:key");
  await app.waitFor("text:DeepSeek Flash");
});

test("narrow Web opens settings without sending an unauthenticated request", async () => {
  const app = await open("./App.tsx", { platform: "web", width: 320, network: {} });
  await app.waitFor("text:砚台");
  await ask(app, "你好");
  await app.waitFor("text:请先填写 API Key。");
  expect(app.requests()).toEqual([]);
});

test("macOS assembles SSE, sends multi-turn context and resets the conversation", async () => {
  let calls = 0;
  const app = await open("./App.tsx", {
    platform: "macos", width: 1024, network: {
      [request]: () => ({ headers: eventStream, body: ": keep-alive\r\n\r\n" + stream(++calls === 1 ? ["青", "山"] : ["绿水"]) }),
    },
  });
  await setKey(app);
  await ask(app, "第一问");
  await app.waitFor("text:青山");
  await app.waitFor("id:send");
  await app.press("id:settings");
  await app.press("id:deepseek-v4-pro");
  await app.press("id:close-settings");
  await app.type("id:question", "第二问");
  await app.submit("id:question");
  await app.waitFor("text:绿水");
  await app.waitFor("id:send");

  const requests = app.requests();
  expect(requests.map((r) => [r.method, r.url])).toEqual([["POST", endpoint], ["POST", endpoint]]);
  expect(Object.entries(requests[0].headers).find(([name]) => name.toLowerCase() === "authorization")?.[1]).toBe("Bearer fake-test-key");
  expect(JSON.parse(requests[0].body ?? "{}")).toEqual({
    model: "deepseek-flash", stream: true, thinking: { type: "disabled" },
    messages: [{ role: "user", content: "第一问" }],
  });
  expect(JSON.parse(requests[1].body ?? "{}")).toEqual({
    model: "deepseek-v4-pro", stream: true, thinking: { type: "disabled" },
    messages: [
      { role: "user", content: "第一问" }, { role: "assistant", content: "青山" },
      { role: "user", content: "第二问" },
    ],
  });
  await app.press("id:new");
  await app.waitFor("text:开始一段对话");
  expect(app.shows("青山")).toBe(false);
});

test("401 preserves the draft for retry without polluting context", async () => {
  let calls = 0;
  const app = await open("./App.tsx", { network: {
    [request]: () => ++calls === 1 ? { status: 401 } : { headers: eventStream, body: stream(["已恢复"]) },
  } });
  await setKey(app);
  await ask(app, "原问题");
  await app.waitFor("text:API Key 未通过验证。");
  await app.press("id:send");
  await app.waitFor("text:已恢复");
  expect(JSON.parse(app.requests()[1].body ?? "{}").messages).toEqual([{ role: "user", content: "原问题" }]);
});

test("stopping an in-flight request restores the draft", async () => {
  const app = await open("./App.tsx", { network: {
    [request]: { delay: 2500, headers: eventStream, body: stream(["晚到的回答"]) },
  } });
  await setKey(app);
  await ask(app, "停止这个问题");
  await app.waitFor("text:正在等待回答…");
  await app.press("id:stop");
  await app.waitFor("text:请求已停止或超时，原问题已保留。");
  expect(app.shows("晚到的回答")).toBe(false);
  expect(app.requests()).toHaveLength(1);
});

test("an incomplete SSE stream cannot enter the conversation", async () => {
  const app = await open("./App.tsx", { network: {
    [request]: { headers: eventStream, body: stream(["半句"]).replace("data: [DONE]\r\n\r\n", "") },
  } });
  await setKey(app);
  await ask(app, "测试断流");
  await app.waitFor("text:回答流中断或格式异常，请重试。");
  expect(app.shows("半句")).toBe(false);
});

test("loads account information only on request and uses a returned model", async () => {
  const app = await open("./App.tsx", { network: {
    "GET https://api.deepseek.com/user/balance": { body: JSON.stringify(accountBalance) },
    "GET https://api.deepseek.com/models": { body: JSON.stringify(accountModels) },
    [request]: { headers: eventStream, body: stream(["动态模型回答"]) },
  } });
  await setKey(app);
  expect(app.requests()).toHaveLength(0);
  await app.press("id:settings");
  await app.press("id:account");
  await app.waitFor("text:账户可用 · CNY 10.50");
  await app.waitFor("id:fixture-model");
  await app.press("id:fixture-model");
  await app.press("id:close-settings");
  await ask(app, "使用返回的模型");
  await app.waitFor("text:动态模型回答");
  expect(app.requests()).toHaveLength(3);
  expect(JSON.parse(app.requests()[2].body ?? "{}").model).toBe("fixture-model");
});

test("streams thinking and replays read-link tool state in a second turn", async () => {
  let turns = 0;
  const encoded = (choice: object) => `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
  const first = encoded({ delta: { reasoning_content: "查找资料。" } }) +
    encoded({ delta: {}, server_tool_event: { type: "step_reasoning_done", step: 0 } }) +
    encoded({ delta: { reasoning_content: "阅读完成。" } }) +
    encoded({ delta: { content: "第一份回答" } }) +
    encoded({ delta: { server_tool_calls: toolSteps, annotations: citations }, finish_reason: "stop" }) + "data: [DONE]\n\n";
  const app = await open("./App.tsx", { platform: "macos", height: 1000, network: {
    [request]: () => ({ headers: eventStream, body: ++turns === 1 ? first : stream(["第二份回答"]) }),
  } });
  await setKey(app);
  await app.press("id:thinking");
  await app.press("id:search");
  await app.press("id:read-links");
  await ask(app, "查找并读取 https://example.com/article");
  await app.waitFor("id:source-1-0");
  await app.press("id:thought-1");
  await app.waitFor("text:查找资料。阅读完成。");
  await app.press("id:source-1-0");
  expect(app.openedUrls()).toEqual(["https://example.com/article"]);
  await ask(app, "继续");
  await app.waitFor("text:第二份回答");
  const [one, two] = app.requests().map(({ body }) => JSON.parse(body ?? "{}"));
  expect(one.thinking).toEqual({ type: "enabled" });
  expect(one.tools).toEqual([{ type: "deepseek_web_search" }, { type: "deepseek_read_url" }]);
  expect(two.messages[1]).toEqual({ role: "assistant", content: "第一份回答", reasoning_content: "阅读完成。", server_tool_calls: toolSteps, annotations: citations });
});

test("search and read-link tools can each be enabled on their own", async () => {
  const app = await open("./App.tsx", { platform: "web", width: 320, network: {
    [request]: { headers: eventStream, body: stream(["工具验证完成"]) },
  } });
  await setKey(app);
  await app.press("id:search");
  await ask(app, "只搜索");
  await app.waitFor("text:工具验证完成");
  await app.press("id:search");
  await app.press("id:read-links");
  await ask(app, "只读链接");
  await app.waitUntil(() => app.requests().length === 2);
  const tools = app.requests().map(({ body }) => JSON.parse(body ?? "{}").tools);
  expect(tools).toEqual([[{ type: "deepseek_web_search" }], [{ type: "deepseek_read_url" }]]);
});

test("migrates legacy history, switches conversations, and exports without credentials", async () => {
  const app = await open("./App.tsx", { storage: { [legacyKey]: JSON.stringify(legacyConversation) }, network: {
    [request]: { headers: eventStream, body: stream(["新答案"]) },
  } });
  await app.waitFor("text:旧答案");
  expect(JSON.parse(app.storage()[historyKey]).active).toBe("legacy");
  await app.press("id:new");
  await setKey(app);
  await ask(app, "新问题");
  await app.waitFor("text:新答案");
  await app.waitUntil(() => JSON.parse(app.storage()[historyKey]).conversations.length === 2);
  await openHistory(app);
  await app.press("id:history-legacy");
  await app.waitFor("text:旧答案");
  const exported = await exportedJson(app);
  expect(JSON.parse(exported).conversations).toHaveLength(2);
  expect(exported.includes("fake-test-key") || exported.includes("do-not-export")).toBe(false);
  const reopened = await open("./App.tsx", { storage: app.storage(), network: {} });
  await reopened.waitFor("text:旧答案");
});

test("selects a PNG and PDF, uploads multipart, and references their IDs", async () => {
  let uploads = 0;
  const app = await open("./App.tsx", { network: {
    "POST https://api.deepseek.com/files": () => ({ body: JSON.stringify({ id: `file-api-fixture-${++uploads}` }) }),
    [request]: { headers: eventStream, body: stream(["附件回答"]) },
  } });
  await setKey(app);
  let next = 0;
  app.onPick(() => [[fixturePng, fixturePdf][next++]]);
  await app.press("id:attach");
  await app.waitFor("id:remove-file-0");
  await app.press("id:attach");
  await app.waitFor("id:remove-file-1");
  expect(app.requests()).toHaveLength(0);
  await ask(app, "阅读附件");
  await app.waitFor("text:附件回答");
  const [image, pdf, chat] = app.requests();
  expect(image.body?.includes("user_data")).toBe(true);
  expect(pdf.body?.includes("text_recognition")).toBe(true);
  expect((pdf.body ?? "").indexOf('name="purpose"') < (pdf.body ?? "").indexOf('name="file"')).toBe(true);
  expect(JSON.parse(chat.body ?? "{}").messages[0].content).toEqual([
    { type: "text", text: "阅读附件" }, { type: "file", file_id: "file-api-fixture-1" }, { type: "file", file_id: "file-api-fixture-2" },
  ]);
});

test("macOS loads and clears a mocked Keychain credential without persisting it", async () => {
  const calls: string[][] = [];
  const app = await open("./App.tsx", {
    platform: "macos", height: 1000, network: {},
    modules: { process: { run: (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return { code: 0, stdout: args[0] === "find-generic-password" ? "fake-vault-key\n" : "", stderr: "" };
    } } },
  });
  await app.press("id:settings");
  await app.press("id:vault-load");
  await app.waitFor("text:已从钥匙串读取。");
  await app.press("id:vault-delete");
  await app.waitFor("text:已清除钥匙串和内存中的 API Key。");
  expect(calls.map(([command, operation]) => [command, operation])).toEqual([
    ["/usr/bin/security", "find-generic-password"], ["/usr/bin/security", "delete-generic-password"],
  ]);
  expect(JSON.stringify(app.storage()).includes("fake-vault-key")).toBe(false);
  expect(app.requests()).toHaveLength(0);
});

test("invalid attachments are rejected before a request", async () => {
  const app = await open("./App.tsx", { network: {} });
  app.onPick(() => [{ ...fixturePdf, data: new TextEncoder().encode("not a PDF") }]);
  await app.press("id:attach");
  await app.waitFor("text:请选择有效的 JPEG、PNG、GIF、WebP 或 PDF 文件。");
  expect(app.requests()).toEqual([]);
});

test("a failed upload preserves the draft and retries without a chat request", async () => {
  let uploads = 0;
  const app = await open("./App.tsx", { network: {
    "POST https://api.deepseek.com/files": () => ++uploads === 1 ? { status: 429 }
      : { body: JSON.stringify({ id: "file-api-retry" }) },
    [request]: { headers: eventStream, body: stream(["上传重试成功"]) },
  } });
  await setKey(app);
  app.onPick(() => [fixturePdf]);
  await app.press("id:attach");
  await app.waitFor("id:remove-file-0");
  await ask(app, "请读 PDF");
  await app.waitFor("text:请求过于频繁，请稍后重试。");
  expect(app.requests().map(({ url }) => url)).toEqual(["https://api.deepseek.com/files"]);
  await app.press("id:send");
  await app.waitFor("text:上传重试成功");
  expect(JSON.parse(app.requests()[2].body ?? "{}").messages[0].content).toEqual([
    { type: "text", text: "请读 PDF" }, { type: "file", file_id: "file-api-retry" },
  ]);
});

test("corrupt history is preserved when a new conversation completes", async () => {
  const app = await open("./App.tsx", { storage: { [historyKey]: "invalid JSON" }, network: {
    [request]: { headers: eventStream, body: stream(["内存回答"]) },
  } });
  await app.waitFor("text:无法读取历史，原记录保留。新对话仅存于内存。");
  await setKey(app);
  await ask(app, "内存问题");
  await app.waitFor("text:内存回答");
  expect(app.storage()[historyKey]).toBe("invalid JSON");
});

test("plain thinking mode sends the previous answer but not its reasoning", async () => {
  let turns = 0;
  const app = await open("./App.tsx", { network: {
    [request]: () => ({ headers: eventStream, body: ++turns === 1
      ? 'data: {"choices":[{"delta":{"reasoning_content":"思考草稿"}}]}\n\n' + stream(["首轮完成"])
      : stream(["续轮完成"]) }),
  } });
  await setKey(app);
  await app.press("id:thinking");
  await ask(app, "首轮问题");
  await app.waitFor("text:首轮完成");
  await ask(app, "续轮问题");
  await app.waitFor("text:续轮完成");
  expect(JSON.parse(app.requests()[1].body ?? "{}").messages[1]).toEqual({ role: "assistant", content: "首轮完成" });
});

const originalStorage = { [historyKey]: JSON.stringify(localHistory) };
const importFailure = "导入保存失败，可能是存储空间不足。现有历史和草稿已保留。";

async function openData(app: App) {
  if (!app.shows("id:settings-tab-data")) await app.press("id:settings");
  if (!app.shows("id:import")) await app.press("id:settings-tab-data");
}

async function previewJson(app: App, json: string) {
  await openData(app);
  await app.press("id:import");
  await app.paste("id:import-json", { text: json });
  await app.press("id:preview-import");
}

async function exportedJson(app: App) {
  await openData(app);
  await app.press("id:export");
  await app.waitFor("text:已复制历史 JSON。");
  return app.clipboard() ?? "";
}

test("imports a v2 backup locally, reopens it and exports all supported fields", async () => {
  const app = await open("./App.tsx", { storage: originalStorage, network: {}, platform: "web", width: 320 });
  await app.waitFor("text:本机答案");
  await setKey(app);
  await app.type("id:question", "尚未发送的草稿");
  app.onPick(() => [fixturePdf]);
  await app.press("id:attach");
  await app.waitFor("id:remove-file-0");

  await previewJson(app, JSON.stringify(importHistoryFixture, null, 2));
  await app.waitFor("text:v2 · 新增 1 · 重复 1 · ID 冲突 1");
  expect(app.storage()).toEqual(originalStorage);
  await app.press("id:confirm-import");
  await app.waitFor("text:已导入 1 个对话。");
  expect(app.shows("text:本机答案")).toBe(true);
  expect(app.value("id:question")).toBe("尚未发送的草稿");
  expect(app.shows("id:remove-file-0")).toBe(true);

  const backup = await exportedJson(app);
  const persisted = app.storage();
  for (const form of ["object", "pair"]) {
    const marker = `${fixtureHeaderToken}-${form}`;
    expect([persisted[historyKey].includes(marker), backup.includes(marker)]).toEqual([false, false]);
  }
  for (const marker of ["fake-test-key", "fixture-embedded-key", "fixture-raw-bytes", "fixture-tool-key", "fixture-tool-bytes",
    fixtureHeaderToken, fixturePdfBase64, "data:application/pdf"]) {
    expect(backup.includes(marker)).toBe(false);
    expect(app.storage()[historyKey].includes(marker)).toBe(false);
  }
  const saved = JSON.parse(backup);
  expect(saved.active).toBe("local");
  expect(saved.conversations).toHaveLength(2);
  expect(saved.conversations[0]).toEqual(localHistory.conversations[0]);
  const imported = saved.conversations[1];
  expect(imported.id === "local").toBe(false);
  const messages = [
    { role: "user", content: "备份问题", attachments: [{ id: "file-backup", name: "备份.pdf" }] },
    { role: "assistant", content: "备份答案", reasoning_content: "最后一步", thinkingText: "完整思考",
      annotations: citations, server_tool_calls: backupToolSteps },
  ];
  expect(imported.messages).toEqual(messages);
  expect(JSON.parse(persisted[historyKey])).toEqual(saved);

  // Replaying either the original or the app's own export must not create copies.
  for (const [text, duplicates] of [[JSON.stringify(importHistoryFixture), 2], [backup, 2]] as const) {
    await previewJson(app, text);
    await app.waitFor(`text:v2 · 新增 0 · 重复 ${duplicates} · ID 冲突 0`);
    await app.press("id:confirm-import");
    await app.waitFor("text:没有新增对话。");
    expect(app.storage()).toEqual(persisted);
  }

  const reopened = await open("./App.tsx", { storage: persisted, network: {} });
  await reopened.waitFor("text:本机答案");
  await openHistory(reopened);
  await reopened.press(`id:history-${imported.id}`);
  await reopened.waitFor("text:备份答案");
  await reopened.waitFor("text:备份.pdf");
  await reopened.waitFor("id:source-1-0");
  await reopened.press("id:thought-1");
  await reopened.waitFor("text:完整思考");
  const reexport = JSON.parse(await exportedJson(reopened));
  expect(reexport).toEqual({ ...saved, active: imported.id });
  expect([...app.requests(), ...reopened.requests()]).toEqual([]);
});

for (const [format, source] of [["v1", legacyConversation], ["单会话数组", legacyConversation.messages]] as const) {
  test(`imports ${format} and retains it after reopening`, async () => {
    const app = await open("./App.tsx", { network: {} });
    await app.waitFor("text:砚台");
    await previewJson(app, JSON.stringify(source));
    await app.waitFor(`text:${format} · 新增 1 · 重复 0 · ID 冲突 0`);
    await app.press("id:confirm-import");
    await app.waitFor("text:已导入 1 个对话。");
    expect(JSON.parse(app.storage()[historyKey]).active).toBe(null);
    const reopened = await open("./App.tsx", { storage: app.storage(), network: {} });
    await reopened.waitFor("id:question");
    await openHistory(reopened);
    await reopened.press("id:history-legacy");
    await reopened.waitFor("text:旧答案");
    const exported = await exportedJson(reopened);
    expect(JSON.parse(exported).conversations[0].messages).toEqual(legacyConversation.messages);
    expect(exported.includes("do-not-export")).toBe(false);
    expect([...app.requests(), ...reopened.requests()]).toEqual([]);
  });
}

test("cancel and invalid backup data preserve the active conversation, draft, and storage", async () => {
  const app = await open("./App.tsx", { storage: originalStorage, network: {} });
  await app.waitFor("text:本机答案");
  await app.type("id:question", "保留的草稿");
  app.onPick(() => [fixturePdf]);
  await app.press("id:attach");
  await app.waitFor("id:remove-file-0");
  await previewJson(app, JSON.stringify(importHistoryFixture));
  await app.waitFor("id:confirm-import");
  expect(app.shows("id:remove-file-0")).toBe(false);
  await app.press("id:cancel-import");
  await app.waitFor("id:remove-file-0");
  expect(app.storage()).toEqual(originalStorage);
  for (const [json, error] of [
    ["{", "JSON 格式无效，请检查粘贴内容。"],
    [JSON.stringify({ version: 3, messages: legacyConversation.messages }), "不支持的历史版本。"],
    [JSON.stringify({ version: 2, conversations: [localHistory.conversations[0], localHistory.conversations[0]] }), "无效的历史记录。"],
    [JSON.stringify({ version: 1, messages: [{ role: "system", content: "bad" }] }), "无效的消息。"],
  ]) {
    await previewJson(app, json);
    await app.waitFor(`text:${error}`);
    expect(app.shows("id:confirm-import")).toBe(false);
    expect(app.storage()).toEqual(originalStorage);
    await app.press("id:cancel-import");
    expect(app.shows("text:本机答案")).toBe(true);
    expect(app.value("id:question")).toBe("保留的草稿");
  }
  expect(JSON.parse(await exportedJson(app))).toEqual(localHistory);
  expect(app.requests()).toEqual([]);
});

for (const [format, stored] of [
  ["corrupt", "invalid JSON"],
  ["unknown-version", JSON.stringify({ ...localHistory, version: 3 })],
] as const) {
  test(`import leaves ${format} local history untouched`, async () => {
    const storage = { [historyKey]: stored, [legacyKey]: JSON.stringify(legacyConversation) };
    const app = await open("./App.tsx", { storage, network: {} });
    await app.waitFor("text:无法读取历史，原记录保留。新对话仅存于内存。");
    await app.type("id:question", "原有草稿");
    await openData(app);
    await app.press("id:import");
    await app.waitFor("text:无法导入：本地历史不可读取，原记录保留。");
    expect(app.shows("id:import-json")).toBe(false);
    expect(app.value("id:question")).toBe("原有草稿");
    expect(app.storage()).toEqual(storage);
    expect(app.requests()).toEqual([]);
  });
}

test("the Storage quota rejects import atomically and keeps the old history usable", async () => {
  const storage = { ...originalStorage, filler: "x".repeat(5 * 1024 * 1024 - 420) };
  const app = await open("./App.tsx", { storage, network: {} });
  await app.waitFor("text:本机答案");
  await app.type("id:question", "容量失败后保留");
  await previewJson(app, JSON.stringify(importHistoryFixture));
  await app.waitFor("id:confirm-import");
  await app.press("id:confirm-import");
  await app.waitFor(`text:${importFailure}`);
  expect(app.storage()[historyKey]).toBe(storage[historyKey]);
  expect(app.storage().filler.length).toBe(storage.filler.length);
  await app.press("id:cancel-import");
  expect(app.value("id:question")).toBe("容量失败后保留");
  expect(app.shows("text:本机答案")).toBe(true);
  expect(JSON.parse(await exportedJson(app))).toEqual(localHistory);
  const reopened = await open("./App.tsx", { storage: app.storage(), network: {} });
  await reopened.waitFor("text:本机答案");
  expect([...app.requests(), ...reopened.requests()]).toEqual([]);
});

test("history writes wait for earlier writes and recover from rejection", async () => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started: (string | null)[] = [];
  const enqueue = createHistoryWriter(async ({ active }) => {
    started.push(active);
    if (active === "earlier") await blocked;
    if (active === "import") throw new Error("fixture write rejection");
  });
  const enqueueWrite = (active: string) => enqueue({ ...emptyHistory(), active });
  const earlier = enqueueWrite("earlier");
  const failed = enqueueWrite("import").then(() => "success", (error: Error) => error.message);
  const retry = enqueueWrite("retry");
  await Promise.resolve();
  expect(started).toEqual(["earlier"]);
  release();
  await earlier;
  expect(await failed).toBe("fixture write rejection");
  await retry;
  expect(started).toEqual(["earlier", "import", "retry"]);
});
