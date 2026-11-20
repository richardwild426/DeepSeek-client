# 砚台

砚台是基于 NSH 0.5.1 的 DeepSeek 客户端。请求直连 `api.deepseek.com`，「数据管理」中的「账户余额与模型」可查询账户余额与可用模型。首次启动默认打开「数据管理」。输入密钥本身不会发起请求。

## 使用

- 输入框提供独立的深度思考和智能搜索开关。填写密钥后也可开启读链接。思考过程可以展开查看。网页工具由 DeepSeek Flash 执行，返回的引用可点击打开，已读页面可在后续消息中继续引用。[DeepSeek 网页工具](https://api-docs.deepseek.com/guides/web_tools) · [思考模式](https://api-docs.deepseek.com/guides/thinking_mode)
- 输入框的附件按钮将文件加入草稿。每轮最多四件，每件最大 20 MiB。选择本身不会上传，发送时才使用官方 Files API。支持 JPEG、PNG、GIF、WebP 和 PDF。PDF 使用正文识别，图片与 PDF 都使用 DeepSeek Flash。云端文件设为七天过期。过期或切换到其他账户后，如需继续依据附件问答，请在新对话中重新添加文件。[DeepSeek Files API](https://api-docs.deepseek.com/guides/files_api) · [文档解析](https://api-docs.deepseek.com/guides/document_parsing)
- 历史记录保存在本设备。新建对话后可以切回旧对话。「数据管理」的「复制」将全部历史导出为 JSON 并写入剪贴板，复制受限时显示可手动选择的 JSON。导出包含对话正文、思考、引用、工具状态和附件元数据。历史处理会移除工具请求中的鉴权头，以及内嵌附件数据（包括 data URL）。「删除所有对话」需要二次确认。
- 恢复备份时，点击「上传」打开导入面板，选择 JSON 文件，或粘贴砚台导出的 v2 JSON、旧版 v1（`messages`）或旧版单会话消息数组后点击「校验 JSON」。摘要显示将新增、跳过以及因 ID 冲突而重新分配 ID 的对话数。按消息内容识别重复记录。点击「确认导入」后，保存成功的对话可在「历史」中查看或再次导出。导入全程在本机进行，合并后保留当前对话和草稿。
- macOS 的「数据管理」支持显式保存、读取和清除钥匙串中的 API Key。其他平台的密钥仅保留在当前进程或页面的内存中。

## 从 GitHub Releases 下载

在仓库的 **Releases** 页面（[最新版本](https://github.com/richardwild426/DeepSeek-client/releases/latest)）选择与你的系统匹配的 `yantai-v<版本>-…` 文件。先下载同一版本的 `SHA256SUMS`，在下载目录运行 `sha256sum --ignore-missing --check SHA256SUMS`（macOS 可用 `shasum -a 256 --ignore-missing -c SHA256SUMS`）；确认所选文件显示 `OK`。Windows 可用 `Get-FileHash -Algorithm SHA256 <文件>`，和清单中同名文件的摘要比较。

| 平台 | 文件后缀 | 安装或使用 |
| --- | --- | --- |
| macOS Apple silicon / Intel | `macos-arm64.dmg` / `macos-x64.dmg` | 打开 DMG，把「砚台」拖到 Applications。应用仅 ad hoc 签名，未使用 Developer ID、公证或盖章；Gatekeeper 可能拦截。此包不等同于已公证的公开分发包。不要全局关闭 Gatekeeper。 |
| Windows x64 | `windows-x64.zip` | 完整解压后运行归档内的 `.exe`，保留同目录的 `nsh`。便携版，不是安装器；未做 Authenticode 签名，SmartScreen 可能提示。 |
| Linux x64 | `linux-x64.tar.gz` | 解包后运行目录内的 `./App`。以 Ubuntu 24.04 为依赖基线，需 GTK 4.14+、WebKitGTK 6 和 GStreamer，例如 `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4 libgstreamer-plugins-base1.0-0`。 |
| Android ARM64 / ARMv7 | `android.apk`（可选） | 仅在维护者启用并配置长期签名后提供。旁加载或 `adb install`。升级要求相同应用 ID、相同签名和递增的 `nsh.json` `build`（Android `versionCode`）；不是 Play 商店产物。 |
| iOS ARM64 真机 | `ios-device-ad-hoc-arm64.ipa`（可选） | 仅在维护者启用并配置有效 Apple Distribution 证书及匹配的 Ad Hoc 描述文件后提供，仅限描述文件登记的设备，受证书和描述文件有效期限制。**不是** App Store、TestFlight、企业分发或任意设备可装的 IPA。 |
| iOS 模拟器（Apple silicon） | `ios-simulator-arm64.zip` | 解压后用 Xcode 的 `xcrun simctl install booted 砚台.app` 安装到已启动的模拟器；不能装到真机。工作流仅验证包，不启动模拟器。 |
| Web | `web-static.zip` | 解压后用静态服务器提供 `index.html` 及同目录文件；浏览器跨域限制仍适用。工作流不会部署 Cloudflare。 |

### 发布维护

- `.github/workflows/release.yml` 与现有 CI 独立。先在 Actions 的 **Package GitHub Release** 手动运行 (`workflow_dispatch`)，实际打包并上传 `verified-release-assets`，不发 Release、不使用生产签名。Android 测试包由一次性证书签名，应用 ID 为 `app.yantai.deepseek.test`，不可用于长期升级；iOS 真机不参与 dry-run。`RELEASE-ASSETS.md` 明示缺少的移动端资产。
- 维护者先更新 `nsh.json` 的 `version` 和递增的 `build`，再对验收过的提交创建并推送匹配的 `vMAJOR.MINOR.PATCH` 标签（如 `v1.0.0`）。标签必须已存在且严格匹配版本。流程精确核对各平台资产清单并生成 `SHA256SUMS`，然后在 GitHub 创建草稿、上传资产，成功后发布。配置了签名却缺少或给错凭据会失败，不回退到测试包；已有 Release 不被覆盖。失败留下草稿时，维护者先在 GitHub 检查草稿、资产和标签，再决定手动处理或移除草稿后重跑。
- 建议用 GitHub ruleset 限制谁能创建或修改 `v*` tag，并把生产签名只放在限制 `v*` tag 的 `release-signing` Environment 中。NSH 固定为 `0.5.1 (224d9a7)`；下载安装使用 [上游 v0.5.1 发行资产](https://github.com/longbridge/nsh/releases/tag/v0.5.1) 和代码内固定 SHA-256，不运行远端安装脚本。该版本官方 `install.sh` 支持 Linux/macOS，Windows 用 `install.ps1`；发行版包含各自的原生 runner。按 [GitHub runner images](https://github.com/actions/runner-images#available-images) 使用 `macos-15` (ARM64)、`macos-15-intel` (x64)、`windows-2022` (x64)、`ubuntu-24.04` (x64)。固定工具输入并校验输出，但不承诺不同 runner 镜像、签名时间和磁盘映像的逐字节一致性。

启用可选签名时设置以下 **Actions repository variables** 和 **`release-signing` Environment secrets**。变量未设或为 `false` 时不发布相应真机包：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `RELEASE_ANDROID_SIGNED` | `true` 启用长期签名 APK |
| Variable | `ANDROID_KEY_ALIAS` | 长期密钥的别名 |
| Variable | `ANDROID_CERT_SHA256` | 长期签名证书的 SHA-256 指纹（64 位十六进制，无冒号） |
| Secret | `ANDROID_KEYSTORE_B64` | 长期 keystore 的单行 Base64 |
| Secret | `ANDROID_KEYSTORE_PASSWORD` | keystore 和私钥共同使用的密码 |
| Variable | `RELEASE_IOS_DEVICE` | `true` 启用 Ad Hoc IPA。**IPA 内嵌描述文件，任何下载者都能读取注册设备 UDID 和相关签发信息；公开仓库默认不要启用。** 仅在允许公开这些信息，或 Release 访问者均获授权时启用。 |
| Secret | `IOS_CERTIFICATE_P12_B64` | 含私钥的有效 Apple Distribution `.p12`，单行 Base64 |
| Secret | `IOS_CERTIFICATE_PASSWORD` | `.p12` 的密码 |
| Secret | `IOS_PROVISIONING_PROFILE_B64` | 与该证书、`app.yantai.deepseek` 及授权设备匹配且未过期的 iOS Ad Hoc `.mobileprovision`，单行 Base64 |

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
