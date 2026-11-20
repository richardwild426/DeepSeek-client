const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:18765/');
assert.equal(url.protocol, 'http:');
assert.equal(url.hostname, '127.0.0.1');

const conversation = {
  id: 't3-synthetic',
  updatedAt: 1700000000000,
  messages: [
    { role: 'user', content: '合成问题：如何验证本地历史？' },
    { role: 'assistant', content: '合成答复：从历史列表打开这段对话。', thinkingText: '合成思考：校验本地往返。' },
  ],
};
const backup = { version: 2, active: conversation.id, conversations: [conversation] };

async function smoke(context, viewport, colorScheme) {
  const externalRequests = [];
  await context.route('**/*', (route) => {
    const requestUrl = route.request().url();
    if (new URL(requestUrl).origin === url.origin) return route.continue();
    externalRequests.push(requestUrl);
    return route.abort();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const assets = new Map();
  page.on('response', (response) => assets.set(new URL(response.url()).pathname, response.status()));
  const id = (name) => page.getByTestId(name);
  const visible = (text) => page.getByText(text, { exact: true }).waitFor({ state: 'visible' });

  const response = await page.goto(url.href);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['content-type'], /^text\/html/);
  assert.equal(await page.title(), '砚台');
  const narrow = viewport.width < 720;
  await id('key').locator('input[type=password]').waitFor();
  await id('close-settings').click();
  await id('welcome').waitFor();
  const ink = colorScheme === 'dark' ? 'rgb(249, 250, 251)' : 'rgb(16, 20, 26)';
  const input = id('question').locator('textarea');
  const inputBox = await input.boundingBox();
  assert.equal(inputBox.y > viewport.height / 2, narrow, '空白对话桌面居中，窄屏输入区靠近底部');
  assert.equal(await input.evaluate((field) => getComputedStyle(field).color), ink);
  assert.equal(await id('history-panel').isVisible(), !narrow);
  assert.equal(await id('menu').isVisible(), narrow);
  for (const pattern of [/\/app\.[\da-f]+\.js$/, /\/nsh\.[\da-f]+\.js$/, /\/nsh\.[\da-f]+\.wasm$/]) {
    const asset = [...assets].find(([path]) => pattern.test(path));
    assert.equal(asset?.[1], 200, `Missing HTTP 200 for ${pattern}`);
    console.log(`HTTP 200 ${asset[0]}`);
  }
  console.log(`首屏：HTTP 200 ${url.href}，砚台空状态可见`);

  if (narrow) await id('menu').click();
  await id('settings').click();
  const keyField = id('key').locator('input[type=password]');
  await keyField.waitFor({ state: 'visible' });
  assert.equal(await keyField.evaluate((field) => getComputedStyle(field).color), ink);
  const [panelBox, keyBox] = await Promise.all([id('settings-panel').boundingBox(), id('key').boundingBox()]);
  assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width + 1);
  assert.ok(keyBox.width > panelBox.width * 0.65, '密钥输入应占用设置内容的大部分宽度');
  await id('settings-tab-general').click();
  await keyField.waitFor({ state: 'hidden' });
  await id('theme-system').waitFor();
  await id('settings-tab-data').click();
  await keyField.fill('fake-browser-fixture-key');
  await visible('密钥仅保留在当前会话内存中。');
  await id('close-settings').click();
  await id('thinking').click();
  assert.equal(await id('thinking').getAttribute('aria-pressed'), 'true');
  await id('search').click();
  assert.equal(await id('search').getAttribute('aria-pressed'), 'true');
  assert.equal(await id('read-links').getAttribute('aria-pressed'), 'false');
  await id('read-links').click();
  await id('search').click();
  assert.equal(await id('search').getAttribute('aria-pressed'), 'false');
  assert.equal(await id('read-links').getAttribute('aria-pressed'), 'true');
  if (narrow) await id('menu').click();
  await id('settings').click();
  console.log('设置：密钥掩码与配色正确，通用设置与数据管理可切换');

  await id('import').click();
  await id('import-json').locator('textarea').fill(JSON.stringify(backup, null, 2));
  await id('preview-import').click();
  await visible('v2 · 新增 1 · 重复 0 · ID 冲突 0');
  await id('confirm-import').click();
  await visible('已导入 1 个对话。');
  console.log('导入：v2 · 新增 1 · 重复 0 · ID 冲突 0，确认保存成功');

  await id('close-settings').click();
  if (narrow) await id('menu').click();
  await id(`history-${conversation.id}`).click();
  if (narrow) await id('history-panel').waitFor({ state: 'hidden' });
  else assert.equal(await id('history-panel').isVisible(), true);
  for (const { content } of conversation.messages) {
    await id('messages').getByText(content, { exact: true }).waitFor({ state: 'visible' });
  }
  await id('thought-1').click();
  await visible(conversation.messages[1].thinkingText);
  await page.reload();
  await visible(conversation.messages[1].content);
  console.log('查看：点击历史条目即回到对话，原文和思考可见，刷新后仍可见');

  // Deny async clipboard access so NSH uses Chromium's copy event.
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.setPermission', {
    browserContextId: targetInfo.browserContextId,
    origin: url.origin,
    permission: { name: 'clipboard-write' },
    setting: 'denied',
  });
  assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-write' })).state), 'denied');
  // Capture Chromium's copy event before it can write to the system clipboard.
  await page.evaluate(() => {
    window.addEventListener('copy', (event) => {
      event.preventDefault();
      const input = document.activeElement;
      window.exportedHistory = input instanceof HTMLTextAreaElement
        ? input.value.slice(input.selectionStart, input.selectionEnd)
        : window.getSelection().toString();
    });
  });
  if (narrow) await id('menu').click();
  await id('settings').click();
  await id('settings-tab-data').click();
  await id('export').click();
  await visible('已复制历史 JSON。');
  await page.waitForFunction(() => typeof window.exportedHistory === 'string');
  assert.deepEqual(JSON.parse(await page.evaluate(() => window.exportedHistory)), backup);
  console.log('导出：捕获 Chromium copy 事件，选中的 JSON 与合成备份逐字段一致');

  await id('close-settings').click();
  if (narrow) await id('menu').click();
  await id('new').click();
  await id('welcome').waitFor();
  assert.equal(await id('history-panel').isVisible(), !narrow);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log('PASS：外部请求 0，页面异常 0');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [viewport, colorScheme] of [
      [{ width: 1280, height: 900 }, 'light'],
      [{ width: 320, height: 640 }, 'dark'],
    ]) {
      console.log(`${viewport.width}×${viewport.height} ${colorScheme}`);
      const context = await browser.newContext({ serviceWorkers: 'block', viewport, colorScheme });
      try {
        await smoke(context, viewport, colorScheme);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
