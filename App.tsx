import type { JSX } from "nsh/jsx-runtime";
import { Clipboard, colorScheme, List, mount, openUrl, Picker, Scroll, setColorScheme, signal, Speech, Storage, Text, View, windowSize, type SpeechSession } from "nsh";
import { Dialog, Input } from "nsh/base";
import { complete, loadBalance, loadModels, models, sourceUrl, type Attachment, type Message, type Model } from "./deepseek";

import { conversationTitle, createHistoryWriter, emptyHistory, exportHistory, historyKey, legacyKey, mergeHistory, parseHistory, restoreHistory, type History } from "./history";

import { attachmentFilters, uploadAttachment, validateAttachment } from "./attachments";

import { deleteCredential, hasCredentialVault, loadCredential, saveCredential } from "./credentials";

import { Action, colors, Icon, IconButton, Toggle } from "./ui";

const setupKey = "yantai.setup-seen";
const appearanceKey = "yantai.appearance";
const themes = [["light", "浅色", "sun"], ["dark", "深色", "moon"], ["system", "跟随系统", "system"]] as const;
type Theme = typeof themes[number][0];

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
  const settingsTab = signal<"general" | "data">("data");
  const theme = signal<Theme>("system");
  const collapsed = signal(false);
  const confirmingDelete = signal(false);
  const deleting = signal(false);
  const choosingBackup = signal(false);
  const recording = signal(false);
  let speech: SpeechSession | undefined;
  let firstLaunch = false;
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

  void Storage.getItem(appearanceKey).then((saved) => {
    if (saved === "light" || saved === "dark") {
      theme.set(saved);
      setColorScheme(saved);
    }
  }).catch(() => {});

  void Promise.all([setupKey, historyKey, legacyKey].map((name) => Storage.getItem(name))).then((values) => {
    if (values.every((value) => value === null) && !settings() && !key()) {
      firstLaunch = true;
      openSettings();
    }
  }).catch(() => {});

  void restoreHistory().then((restored) => {
    history.set(restored);
    messages.set(restored.conversations.find(({ id }) => id === restored.active)?.messages ?? []);
  }).catch(() => {
    historyWritable = false;
    historyStatus.set("无法读取历史，原记录保留。新对话仅存于内存。");
  }).finally(() => historyReady.set(true));

  function openSettings() {
    drawer.set(false);
    settingsTab.set("data");
    settings.set(true);
  }

  function closeSettings() {
    if (importing() || deleting() || choosingBackup()) return;
    settings.set(false);
    confirmingDelete.set(false);
    closeImport();
    if (firstLaunch) {
      firstLaunch = false;
      void Storage.setItem(setupKey, "1").catch(() => {});
    }
  }

  function changeTheme(next: Theme) {
    theme.set(next);
    setColorScheme(next);
    void Storage.setItem(appearanceKey, next).catch(() => {});
  }

  async function dictate() {
    if (speech) { speech.stop(); return; }
    if (recording() || busy() || importOpen()) return;
    recording.set(true);
    try {
      if (!await Speech.available()) {
        status.set("当前平台不支持语音输入。");
        recording.set(false);
        return;
      }
      status.set("正在聆听，再次点击可停止。");
      const session = Speech.start({ lang: "zh-CN", interim: false });
      speech = session;
      session.on("end", ({ text, error }) => {
        if (speech !== session) return;
        speech = undefined;
        recording.set(false);
        if (error) status.set(error === "not-allowed" ? "请允许麦克风和语音识别权限。" : "语音识别失败，请重试。");
        else {
          if (text.trim()) question.update((draft) => draft ? `${draft} ${text}` : text);
          status.set("");
        }
      });
    } catch {
      recording.set(false);
      status.set("无法启动语音输入。");
    }
  }

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
    if (!historyReady() || busy() || picking() || recording() || importOpen() || deleting()) return;
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

  async function chooseBackup() {
    if (choosingBackup() || importing()) return;
    choosingBackup.set(true);
    importError.set("");
    try {
      const [chosen] = await Picker.pickFiles({ filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!chosen) return;
      if (!chosen.file.name.toLowerCase().endsWith(".json") || chosen.file.size > 5 * 1024 * 1024) {
        throw new Error("请选择不超过 5 MiB 的历史 JSON 文件。");
      }
      importText.set(await chosen.file.text());
      previewImport();
    } catch (error) {
      importError.set(error instanceof Error ? error.message : "无法读取导入文件。");
    } finally {
      choosingBackup.set(false);
    }
  }

  async function deleteHistory() {
    if (!historyReady() || !historyWritable || busy() || picking() || recording() || importOpen() || deleting() || !confirmingDelete()) return;
    deleting.set(true);
    try {
      const cleared = emptyHistory();
      // The v2 copy is authoritative after a successful restore or migration.
      // Remove the legacy copy too so a deleted conversation cannot reappear.
      await Storage.removeItem(legacyKey);
      await enqueueHistoryWrite(cleared);
      history.set(cleared);
      messages.set([]);
      expandedThinking.set({});
      exportPreview.set("");
      confirmingDelete.set(false);
      status.set("");
      historyStatus.set("已删除所有对话。");
    } catch {
      historyStatus.set("删除失败，现有对话已保留。");
    } finally {
      deleting.set(false);
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
    if (!historyReady() || busy() || picking() || recording() || importOpen() || deleting()) return;
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
    if (controller || vaultBusy() || picking() || recording() || !historyReady() || importOpen() || deleting()) return;
    const content = text.trim();
    if (!content) return;
    const token = key().trim();
    const selectedModel = model();
    const options = { thinking: thinking(), search: search(), readLinks: readLinks() };
    if (!token) {
      openSettings();
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
    if (busy() || picking() || recording() || !historyReady() || importOpen() || deleting()) return;
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
        <View testID="composer" class="w-full rounded-[24px] border"
          style={{ borderColor: colors().line, backgroundColor: colors().surface,
            boxShadow: colorScheme() === "light" ? "0 2px 4px #16254808, 0 22px 45px #526baa0c" : undefined }}>
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
            multiline submitBehavior="submit" placeholder="请输入消息" value={question()}
            onChange={(e) => question.set(e.value)} onSubmit={(e) => void send(e.text)}
            class="w-full px-4 pt-3 text-base leading-6"
            style={{ height: narrow() ? 46 : 64, color: colors().ink, placeholderColor: colors().placeholder, backgroundColor: "transparent", borderWidth: 0 }} />
          <View class="flex-row flex-wrap items-center justify-between gap-y-2 p-3">
            <View class="flex-row items-center" style={{ gap: windowSize().width < 360 ? 4 : 10 }}>
              <Toggle label="深度思考" icon="thinking" testID="thinking" selected={thinking()} action={() => thinking.update((on) => !on)} />
              <Toggle label="智能搜索" icon="search" testID="search" selected={search()} action={() => search.update((on) => !on)} />
              {key().trim() && !narrow() ? <Toggle label="读链接" icon="link" testID="read-links" selected={readLinks()}
                action={() => readLinks.update((on) => !on)} /> : null}
            </View>
            <View class="ml-auto flex-row items-center" style={{ gap: windowSize().width < 360 ? 0 : 4 }}>
              {!busy() && !importOpen() ? <>
                <IconButton testID="dictate" label={recording() ? "停止语音输入" : "语音输入"} name="mic"
                  size={narrow() ? 33 : 34} iconSize={17} selected={recording()} color={recording() ? colors().accent : colors().ink} action={() => void dictate()} />
                <IconButton testID="attach" label={picking() ? "正在选择附件" : "添加附件"} name="attach"
                  size={narrow() ? 33 : 34} iconSize={17} disabled={picking()} action={() => void pickAttachment()} />
              </> : null}
              <View style={{ marginLeft: !busy() && !importOpen() && windowSize().width >= 360 ? (narrow() ? 8 : 6) : 0 }}>
                {busy() ? <IconButton testID="stop" label="停止" name="stop" fill={colors().accent} color={colors().onAccent}
                  action={() => controller?.abort()} /> : (
                  <IconButton testID="send" label="发送" name="send" iconSize={19}
                    color={question().trim() ? colors().onAccent : colors().onDisabledAccent}
                    fill={question().trim() ? colors().accent : colors().disabledAccent}
                    disabled={!question().trim() || !historyReady() || importOpen() || recording()} action={() => void send()} />
                )}
              </View>
            </View>
          </View>
          {key().trim() && narrow() ? <View class="self-start px-3 pb-3">
            <Toggle label="读链接" icon="link" testID="read-links" selected={readLinks()} action={() => readLinks.update((on) => !on)} />
          </View> : null}
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
          <View class="rounded-[16px] px-4 py-3" style={{ maxWidth: "88%", backgroundColor: colors().inset }}>
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
      <View testID="history-panel" class="shrink-0 flex-col border-r px-3"
        style={{ width: props.overlay ? Math.min(300, windowSize().width - 44) : 261, borderColor: colors().railLine, backgroundColor: colors().rail }}>
        <View class="h-[66px] flex-row items-center justify-between pl-2">
          <Text class="text-xl font-semibold" style={{ color: colors().accent }}>API 使用 demo</Text>
          <IconButton testID={props.overlay ? "close-drawer" : "collapse-sidebar"} label="收起历史" name="panel"
            size={36} iconSize={17} color={colors().muted} action={() => props.overlay ? drawer.set(false) : collapsed.set(true)} />
        </View>
        <View testID="new" role="button" onPress={reset}
          class="mt-1 h-10 shrink-0 flex-row items-center justify-center gap-1.5 rounded-full"
          style={{ backgroundColor: colors().raised, boxShadow: "0 1px 3px #101e3c25" }}>
          <Icon name="new" size={17} /><Text class="text-sm font-medium" style={{ color: colors().ink }}>开启新对话</Text>
        </View>
        <List class="mt-3 min-h-0 flex-1" contentClass="gap-1" each={history().conversations}>
          {(item) => {
            const active = () => history().active === item().id;
            return <View testID={`history-${item().id}`} role="button" accessibilityState={{ current: active() }}
              onPress={() => selectConversation(item().id)} class="h-10 flex-row items-center rounded-xl px-3"
              style={{ backgroundColor: active() ? colors().inset : "transparent" }}>
              <Text class="truncate text-sm" style={{ color: colors().ink }}>{conversationTitle(item())}</Text>
            </View>;
          }}
        </List>
        <View testID="settings" role="button" onPress={() => openSettings()}
          class="mb-3 h-10 shrink-0 flex-row items-center gap-3 rounded-xl px-3">
          <Icon name="settings" size={props.overlay ? 20 : 17} /><Text class="text-sm" style={{ color: colors().ink }}>设置</Text>
        </View>
      </View>
    );
  }

  function SettingLabel(props: { children: string }) {
    return <Text class="text-sm leading-5" style={{ color: colors().ink }}>{props.children}</Text>;
  }

  function SettingHint(props: { children: string }) {
    return <Text class="text-xs leading-[18px]" style={{ color: colors().muted }}>{props.children}</Text>;
  }

  function SettingRow(props: { title: string; description?: string; children?: JSX.Element }) {
    return <View class="flex-row items-center justify-between gap-4 border-t py-[11px]"
      style={{ minHeight: props.description ? 86 : undefined, borderColor: colors().line }}>
      <View class="min-w-0 flex-1 gap-1" style={{ maxWidth: narrow() ? undefined : 380 }}>
        <SettingLabel>{props.title}</SettingLabel>
        {props.description ? <SettingHint>{props.description}</SettingHint> : null}
      </View>
      {props.children}
    </View>;
  }

  function UnavailableChoice(props: { label: string; reason: string; wide?: boolean; placeholder?: boolean }) {
    return <View role="button" accessibilityLabel={props.label} accessibilityDescription={props.reason}
      accessibilityState={{ disabled: true }} class="h-9 flex-row items-center justify-between gap-3 rounded-full px-3.5"
      style={{ flexGrow: props.wide ? 1 : 0, backgroundColor: colors().inset }}>
      <Text class="text-sm" style={{ color: props.placeholder ? colors().muted : colors().ink }}>{props.label}</Text>
      <Icon name="chevron" size={14} color={colors().muted} />
    </View>;
  }

  function GeneralSettings() {
    return <View>
      <SettingLabel>主题</SettingLabel>
      <View class="mb-[10px] mt-2 flex-row flex-wrap gap-3">
        {themes.map(([id, label, icon]) => <View testID={`theme-${id}`} role="button"
          onPress={() => changeTheme(id)} accessibilityState={{ pressed: theme() === id }}
          class="h-[82px] grow items-center justify-center gap-0.5 rounded-xl border"
          style={{ flexBasis: narrow() && id === "system" ? "100%" : 0,
            borderColor: theme() === id ? colors().selectedLine : colors().controlLine,
            backgroundColor: theme() === id ? colors().inset : colors().surface }}>
          <Icon name={icon} size={16} /><SettingLabel>{label}</SettingLabel>
        </View>)}
      </View>
      <View class="h-[60px] flex-row items-center justify-between">
        <SettingLabel>语言</SettingLabel>
        <UnavailableChoice label="简体中文" reason="当前仅提供简体中文界面" />
      </View>
      <View class="h-[60px] flex-row items-center justify-between border-t" style={{ borderColor: colors().line }}>
        <SettingLabel>朗读音色</SettingLabel>
        <UnavailableChoice label="海星（女声）" reason="当前版本未接入朗读" />
      </View>
      <View class="justify-between gap-3 border-t py-[11px]" style={{ borderColor: colors().line,
        flexDirection: narrow() ? "column" : "row", alignItems: narrow() ? "stretch" : "center" }}>
        <SettingLabel>位置信息</SettingLabel>
        <View class="flex-row gap-3">
          <UnavailableChoice label="请选择省份/地区" reason="当前版本未接入位置服务" placeholder wide={narrow()} />
          <UnavailableChoice label="请选择市" reason="当前版本未接入位置服务" placeholder wide={narrow()} />
        </View>
      </View>
    </View>;
  }

  function ImportEditor() {
    return <View class="gap-2 pb-3">
      <View class="flex-row flex-wrap gap-2">
        <Action label="选择 JSON 文件" testID="choose-backup" disabled={choosingBackup() || importing()} action={() => void chooseBackup()} />
      </View>
      <Input testID="import-json" accessibilityLabel="历史 JSON" multiline disabled={importing() || choosingBackup()}
        placeholder="或粘贴历史 JSON" autoComplete="off" autoCorrect={false} autoCapitalize="none"
        value={importText()} onChange={(e) => {
          if (importing() || choosingBackup()) return;
          importText.set(e.value);
          importPreview.set(null);
          importError.set("");
        }} class="h-28 w-full rounded-xl border px-3 py-2 text-[13px]"
        style={{ borderColor: colors().line, color: colors().ink, backgroundColor: colors().inset, placeholderColor: colors().placeholder }} />
      {importPreview() ? <Text testID="import-summary" class="text-xs" style={{ color: colors().ink }}>
        {`${importPreview()!.format} · 新增 ${importPreview()!.added} · 重复 ${importPreview()!.duplicates} · ID 冲突 ${importPreview()!.conflicts}`}
      </Text> : null}
      {importError() ? <Text class="text-xs" style={{ color: colors().danger }}>{importError()}</Text> : null}
      {importing() ? <SettingHint>正在保存导入记录…</SettingHint> : <View class="flex-row flex-wrap gap-2">
        <Action label="校验 JSON" testID="preview-import" disabled={choosingBackup()} action={previewImport} />
        {importPreview() ? <Action label="确认导入" testID="confirm-import" disabled={choosingBackup()} action={() => void confirmImport()} /> : null}
        <Action label="取消" testID="cancel-import" disabled={choosingBackup()} action={closeImport} />
      </View>}
    </View>;
  }

  function DataSettings() {
    const rowHeight = () => narrow() ? 44 : 36;
    return <View>
      <View class="gap-2" style={{ paddingBottom: narrow() ? 12 : 16 }}>
        <SettingLabel>输入 API Key 开始使用</SettingLabel>
        <Input testID="key" accessibilityLabel="API Key" accessibilityDescription={hasCredentialVault()
          ? "可选择保存到 macOS 钥匙串" : "密钥仅保留在当前会话内存中"}
          disabled={vaultBusy()} masked autoComplete="off" autoCorrect={false} autoCapitalize="none"
          value={key()} placeholder="请输入 API Key" onChange={(e) => setKey(e.value)}
          class="w-full rounded-full px-4"
          style={{ height: narrow() ? 52 : 44, borderWidth: narrow() ? 0 : 1, borderColor: colors().line,
            fontSize: narrow() ? 16 : 14, color: colors().ink, backgroundColor: narrow() ? colors().rail : colors().surface,
            placeholderColor: colors().placeholder }} />
      </View>
      <SettingRow title="导入历史对话" description="导入会合并到本机历史并保留现有对话。支持砚台 v2 JSON、旧版 v1 与单会话数组。">
        <Action label={importOpen() ? "取消" : "上传"} icon={narrow() ? undefined : "upload"} height={rowHeight()} testID="import"
          disabled={importing() || deleting() || choosingBackup()} action={() => importOpen() ? closeImport() : openImport()} />
      </SettingRow>
      {importOpen() ? <ImportEditor /> : null}
      <SettingRow title="导出所有历史对话" description="包含对话正文、思考、引用与附件信息，可复制为 JSON，不包含 API Key。">
        <Action label="复制" icon={narrow() ? undefined : "copy"} height={rowHeight()} testID="export"
          disabled={!history().conversations.length || importing() || deleting()} action={() => void copyHistory()} />
      </SettingRow>
      <SettingRow title="删除所有对话">
        <Action label="删除" danger height={rowHeight()} testID="delete-history"
          disabled={!historyReady() || !historyWritable || busy() || picking() || recording() || importOpen() || deleting()}
          action={() => confirmingDelete.set(true)} />
      </SettingRow>
      {confirmingDelete() ? <View class="gap-2 pb-3">
        <SettingLabel>永久删除本机的所有对话？</SettingLabel>
        <View class="flex-row gap-2">
          <Action label="取消" testID="cancel-delete-history" disabled={deleting()} action={() => confirmingDelete.set(false)} />
          <Action label={deleting() ? "正在删除…" : "确认删除"} danger testID="confirm-delete-history" disabled={deleting()}
            action={() => void deleteHistory()} />
        </View>
      </View> : null}
      {status() ? <SettingHint>{status()}</SettingHint> : null}
      {historyStatus() ? <SettingHint>{historyStatus()}</SettingHint> : null}
      {exportPreview() ? <View class="gap-2 py-2">
        <View class="self-start"><Action label="关闭预览" testID="close-export" action={() => exportPreview.set("")} /></View>
        <List class="h-[128px] shrink-0" each={[exportPreview()]}>
          {(json) => <View selectable><Text class="text-xs" style={{ color: colors().ink }}>{json()}</Text></View>}
        </List>
      </View> : null}
      {(key().trim() || hasCredentialVault()) ? <View class="gap-2 border-t py-3" style={{ borderColor: colors().line }}>
        <SettingHint>{hasCredentialVault() ? "密钥可保存到 macOS 钥匙串，仅在本机使用。" : "密钥仅保留在当前会话内存中。"}</SettingHint>
        {hasCredentialVault() ? <View class="flex-row flex-wrap gap-2">
          <Action label="读取" testID="vault-load" disabled={vaultBusy()} action={() => void manageCredential("load")} />
          <Action label="保存" testID="vault-save" disabled={vaultBusy()} action={() => void manageCredential("save")} />
          <Action label="清除" testID="vault-delete" disabled={vaultBusy()} action={() => void manageCredential("delete")} />
        </View> : null}
        {vaultStatus() ? <SettingHint>{vaultStatus()}</SettingHint> : null}
      </View> : null}
      {key().trim() ? <>
        <SettingRow title="账户余额与模型" description="直连 api.deepseek.com 查询。">
          <Action label="加载" testID="account" action={() => void refreshAccount()} />
        </SettingRow>
        {balance() ? <SettingHint>{balance()}</SettingHint> : null}
        {modelStatus() ? <SettingHint>{modelStatus()}</SettingHint> : null}
        <View class="gap-2 py-2">
          <SettingLabel>模型</SettingLabel>
          <View class="flex-row flex-wrap gap-2">
            {availableModels().map((name) => <Toggle key={name} label={name === models[0] ? "DeepSeek Flash" : name === models[1] ? "DeepSeek V4 Pro" : name}
              testID={name} selected={model() === name} action={() => model.set(name)} />)}
          </View>
        </View>
      </> : null}
    </View>;
  }

  function SettingsPanel() {
    const locked = () => importing() || deleting() || choosingBackup();
    const navItem = (id: "general" | "data", label: string, icon: "settings" | "data") => (
      <View testID={`settings-tab-${id}`} role="tab" accessibilityState={{ selected: settingsTab() === id, disabled: locked() }}
        onPress={locked() ? undefined : () => settingsTab.set(id)} class="h-10 flex-row items-center gap-2 rounded-xl px-2"
        style={{ flex: narrow() ? 1 : undefined, justifyContent: narrow() ? "center" : "flex-start",
          backgroundColor: settingsTab() === id ? colors().navSelected : "transparent" }}>
        <Icon name={icon} size={16} /><SettingLabel>{label}</SettingLabel>
      </View>
    );
    const panelWidth = () => Math.min(760, windowSize().width - (narrow() ? 0 : 32));
    const panelHeight = () => narrow() ? Math.max(0, windowSize().height - 64) : Math.min(500, windowSize().height - 32);
    return <Dialog open animation="none" accessibilityLabel="设置"
      closeOnEscape={!locked()} closeOnBackdropPress={!locked()} closeOnSwipe={!locked()} onOpenChange={({ open }) => { if (!open) closeSettings(); }}
      backdropStyle={{ backgroundColor: colors().veil, backdropFilter: "blur(3px)" }}
      style={{ width: panelWidth(), height: panelHeight(), marginLeft: (windowSize().width - panelWidth()) / 2,
        marginTop: narrow() ? 64 : (windowSize().height - panelHeight()) / 2,
        borderRadius: 24, borderBottomLeftRadius: narrow() ? 0 : 24,
        borderBottomRightRadius: narrow() ? 0 : 24, backgroundColor: colors().surface,
        boxShadow: narrow() ? undefined : "0 12px 26px #00000014" }}>
      <View testID="settings-panel" class="min-h-0 flex-1">
        <View class="h-16 shrink-0 flex-row items-center justify-between pl-6 pr-3">
          <Text class="text-base font-semibold" style={{ color: colors().ink }}>设置</Text>
          <IconButton testID="close-settings" label="关闭设置" name="close" disabled={locked()} action={closeSettings} />
        </View>
        <View class="min-h-0 flex-1" style={{ flexDirection: narrow() ? "column" : "row", gap: narrow() ? 0 : 40 }}>
          <View role="tablist" class="shrink-0 gap-1" style={{ flexDirection: narrow() ? "row" : "column",
            width: narrow() ? undefined : 164, marginLeft: narrow() ? 24 : 16, marginRight: narrow() ? 24 : 0 }}>
            {navItem("general", "通用设置", "settings")}
            {navItem("data", "数据管理", "data")}
          </View>
          <Scroll class="min-h-0 min-w-0 flex-1" keyboardShouldPersistTaps="handled">
            <View style={{ paddingTop: (narrow() ? 46 : 2) + (settingsTab() === "data" ? 2 : 0),
              paddingLeft: narrow() ? 24 : 0, paddingRight: 24,
              paddingBottom: narrow() ? 32 : 24 }}>
              {settingsTab() === "general" ? <GeneralSettings /> : <DataSettings />}
            </View>
          </Scroll>
        </View>
      </View>
    </Dialog>;
  }

  const empty = () => !messages().length && !busy();
  return (
    <View class="flex-1 flex-row pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      style={{ backgroundColor: colors().canvas }}>
      {!narrow() && !collapsed() ? <Sidebar /> : null}
      <View class="min-w-0 flex-1 flex-col">
        {narrow() || collapsed() ? <View class="absolute left-3 top-3 z-10 flex-row items-center gap-1">
          <IconButton testID="menu" label="打开历史" name={narrow() ? "menu" : "panel"} size={40}
            iconSize={19} action={() => narrow() ? drawer.set(true) : collapsed.set(false)} />
          {!narrow() ? <IconButton testID="new" label="开启新对话" name="new" action={reset} /> : null}
        </View> : null}
        {empty() ? (
          <View class="min-h-0 flex-1" style={{ justifyContent: narrow() ? "flex-start" : "center" }}>
            <View class="w-full items-center" style={{ paddingHorizontal: narrow() ? 16 : 24,
              paddingTop: narrow() ? Math.max(56, windowSize().height * 0.44) : 0, marginBottom: narrow() ? 0 : 64, gap: 20 }}>
              <Text testID="welcome" role="header" accessibilityLevel={1} class="text-center font-semibold"
                style={{ fontSize: narrow() ? 20 : 24, lineHeight: narrow() ? 28 : 34, color: colors().ink }}>今天有什么可以帮到你？</Text>
              {!narrow() ? <View class="w-full" style={{ maxWidth: 776 }}><Composer /></View> : null}
            </View>
          </View>
        ) : (
          <List testID="messages" class="min-h-0 flex-1"
            contentStyle={{ paddingTop: 76, paddingBottom: 20, paddingHorizontal: 16 }} maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 64 }} each={shown()} initialScrollAtEnd>
            {(message, index) => <View class="w-full self-center" style={{ maxWidth: 776 }}>
              <Bubble message={message()} index={index()} />
            </View>}
          </List>
        )}
        {narrow() || !empty() ? <View class="shrink-0 items-center gap-1.5 px-4 pb-1.5">
          <View class="w-full" style={{ maxWidth: 776 }}><Composer /></View>
          <Text class="text-[11px] leading-4" style={{ color: colors().muted }}>内容由 AI 生成，请仔细甄别</Text>
        </View> : null}
      </View>
      {narrow() && drawer() ? (
        <View class="absolute inset-0 z-20 flex-row pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <Sidebar overlay />
          <View class="flex-1" focusable={false} onPress={() => drawer.set(false)} />
        </View>
      ) : null}
      {settings() ? <SettingsPanel /> : null}
    </View>
  );
}

mount(App);
