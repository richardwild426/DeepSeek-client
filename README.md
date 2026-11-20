# 砚台

砚台是基于 NSH 0.5.1 的 DeepSeek 客户端。请求直连 `api.deepseek.com`，「数据管理」中的「账户余额与模型」可查询账户余额与可用模型。首次启动默认打开「数据管理」。输入密钥本身不会发起请求。

## 使用

- 输入框提供独立的深度思考和智能搜索开关。填写密钥后也可开启读链接。思考过程可以展开查看。网页工具由 DeepSeek Flash 执行，返回的引用可点击打开，已读页面可在后续消息中继续引用。[DeepSeek 网页工具](https://api-docs.deepseek.com/guides/web_tools) · [思考模式](https://api-docs.deepseek.com/guides/thinking_mode)
- 输入框的附件按钮将文件加入草稿。每轮最多四件，每件最大 20 MiB。选择本身不会上传，发送时才使用官方 Files API。支持 JPEG、PNG、GIF、WebP 和 PDF。PDF 使用正文识别，图片与 PDF 都使用 DeepSeek Flash。云端文件设为七天过期。过期或切换到其他账户后，如需继续依据附件问答，请在新对话中重新添加文件。[DeepSeek Files API](https://api-docs.deepseek.com/guides/files_api) · [文档解析](https://api-docs.deepseek.com/guides/document_parsing)
- 历史记录保存在本设备。新建对话后可以切回旧对话。「数据管理」的「复制」将全部历史导出为 JSON 并写入剪贴板，复制受限时显示可手动选择的 JSON。导出包含对话正文、思考、引用、工具状态和附件元数据。历史处理会移除工具请求中的鉴权头，以及内嵌附件数据（包括 data URL）。「删除所有对话」需要二次确认。
- 恢复备份时，点击「上传」打开导入面板，选择 JSON 文件，或粘贴砚台导出的 v2 JSON、旧版 v1（`messages`）或旧版单会话消息数组后点击「校验 JSON」。摘要显示将新增、跳过以及因 ID 冲突而重新分配 ID 的对话数。按消息内容识别重复记录。点击「确认导入」后，保存成功的对话可在「历史」中查看或再次导出。导入全程在本机进行，合并后保留当前对话和草稿。
- macOS 的「数据管理」支持显式保存、读取和清除钥匙串中的 API Key。其他平台的密钥仅保留在当前进程或页面的内存中。

## 线上部署

Web 版部署在 Cloudflare Worker 静态资源上，自定义域名：https://ds.zvector.top

`wrangler.toml` 指向 `.nsh/out/web-dist/砚台`，SPA 回退，路由为 `ds.zvector.top` 的自定义域名。一条命令重新打包并发布：

```sh
scripts/deploy-web.sh
```

脚本会执行 `nsh package --target web --out .nsh/out/web-dist`，再用 `npx wrangler@latest deploy` 发布，最后请求一次线上首页确认 200。

界面基于授权的 DeepSeek API 使用 Demo 截图实现。配色、桌面与窄屏布局、设置结构和本地验收记录见 [砚台界面设计](DESIGN.md)。语音输入取决于系统听写能力，官方 ZIP 备份暂不支持。

## 本地构建和验收

使用 NSH `0.5.1 (224d9a7)`。测试固定使用网络和文件 fixtures，所有凭据均为假值。T4 发布前复验的候选包、构建命令和各平台限制见 [ROADMAP.md 的 T4 记录](ROADMAP.md#t4-发布前复验)。

```sh
nsh check
nsh test --junit .nsh/out/headless.xml
nsh package --target web
nsh package --target macos
nsh package --target ios --out .nsh/out/ios
nsh package --target ios-simulator --out .nsh/out/ios-simulator
nsh package --target android --out .nsh/out/android
# 在 Linux 宿主上执行
nsh package --target linux --out .nsh/out/linux
```

可用 `python3 -m http.server 8080 --bind 127.0.0.1 --directory '.nsh/out/砚台'` 从本机打开 Web 静态包。浏览器跨域规则由 DeepSeek 服务端决定。各端的验证范围和剩余缺口详见 [ROADMAP.md](ROADMAP.md)。

### 静态包的浏览器验收

在项目根目录打包并启动回环服务。静态入口为 `.nsh/out/t3-web/砚台/index.html`。

```sh
nsh package --target web --out .nsh/out/t3-web
python3 -m http.server 18765 --bind 127.0.0.1 --directory '.nsh/out/t3-web/砚台'
```

在另一终端运行下列命令。需要已安装的 Playwright 1.61.1 和配套 Chromium。脚本用独立的 headless 浏览器上下文验证 1280×900 浅色桌面和 320×640 深色窄屏，覆盖设置、独立工具开关、合成历史导入与导出，并拦截外部请求和系统剪贴板写入。可选的 URL 参数仅接受回环地址 `127.0.0.1`。

```sh
NODE_PATH="$(npm root -g)" node scripts/web-smoke.cjs
```
