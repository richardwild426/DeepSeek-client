# 独立 DeepSeek 客户端路线图

砚台使用 NSH 0.5.1。应用网络权限只允许直连 `https://api.deepseek.com`，请求禁止重定向。开发和验收使用公开协议文档与本地 fixtures。

## 当前交付

| 模块 | 实现及验证范围 |
| --- | --- |
| 账户与模型 | 手动并行加载 `GET /user/balance` 和 `GET /models`。更改密钥后取消旧请求，清除旧账户信息。模型请求失败时保留内置模型。 |
| 聊天与思考 | `POST /chat/completions` 流式显示、停止、失败恢复、多轮上下文与可折叠思考。无工具的续轮发送先前回答。网页工具的续轮保留工具结构、读链接签名和按协议分段的思考。 |
| 搜索与读链接 | Flash 使用官方 `deepseek_web_search` 与 `deepseek_read_url`。提取最终 `annotations` 并显示可点击的引用，仅允许打开 HTTP(S) URL。 |
| 历史与迁移 | `Storage` 中的版本化对话集保存完整的成功轮次。支持从单会话数组与 v1 `messages` 结构迁移。迁移源保留。遇到损坏记录或未知版本时保护原数据，当前进程仍可继续聊天和导出。 |
| 图片与 PDF | NSH `Picker.pickFiles` 选择文件。校验扩展名、文件头和大小后，在发送时 multipart 上传到 `POST /files`。PDF 传 `text_recognition` 且 `purpose` 位于文件字段之前。聊天使用 `file_id`。取消或上传失败保留当前草稿。 |
| 凭据 | macOS 通过白名单中的 `/usr/bin/security` 读写和删除系统钥匙串条目。写入凭据经 stdin 传递，钥匙串读取从 stdout 返回至应用内存。headless 验证 UI 的替身调用，另用独立临时钥匙串验证假数据的写入、读取与删除。 |

协议参考 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)、[网页工具](https://api-docs.deepseek.com/guides/web_tools)、[Files API](https://api-docs.deepseek.com/guides/files_api)、[NSH 0.5.1 测试](https://nsh.dev/versions/v0.5.1/docs/testing-and-trace)与[打包](https://nsh.dev/versions/v0.5.1/docs/packaging)。

## 历史本地验收（导入功能交付前）

macOS 和 Ubuntu 24.04 ARM64 容器均通过 `nsh check` 和 16 项 NSH headless 测试。NSH 0.5.1 网络桩以完整响应体和延时模拟网络，逐字节 SSE 解析由独立测试覆盖。两平台的 JUnit 结果位于 `.nsh/out/`。现有 CI 固定 NSH 0.5.1，当前工作区没有 Git 元数据与远端 CI 结果。

| 目标 | 本地产物 | 本轮验证 |
| --- | --- | --- |
| Web | `.nsh/out/砚台/index.html` | 静态打包，Chrome headless 通过启动、设置和模拟 401 后重试 |
| macOS | `.nsh/out/砚台.app` | Apple Silicon 打包，`codesign --verify --strict` |
| iOS | `.nsh/out/ios/砚台.app` | 未签名设备包，本机无安装和运行验证 |
| iOS 模拟器 | `.nsh/out/ios-simulator/砚台.app` | 临时签名校验通过，本机无模拟器运行验证 |
| Android | `.nsh/out/android/砚台.apk` | ARM64 与 ARMv7 调试包，`apksigner verify` 通过，设备交互未测 |
| Linux | `.nsh/out/linux/砚台.tar.gz` | Ubuntu ARM64 容器打包并通过归档完整性检查 |
| Windows | 暂无 | 当前缺少 Windows 宿主和匹配的 NSH 运行器 |

## 剩余缺口

- 历史导出使用剪贴板，自动复制失败时可手动选中导出视图中的 JSON。NSH 0.5.1 暂无本项目可用的跨端保存对话框。历史受 `Storage` 的 5 MB 上限约束。
- Web、iOS、Android、Linux、Windows 使用会话内存保存密钥。目前没有适用于这些目标的安全持久化桥接。macOS 系统钥匙串操作受本机 ACL 和锁定状态影响，安装包上的授权弹窗未在本轮实测。
- NSH headless 覆盖文件选择、上传请求和引用内容。浏览器 CORS、真实系统文件选择器及 DeepSeek 云端返回仍需各平台实际环境验证。PDF 当前提取正文。七天后过期的云端附件需要重新选择上传。

## T4 发布前复验

本轮以当前工作区源码为准，候选输出写入 `.nsh/out/t4/` 下各平台独立目录。上方既有缺口仍适用，公开分发需另行完成签名、目标环境运行检查及渠道验证。

| 目标 | 最终候选（相对 `.nsh/out/t4/`） | 实测结果及公开分发卡点 |
| --- | --- | --- |
| Web | `web/砚台/index.html` 及同目录 JS、WASM | 打包和回环浏览器冒烟退出 0。侧栏首屏可见，独立 Chromium 验证设置、合成历史导入、打开、刷新和导出，外部请求和页面异常均为 0。公开托管前需在目标来源验证 HTTPS、WASM MIME 和 DeepSeek CORS。 |
| macOS | `macos/砚台.app` | ARM64 ad hoc 包，plist、字节码、Mach-O 与严格签名验证通过。NSH AppKit 开发宿主在后台完成首屏和设置冒烟（1/1），安装包的系统钥匙串授权弹窗未验证。通用包尝试退出 1，当前 NSH 只有 ARM64 runner。公开分发仍需 Developer ID 签名、公证及 Gatekeeper 验证。 |
| iOS 设备 | `ios/砚台.app` | ARM64，iOS 15.0 起，设备目标与 plist 校验通过。打包退出 0，NSH 标记未签名，严格签名校验失败。当前仅有 Command Line Tools，`xcrun devicectl` 不可用。设备安装、分发签名、描述文件及签名 IPA 待验证。 |
| iOS 模拟器 | `ios-simulator/砚台.app` | ARM64 模拟器目标，打包及 ad hoc 严格签名校验退出 0。`xcrun simctl` 不可用，运行需要完整 Xcode 和模拟器运行时。 |
| Android | `android/砚台.apk` | 临时测试签名，`apksigner verify --verbose --print-certs` 退出 0，ARM64 和 ARMv7，minSdk 26 / targetSdk 35。API 35 ARM64 无窗口模拟器冷启动，前台活动、首屏及设置页校验退出 0。真机和 ARMv7 运行待测。Play 分发需要生产签名与 AAB，以及更新签名一致性验证。 |
| Linux | `linux/砚台.tar.gz` 与 `linux/砚台/` | Ubuntu 24.04 ARM64 容器构建、`gzip -t`、`tar -tzf` 均退出 0。补齐 WebKitGTK、GStreamer 后 `ldd` 无缺失。从归档解包启动后，独立 Xvfb 中按应用 PID 找到可见的「砚台」窗口（390×844，退出 0）。其他架构、发行版与公开渠道的运行依赖待验证。 |
| Windows | 无 | 本机尝试 `nsh package --target windows` 退出 1，缺 `x86_64-pc-windows-msvc/bin/nsh-windows-app.exe`，也无可用 Windows 宿主。有匹配 NSH runner 后需验证 x64 ZIP、运行及分发签名。 |

macOS 和 Ubuntu 24.04 ARM64 各自 `nsh check` 退出 0、NSH headless 24/24 通过，保留既有 `statusBar` capability 警告。macOS 凭据界面走替身，另用显式指定的独立临时钥匙串验证假值经 stdin 写入、读回、删除及删除后退出码 44，整组退出 0。测试期间使用合成输入，未读真实 API Key，未部署、上传候选或触发发布。工作区无 Git 元数据，也未提供仓库、提交或 Actions run 链接，无法将候选关联到远端 CI。`.github/workflows/ci.yml` 仅证明已配置 Ubuntu x64 与 macOS 的测试及 Web、Linux、macOS 打包。

### 构建和复验命令

证据见 `.nsh/out/t4/evidence/`，包括各阶段日志、退出码、两个 JUnit XML 和源码 SHA-256。下列命令从项目根目录运行，`OUT` 为每个平台目录的上级。

```sh
OUT="$PWD/.nsh/out/t4"
nsh --version
nsh check
nsh test --junit "$OUT/evidence/macos-headless.xml"
nsh test --target macos --filter 'platform smoke renders and opens settings'
nsh package --target web --out "$OUT/web"
nsh package --target macos --arch arm64 --out "$OUT/macos"
nsh package --target ios --out "$OUT/ios"
nsh package --target ios-simulator --out "$OUT/ios-simulator"
codesign --verify --strict "$OUT/macos/砚台.app"
codesign --verify --strict "$OUT/ios-simulator/砚台.app"
# 苹果平台另用 plutil -lint 和 vtool -show-build 检查 plist 与 Mach-O。iOS 设备包签名校验预期失败。
# 具有 Android SDK Build Tools 35.0.1 和 Java 17 的环境，使用新生成的临时测试 keystore。
nsh package --target android --out "$OUT/android" --keystore "$TEST_KEYSTORE" \
  --key-alias androiddebugkey --keystore-password android
"$ANDROID_HOME/build-tools/35.0.1/apksigner" verify --verbose --print-certs "$OUT/android/砚台.apk"
"$ANDROID_HOME/build-tools/35.0.1/aapt" dump badging "$OUT/android/砚台.apk"
adb -s emulator-5572 install "$OUT/android/砚台.apk"
adb -s emulator-5572 shell am start -W -n app.yantai.deepseek/com.longbridge.nsh.AppActivity
adb -s emulator-5572 shell uiautomator dump /data/local/tmp/yantai-t4-ui.xml
```

Linux 在本地 OrbStack 的 `ubuntu:24.04` ARM64 容器执行。运行容器时用 `docker run --rm --pull=never -v "$PWD:/repo:ro" -v "$OUT:/out" ubuntu:24.04 bash`。将根目录的 `*.ts`、`*.tsx`、`nsh.json` 和 `tsconfig.json` 从 `/repo` 复制到容器的 `/work` 并进入该目录。安装 `curl` 和 `ca-certificates` 后，执行以下检查。

```sh
curl -fsSL --retry 2 https://nsh.dev/install.sh -o /tmp/nsh-install.sh
NSH_VERSION=v0.5.1 sh /tmp/nsh-install.sh
export PATH="$HOME/.nsh/bin:$PATH"
nsh check
nsh test --junit /out/evidence/linux-headless.xml
nsh package --target linux --out /out/linux
gzip -t /out/linux/砚台.tar.gz
tar -tzf /out/linux/砚台.tar.gz
```

GTK 冒烟在容器安装 `libgtk-4-1 libwebkitgtk-6.0-4 libgstreamer-plugins-base1.0-0 xvfb xdotool fonts-noto-cjk` 后执行。将归档解包到临时目录并进入 `砚台/`，用 `ldd ./App` 确认没有 `not found`。运行 `Xvfb :96 -screen 0 1280x900x24 -nolisten tcp`，再以 `DISPLAY=:96 GDK_BACKEND=x11 GSK_RENDERER=cairo GTK_A11Y=none ./App` 启动候选。用 `xdotool search --onlyvisible --pid "$APP_PID"` 查询窗口，再用 `xdotool getwindowname "$WINDOW_ID"` 验证标题。

Web 候选只通过回环服务提供。另开终端运行 Playwright，测试不需要输入 API Key。

```sh
python3 -m http.server 18766 --bind 127.0.0.1 --directory '.nsh/out/t4/web/砚台'
NODE_PATH="$(npm root -g)" node scripts/web-smoke.cjs http://127.0.0.1:18766/
alma iab goto http://127.0.0.1:18766/
```

## 线上 Web 发布（2026-11-19）

- **地址**：https://ds.zvector.top —— Cloudflare Worker `yantai` 静态资源，自定义域名，`workers_dev` 同时可用。
- **配置**：`wrangler.toml` 的 `[assets] directory` 指向 `.nsh/out/t4/web/砚台`，SPA 回退；路由为 `{ pattern = "ds.zvector.top", custom_domain = true }`。
- **实测**：`GET /` 返回 200 与 `<title>砚台</title>`；`app.135a6e2ca7.js`（23,357 B）与 `nsh.e92064af63.wasm`（3,776,463 B，`application/wasm`）均为 200；Alma 侧栏浏览器实际渲染出首屏、连接设置、历史、导入/导出与发送区。
- **跨域**：以 `Origin: https://ds.zvector.top` 预检 `/chat/completions`、`/models`、`/user/balance` 均返回 200，并回显该来源；无效 Key 的 `401` 响应同样带 `access-control-allow-origin`，浏览器可读取错误。
- **仍未验证**：真实 Key 的正常对话与流式增量（本轮未使用真实凭据）、`GET /models` 与余额在浏览器中的完整成功响应。
- **更新命令**：`nsh package --target web --out .nsh/out/t4/web && npx wrangler@latest deploy`。

## 新版界面原生验收（2026-11-20）

当前候选包位于 `.nsh/out/ui-native/`。`nsh check` 和 25 项 headless 回归测试通过，测试报告为 `headless.xml`。NSH 仍提示 `statusBar` 能力未授权。

- Android `android/砚台.apk` 使用独立临时测试证书打包，`apksigner verify --verbose` 通过。API 35 ARM64 模拟器以只读、无快照模式启动，关闭 Wi-Fi 和移动数据后安装。`adb shell am start -W` 报告 `Status: ok`、`LaunchState: COLD`。用 UIAutomator 验证历史抽屉开关、设置中的 API Key 字段、备份导入与导出入口、思考／搜索／读链接三个开关独立切换，以及输入问题后发送时的缺少密钥提示。控件状态快照在 `android/*.xml`。
- macOS ARM64 和 iOS Simulator 重新打包，`codesign --verify --strict` 与 `plutil -lint` 通过。两端实际界面交互待测，本机缺少可用的 `simctl` 和 `devicectl`。
