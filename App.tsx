import { Clipboard, colorScheme, List, mount, openUrl, Picker, Scroll, signal, Text, View, windowSize } from "nsh";
import { Input } from "nsh/base";
import { complete, loadBalance, loadModels, models, sourceUrl, type Attachment, type Message, type Model } from "./deepseek";

import { conversationTitle, createHistoryWriter, emptyHistory, exportHistory, mergeHistory, parseHistory, restoreHistory, type History } from "./history";

import { attachmentFilters, uploadAttachment, validateAttachment } from "./attachments";

import { deleteCredential, hasCredentialVault, loadCredential, saveCredential } from "./credentials";

// 配色与布局见 DESIGN.md。
const palettes = {
  light: {
    canvas: "#EEF2F4", rail: "#E2E9EC", surface: "#FAFCFD", inset: "#F0F5F6",
    ink: "#1D2931", muted: "#485B66", line: "#B7C6CE", accent: "#17645F",
    accentSoft: "#D4E9E5", onAccent: "#FFFFFF", danger: "#A33642", veil: "rgba(16,29,37,0.48)",
  },
  dark: {
    canvas: "#162027", rail: "#10191F", surface: "#202D35", inset: "#19262D",
    ink: "#EDF4F6", muted: "#B2C3CB", line: "#51656F", accent: "#87D5C5",
    accentSoft: "#294843", onAccent: "#102C28", danger: "#FFADB6", veil: "rgba(4,10,14,0.68)",
  },
};
const colors = () => palettes[colorScheme()];

function Toggle(props: { key?: string; label: string; testID: string; selected: boolean; action: () => void }) {
  return (
    <View testID={props.testID} role="button" accessibilityState={{ pressed: props.selected }} onPress={props.action}
      class="min-h-9 flex-row items-center gap-2 rounded-md border px-2.5 py-1"
      style={{ borderColor: props.selected ? colors().accent : colors().line, backgroundColor: props.selected ? colors().accentSoft : colors().surface }}>
      <View class="h-2 w-2 rounded-sm border"
        style={{ borderColor: props.selected ? colors().accent : colors().muted, backgroundColor: props.selected ? colors().accent : "transparent" }} />
      <Text class="text-[13px] font-medium" style={{ color: props.selected ? colors().accent : colors().ink }}>{props.label}</Text>
    </View>
  );
}

function Action(props: { label: string; testID: string; action: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <View testID={props.testID} role="button" accessibilityState={{ disabled: props.disabled }}
      onPress={props.disabled ? undefined : props.action} class="min-h-10 shrink-0 flex-row items-center justify-center rounded-md border px-3 py-1"
      style={{ borderColor: props.primary ? colors().accent : colors().line, backgroundColor: props.primary ? colors().accent : colors().surface }}>
      <Text class="text-sm font-medium" style={{ color: props.primary ? colors().onAccent : props.disabled ? colors().muted : colors().ink }}>{props.label}</Text>
    </View>
  );
}

function App() {
  const key = signal("");
  const model = signal<Model>(models[0]);
  const availableModels = signal<readonly string[]>(models);
  const balance = signal("");
  const modelStatus = signal("");
  const thinking = signal(false);
  const search = signal(false);
  const readLinks = signal(false);
  const partialThinking = signal("");
  const expandedThinking = signal<Record<number, boolean>>({});
  let accountRequest: AbortController | undefined;

  const files = signal<{ file: File; uploaded?: Attachment }[]>([]);
  const picking = signal(false);
  const phase = signal("");

  const question = signal("");
  const messages = signal<Message[]>([]);
  const partial = signal("");
  const activeQuestion = signal("");
  const status = signal("");
  const busy = signal(false);
  const settings = signal(false);
  const settingsTab = signal<"general" | "data">("general");
  const drawer = signal(false);
  let controller: AbortController | undefined;

  const history = signal(emptyHistory());
  const historyStatus = signal("");
  const historyReady = signal(false);
  const exportPreview = signal("");
  const importOpen = signal(false);
  const importText = signal("");
  const importPreview = signal<(ReturnType<typeof mergeHistory> & { format: ReturnType<typeof parseHistory>["format"] }) | null>(null);
  const importError = signal("");
  const importing = signal(false);
  let historyWritable = true;
  const enqueueHistoryWrite = createHistoryWriter();
  let writeGeneration = 0;
  let nextConversation = 0;

  const vaultStatus = signal("");
  const vaultBusy = signal(false);

  const narrow = () => windowSize().width < 720;

  void restoreHistory().then((restored) => {
    history.set(restored);
    messages.set(restored.conversations.find(({ id }) => id === restored.active)?.messages ?? []);
  }).catch(() => {
    historyWritable = false;
    historyStatus.set("无法读取历史，原记录保留。新对话仅存于内存。");
  }).finally(() => historyReady.set(true));

  function setKey(value: string) {
    accountRequest?.abort();
    accountRequest = undefined;
    if (key() !== value) files.update((all) => all.map(({ file }) => ({ file })));
    key.set(value);
    availableModels.set(models);
    if (!availableModels().includes(model())) model.set(models[0]);
    balance.set("");
    modelStatus.set("");
  }

  async function refreshAccount() {
    const token = key().trim();
    if (!token) {
      balance.set("请先填写 API Key。");
      return;
    }
    accountRequest?.abort();
    const request = new AbortController();
    accountRequest = request;
    balance.set("正在加载余额…");
    modelStatus.set("正在加载模型…");
    const timeout = setTimeout(() => request.abort(), 20_000);
    await Promise.all([
      loadBalance(token, request.signal).then((result) => {
        if (accountRequest === request) balance.set(result);
      }).catch((error: Error) => {
        if (accountRequest === request) balance.set(`余额加载失败 · ${error.message}`);
      }),
      loadModels(token, request.signal).then((result) => {
        if (accountRequest !== request) return;
        availableModels.set(result);
        if (!result.includes(model())) model.set(result[0]);
        modelStatus.set("模型已更新");
      }).catch((error: Error) => {
        if (accountRequest === request) modelStatus.set(`模型加载失败 · ${error.message}`);
      }),
    ]);
    clearTimeout(timeout);
    if (accountRequest === request) accountRequest = undefined;
  }

  async function pickAttachment() {
    if (busy() || picking() || importOpen()) return;
    if (files().length >= 4) { status.set("每轮最多选四个附件。"); return; }
    picking.set(true);
    try {
      const [chosen] = await Picker.pickFiles({ filters: attachmentFilters });
      if (!chosen) return;
      await validateAttachment(chosen.file);
      files.update((all) => [...all, { file: chosen.file }]);
      status.set("");
    } catch (error) {
      status.set(error instanceof Error ? error.message : "无法选择附件。");
    } finally {
      picking.set(false);
    }
  }

  async function manageCredential(action: "load" | "save" | "delete") {
    if (vaultBusy() || busy()) return;
    const token = key().trim();
    if (action === "save" && !token) {
      vaultStatus.set("请先填写 API Key。");
      return;
    }
    vaultBusy.set(true);
    vaultStatus.set("正在操作钥匙串…");
    try {
      if (action === "load") {
        const stored = await loadCredential();
        if (stored) setKey(stored);
        vaultStatus.set(stored ? "已从钥匙串读取。" : "钥匙串中没有保存的 API Key。");
      } else if (action === "save") {
        await saveCredential(token);
        vaultStatus.set("已保存到 macOS 钥匙串。");
      } else {
        await deleteCredential();
        setKey("");
        vaultStatus.set("已清除钥匙串和内存中的 API Key。");
      }
    } catch {
      vaultStatus.set("钥匙串操作失败，请检查 macOS 钥匙串权限与锁定状态。");
    } finally {
      vaultBusy.set(false);
    }
  }

  function updateHistory(next: History) {
    history.set(next);
    if (!historyWritable) return;
    const generation = ++writeGeneration;
    void enqueueHistoryWrite(next).then(() => {
      if (writeGeneration === generation) historyStatus.set("");
    }).catch(() => {
      if (writeGeneration === generation) historyStatus.set("历史保存失败，仍可导出本次对话。");
    });
  }

  function openImport() {
    if (!historyReady() || busy() || picking() || importOpen()) return;
    if (!historyWritable) {
      historyStatus.set("无法导入：本地历史不可读取，原记录保留。");
      return;
    }
    drawer.set(false);
    exportPreview.set("");
    importOpen.set(true);
  }

  function closeImport() {
    importOpen.set(false);
    importText.set("");
    importPreview.set(null);
    importError.set("");
  }

  function previewImport() {
    importPreview.set(null);
    importError.set("");
    try {
      const parsed = parseHistory(importText());
      importPreview.set({ ...mergeHistory(history(), parsed.history), format: parsed.format });
    } catch (error) {
      importError.set(error instanceof Error ? error.message : "无法读取导入记录。");
    }
  }

  async function confirmImport() {
    const preview = importPreview();
    if (!preview || importing()) return;
    importing.set(true);
    importError.set("");
    try {
      if (preview.added) {
        await enqueueHistoryWrite(preview.history);
        history.set(preview.history);
      }
      closeImport();
      if (preview.added) historyStatus.set(`已导入 ${preview.added} 个对话。`);
      else status.set("没有新增对话。");
    } catch {
      importError.set("导入保存失败，可能是存储空间不足。现有历史和草稿已保留。");
    } finally {
      importing.set(false);
    }
  }

  function storeConversation(next: Message[]) {
    messages.set(next);
    const now = Date.now();
    let id = history().active;
    if (id === null) {
      do { id = `${now}-${++nextConversation}`; } while (history().conversations.some((entry) => entry.id === id));
    }
    updateHistory({ version: 2, active: id, conversations: [
      { id, updatedAt: now, messages: next }, ...history().conversations.filter((item) => item.id !== id),
    ] });
  }

  function selectConversation(id: string) {
    if (!historyReady() || busy() || picking() || importOpen()) return;
    const entry = history().conversations.find((item) => item.id === id);
    if (!entry) return;
    updateHistory({ ...history(), active: id });
    messages.set(entry.messages);
    question.set("");
    files.set([]);
    expandedThinking.set({});
    status.set("");
    drawer.set(false);
  }

  async function copyHistory() {
    const json = exportHistory(history());
    exportPreview.set("");
    try {
      await Clipboard.writeText(json);
      status.set("已复制历史 JSON。");
    } catch {
      exportPreview.set(json);
      status.set("无法自动复制。可手动选中下方 JSON。");
    }
  }

  async function send(text = question()) {
    if (controller || vaultBusy() || picking() || !historyReady() || importOpen()) return;
    const content = text.trim();
    if (!content) return;
    const token = key().trim();
    const selectedModel = model();
    const options = { thinking: thinking(), search: search(), readLinks: readLinks() };
    if (!token) {
      drawer.set(false);
      settingsTab.set("general");
      settings.set(true);
      status.set("请先填写 API Key。");
      return;
    }
    if ((options.search || options.readLinks) && selectedModel !== models[0]) {
      status.set("搜索或读链接需要 DeepSeek Flash。");
      return;
    }
    const pending = files();
    if ((pending.length || messages().some((message) => message.attachments?.length)) && selectedModel !== models[0]) {
      status.set("带附件的对话需要 DeepSeek Flash。");
      return;
    }
    const turn: Message = { role: "user", content };
    const context = [...messages(), turn];
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), pending.length ? 600_000 : 120_000);
    let answer = "";
    busy.set(true);
    activeQuestion.set(content);
    question.set("");
    partial.set("");
    status.set("");
    try {
      if (pending.length) {
        const uploaded: Attachment[] = [];
        for (const [index, item] of pending.entries()) {
          if (request.signal.aborted) throw new Error("上传已停止。");
          phase.set(`正在上传附件 ${index + 1}/${pending.length}…`);
          const attachment = item.uploaded ?? await uploadAttachment(item.file, token, request.signal);
          uploaded.push(attachment);
          if (key().trim() === token) files.update((all) => all.map((entry, i) => i === index ? { ...entry, uploaded: attachment } : entry));
        }
        turn.attachments = uploaded;
      }
      phase.set("");
      if (request.signal.aborted) throw new Error("请求已停止。");
      const response = await complete(token, selectedModel, context, request.signal, (delta) => {
        if (request.signal.aborted) return;
        answer += delta;
        partial.set(answer);
      }, options, (text) => {
        if (!request.signal.aborted) partialThinking.set(text);
      });
      if (request.signal.aborted || !response.content.trim()) throw new Error("没有收到完整回答。");
      storeConversation([...context, response]);
      files.set([]);
    } catch (error) {
      if (!question()) question.set(content);
      status.set(request.signal.aborted ? "请求已停止或超时，原问题已保留。" :
        error instanceof Error ? error.message : "请求失败，请重试。");
    } finally {
      clearTimeout(timeout);
      controller = undefined;
      activeQuestion.set("");
      partial.set("");
      partialThinking.set("");
      phase.set("");
      busy.set(false);
    }
  }

  function reset() {
    if (busy() || picking() || !historyReady() || importOpen()) return;
    updateHistory({ ...history(), active: null });
    drawer.set(false);
    messages.set([]);
    expandedThinking.set({});
    question.set("");
    files.set([]);
    status.set("");
  }

  const shown = () => busy()
    ? [...messages(), { role: "user", content: activeQuestion() } as Message,
      { role: "assistant", content: partial() || phase() || "正在等待回答…", thinkingText: partialThinking() } as Message]
    : messages();

  function Composer() {
    return (
      <View class="w-full">
        {status() && !settings() ? <Text class="px-1 pb-2 text-[13px]" style={{ color: colors().danger }}>{status()}</Text> : null}
        {historyStatus() && !settings() ? <Text class="px-1 pb-2 text-[13px]" style={{ color: colors().muted }}>{historyStatus()}</Text> : null}
        <View class="w-full rounded-lg border" style={{ borderColor: colors().line, backgroundColor: colors().surface }}>
          {files().length ? <View class="flex-row flex-wrap gap-2 px-3 pt-3">
            {files().map(({ file }, index) => busy() || importOpen()
              ? <View class="max-w-full rounded-md border px-2 py-1" style={{ borderColor: colors().line }}>
                <Text class="text-[13px]" style={{ color: colors().muted }}>{file.name}</Text>
              </View>
              : <View testID={`remove-file-${index}`} role="button" accessibilityLabel={`移除附件 ${file.name}`}
                onPress={() => files.update((all) => all.filter((_, i) => i !== index))}
                class="max-w-full rounded-md border px-2 py-1" style={{ borderColor: colors().line }}>
                <Text class="text-[13px]" style={{ color: colors().ink }}>{file.name} ×</Text>
              </View>)}
          </View> : null}
          <Input testID="question" accessibilityLabel="对话输入" disabled={busy() || !historyReady() || importOpen()}
            multiline submitBehavior="submit" placeholder="写下你的问题或想法" value={question()}
            onChange={(e) => question.set(e.value)} onSubmit={(e) => void send(e.text)}
            class="min-h-[72px] w-full px-3 pt-3 text-base leading-6"
            style={{ color: colors().ink, placeholderColor: colors().muted }} />
          <View class="flex-row flex-wrap items-center justify-between gap-2 border-t p-2"
            style={{ borderColor: colors().line, backgroundColor: colors().inset }}>
            <View class="flex-row flex-wrap items-center gap-1.5">
              <Toggle label="思考" testID="thinking" selected={thinking()} action={() => thinking.update((on) => !on)} />
              <Toggle label="搜索" testID="search" selected={search()} action={() => search.update((on) => !on)} />
              <Toggle label="读链接" testID="read-links" selected={readLinks()} action={() => readLinks.update((on) => !on)} />
            </View>
            <View class="ml-auto flex-row items-center gap-2">
              {!busy() && !importOpen() ? <Action testID="attach" label={picking() ? "选择中…" : "附件"} disabled={picking()} action={() => void pickAttachment()} /> : null}
              {busy() ? <Action testID="stop" label="停止" primary action={() => controller?.abort()} /> : (
                <Action testID="send" label="发送" primary={Boolean(question().trim())}
                  disabled={!question().trim() || !historyReady() || importOpen()} action={() => void send()} />
              )}
            </View>
          </View>
        </View>
      </View>
    );
  }

  function Bubble(props: { message: Message; index: number }) {
    const m = props.message;
    if (m.role === "user") {
      return (
        <View class="items-end pb-4">
          {m.attachments?.length ? <View class="mb-2 flex-row flex-wrap justify-end gap-2">
            {m.attachments.map((file) => <View class="rounded-md border px-3 py-2" style={{ borderColor: colors().line }}>
              <Text class="text-[12px]" style={{ color: colors().muted }}>{file.name}</Text>
            </View>)}
          </View> : null}
          <View class="rounded-md border-l-2 px-4 py-3" style={{ maxWidth: "88%", borderColor: colors().accent, backgroundColor: colors().accentSoft }}>
            <View selectable><Text class="text-base leading-6" style={{ color: colors().ink }}>{m.content}</Text></View>
          </View>
        </View>
      );
    }
    return (
      <View class="gap-2 pb-6">
        {m.thinkingText ? <View class="gap-1">
          <View testID={`thought-${props.index}`} role="button"
            onPress={() => expandedThinking.update((value) => ({ ...value, [props.index]: !value[props.index] }))}
            class="flex-row items-center gap-1 self-start rounded-md border px-3 py-1" style={{ borderColor: colors().line }}>
            <Text class="text-[13px]" style={{ color: colors().muted }}>{expandedThinking()[props.index] ? "收起思考" : "查看思考"}</Text>
          </View>
          {expandedThinking()[props.index] ? <View selectable><Text class="text-sm leading-[22px]" style={{ color: colors().muted }}>{m.thinkingText}</Text></View> : null}
        </View> : null}
        <View selectable><Text class="text-base leading-7" style={{ color: colors().ink }}>{m.content}</Text></View>
        {m.annotations?.length ? <View class="flex-row flex-wrap gap-2">
          {m.annotations.map((annotation, i) => {
            const citation = annotation?.type === "url_citation" ? annotation.url_citation : undefined;
            const href = citation && sourceUrl(citation.url);
            return href ? <View testID={`source-${props.index}-${i}`} role="button"
              onPress={() => void openUrl(href).then(({ opened }) => {
                if (!opened) status.set("无法打开引用链接。");
              }).catch(() => status.set("无法打开引用链接。"))}
              class="max-w-full rounded-md border px-3 py-1" style={{ borderColor: colors().line }}>
              <Text class="text-[12px]" style={{ color: colors().muted }}>{`[${i + 1}] ${citation.title || href}`}</Text>
            </View> : null;
          })}
        </View> : null}
      </View>
    );
  }

  function Sidebar(props: { overlay?: boolean }) {
    return (
      <View testID="history-panel" class="shrink-0 flex-col gap-4 border-r p-3.5"
        style={{ width: props.overlay ? Math.min(280, windowSize().width - 44) : 244, borderColor: colors().line, backgroundColor: colors().rail }}>
        <View class="flex-row items-center justify-between gap-2 pt-2">
          <Text class="text-xl font-semibold" style={{ color: colors().ink }}>{props.overlay ? "对话历史" : "砚台"}</Text>
          {props.overlay ? <Action testID="close-drawer" label="关闭" action={() => drawer.set(false)} /> : null}
        </View>
        {!props.overlay ? <Action testID="new" label="＋ 新对话" primary action={reset} /> : null}
        <View class="min-h-0 flex-1 gap-2">
          {!props.overlay ? <Text class="text-[13px] font-medium" style={{ color: colors().muted }}>对话历史</Text> : null}
          <List class="min-h-0 flex-1" contentClass="gap-1" each={history().conversations}
            empty={() => <Text class="text-sm" style={{ color: colors().muted }}>暂无历史对话</Text>}>
            {(item) => {
              const active = () => history().active === item().id;
              return (
                <View testID={`history-${item().id}`} role="button" accessibilityState={{ current: active() }} onPress={() => selectConversation(item().id)}
                  class="h-10 flex-row items-center rounded-r-md border-l-2 px-2.5"
                  style={{ borderColor: active() ? colors().accent : "transparent", backgroundColor: active() ? colors().accentSoft : "transparent" }}>
                  <Text class="truncate text-sm" style={{ color: active() ? colors().accent : colors().ink }}>{conversationTitle(item())}</Text>
                </View>
              );
            }}
          </List>
        </View>
        {!props.overlay ? <Action testID="settings" label="设置" action={() => settings.set(true)} /> : null}
      </View>
    );
  }

  function SettingsPanel() {
    const tab = () => settingsTab();
    const navItem = (id: "general" | "data", label: string) => (
      <View testID={`settings-tab-${id}`} role="tab" accessibilityState={{ selected: tab() === id }} onPress={() => settingsTab.set(id)}
        class="h-10 flex-1 flex-row items-center justify-center border-b-2 px-3"
        style={{ borderColor: tab() === id ? colors().accent : colors().line, backgroundColor: tab() === id ? colors().accentSoft : colors().inset }}>
        <Text class="text-sm font-medium" style={{ color: tab() === id ? colors().accent : colors().ink }}>{label}</Text>
      </View>
    );
    return (
      <View class="absolute inset-0 flex-row justify-end" style={{ zIndex: 20, backgroundColor: colors().veil }}>
        <View testID="settings-panel" role="dialog" accessibilityLabel="设置"
          class="min-h-0 w-full flex-col border-l pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          style={{ maxWidth: 510, borderColor: colors().line, backgroundColor: colors().surface }}>
          <View class="flex-row items-center justify-between gap-3 px-4 py-3">
            <Text class="text-xl font-semibold" style={{ color: colors().ink }}>设置</Text>
            <Action testID="close-settings" label="关闭" action={() => { settings.set(false); closeImport(); }} />
          </View>
          <View role="tablist" class="flex-row gap-1 px-4">
            {navItem("general", "连接")}
            {navItem("data", "备份")}
          </View>
          <Scroll class="min-h-0 flex-1"><View class="flex-col px-4 py-2">
            {tab() === "general" ? (
              <View>
                <View class="flex-col gap-2 py-4">
                  <Text class="text-sm" style={{ color: colors().ink }}>API Key</Text>
                  {status() === "请先填写 API Key。" ? <Text class="text-[13px]" style={{ color: colors().danger }}>{status()}</Text> : null}
                  <View class="h-11 flex-row items-center rounded-md border px-3" style={{ borderColor: colors().line, backgroundColor: colors().inset }}>
                    <Input testID="key" accessibilityLabel="API Key" disabled={vaultBusy()} masked autoComplete="off" autoCorrect={false} autoCapitalize="none"
                      value={key()} placeholder="sk-…" onChange={(e) => setKey(e.value)}
                      class="h-10 flex-1 text-sm" style={{ color: colors().ink, placeholderColor: colors().muted }} />
                  </View>
                  <Text class="text-[12px] leading-[18px]" style={{ color: colors().muted }}>
                    {hasCredentialVault() ? "密钥可保存到 macOS 钥匙串，仅在本机使用。" : "密钥仅保留在当前会话内存中。"}
                  </Text>
                  {hasCredentialVault() ? <View class="flex-row flex-wrap gap-2">
                    <Action label="读取" testID="vault-load" action={() => void manageCredential("load")} />
                    <Action label="保存" testID="vault-save" action={() => void manageCredential("save")} />
                    <Action label="清除" testID="vault-delete" action={() => void manageCredential("delete")} />
                  </View> : null}
                  {vaultStatus() ? <Text class="text-[12px]" style={{ color: colors().muted }}>{vaultStatus()}</Text> : null}
                </View>
                <View class="flex-col gap-2 border-t py-4" style={{ borderColor: colors().line }}>
                  <View class="flex-row flex-wrap items-center justify-between gap-2">
                    <View class="min-w-0 flex-1 flex-col">
                      <Text class="text-sm" style={{ color: colors().ink }}>账户余额与模型</Text>
                      <Text class="text-[12px] leading-[18px]" style={{ color: colors().muted }}>直连 api.deepseek.com 查询，不经过第三方。</Text>
                    </View>
                    <Action label="加载" testID="account" action={() => void refreshAccount()} />
                  </View>
                  {balance() ? <Text class="text-[12px]" style={{ color: colors().muted }}>{balance()}</Text> : null}
                  {modelStatus() ? <Text class="text-[12px]" style={{ color: colors().muted }}>{modelStatus()}</Text> : null}
                </View>
                <View class="flex-col gap-2 border-t py-4" style={{ borderColor: colors().line }}>
                  <Text class="text-sm" style={{ color: colors().ink }}>模型</Text>
                  <View class="flex-row flex-wrap gap-2">
                    {availableModels().map((name) => (
                      <Toggle key={name} label={name === models[0] ? "DeepSeek Flash" : name === models[1] ? "DeepSeek V4 Pro" : name}
                        testID={name} selected={model() === name} action={() => model.set(name)} />
                    ))}
                  </View>
                </View>
              </View>
            ) : (
              <View>
                <View class="flex-col gap-2 py-4">
                  <Text class="text-sm" style={{ color: colors().ink }}>导入历史对话</Text>
                  <Text class="text-[12px] leading-[18px]" style={{ color: colors().muted }}>
                    导入会合并到本机历史，支持砚台 v2 JSON、旧版 v1 与单会话数组。
                  </Text>
                  <View class="flex-row flex-wrap gap-2">
                    <Action label={importOpen() ? "取消导入" : "导入"} testID="import" action={() => importOpen() ? closeImport() : openImport()} />
                  </View>
                  {importOpen() ? <View class="gap-2">
                    <Input testID="import-json" accessibilityLabel="历史 JSON" multiline disabled={importing()} placeholder="粘贴历史 JSON"
                      autoComplete="off" autoCorrect={false} autoCapitalize="none"
                      value={importText()} onChange={(e) => {
                        if (importing()) return;
                        importText.set(e.value);
                        importPreview.set(null);
                        importError.set("");
                      }}
                      class="h-28 w-full rounded-md border px-3 py-2 text-[13px]"
                      style={{ borderColor: colors().line, color: colors().ink, backgroundColor: colors().inset, placeholderColor: colors().muted }} />
                    {importPreview() ? <Text testID="import-summary" class="text-[12px]" style={{ color: colors().muted }}>
                      {`${importPreview()!.format} · 新增 ${importPreview()!.added} · 重复 ${importPreview()!.duplicates} · ID 冲突 ${importPreview()!.conflicts}`}
                    </Text> : null}
                    {importError() ? <Text class="text-[12px]" style={{ color: colors().danger }}>{importError()}</Text> : null}
                    {importing() ? <Text class="text-[12px]" style={{ color: colors().muted }}>正在保存导入记录…</Text>
                      : <View class="flex-row flex-wrap gap-2">
                        <Action label="校验 JSON" testID="preview-import" action={previewImport} />
                        {importPreview() ? <Action label="确认导入" testID="confirm-import" action={() => void confirmImport()} /> : null}
                        <Action label="取消" testID="cancel-import" action={closeImport} />
                      </View>}
                  </View> : null}
                </View>
                <View class="flex-col gap-2 border-t py-4" style={{ borderColor: colors().line }}>
                  <View class="flex-row items-center justify-between gap-2">
                    <View class="min-w-0 flex-1 flex-col">
                      <Text class="text-sm" style={{ color: colors().ink }}>导出所有历史对话</Text>
                      <Text class="text-[12px] leading-[18px]" style={{ color: colors().muted }}>含正文、思考、引用与附件元数据，不含密钥和内嵌附件数据。</Text>
                    </View>
                    <Action label="导出" testID="export" action={() => void copyHistory()} />
                  </View>
                </View>
                {status() ? <Text class="pb-2 text-[12px]" style={{ color: colors().muted }}>{status()}</Text> : null}
                {historyStatus() ? <Text class="pb-2 text-[12px]" style={{ color: colors().muted }}>{historyStatus()}</Text> : null}
                {exportPreview() ? <View class="gap-2 py-2">
                  <Action label="关闭预览" testID="close-export" action={() => exportPreview.set("")} />
                  <List class="h-[128px] shrink-0" each={[exportPreview()]}>
                    {(json) => <View selectable><Text class="text-[12px]" style={{ color: colors().ink }}>{json()}</Text></View>}
                  </List>
                </View> : null}
              </View>
            )}
          </View></Scroll>
        </View>
      </View>
    );
  }

  return (
    <View class="flex-1 flex-row pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      style={{ backgroundColor: colors().canvas }}>
      {!narrow() ? <Sidebar /> : null}
      <View class="min-w-0 flex-1 flex-col">
        {narrow() ? <View class="min-h-14 flex-row flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
          style={{ backgroundColor: colors().rail, borderColor: colors().line }}>
          <Text class="text-lg font-semibold" style={{ color: colors().ink }}>砚台</Text>
          <View class="flex-row items-center gap-1.5">
            <Action testID="menu" label="历史" action={() => drawer.set(true)} />
            <Action testID="settings" label="设置" action={() => settings.set(true)} />
            <Action testID="new" label="新对话" action={reset} />
          </View>
        </View> : null}
        {messages().length === 0 && !busy() ? (
          <View class="min-h-0 flex-1 px-3">
            <View class="w-full self-center border-l-2 px-4 py-2"
              style={{ maxWidth: 820, marginTop: narrow() ? 44 : 96, borderColor: colors().accent }}>
              <Text role="header" accessibilityLevel={1} class="text-[30px] font-semibold leading-10"
                style={{ color: colors().ink }}>开始一段对话</Text>
            </View>
          </View>
        ) : (
          <List testID="messages" class="min-h-0 flex-1" contentClass="px-3 py-5"
            maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 64 }} each={shown()} initialScrollAtEnd>
            {(message, index) => <View class="w-full self-center" style={{ maxWidth: 820 }}>
              <Bubble message={message()} index={index()} />
            </View>}
          </List>
        )}
        <View class="shrink-0 items-center px-3" style={{ paddingBottom: narrow() ? 12 : 24 }}>
          <View class="w-full" style={{ maxWidth: 820 }}><Composer /></View>
        </View>
      </View>
      {narrow() && drawer() ? (
        <View class="absolute inset-0 flex-row pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          style={{ zIndex: 10, backgroundColor: colors().veil }}>
          <Sidebar overlay />
          <View class="flex-1" onPress={() => drawer.set(false)} />
        </View>
      ) : null}
      {settings() ? <SettingsPanel /> : null}
    </View>
  );
}

mount(App);
