<div align="center">

<img src="assets/linye-logo.png" width="112" alt="聆页 Linye logo" />

# 聆页 · Linye

**把听到的问题、手边的资料和自己的学习笔记放在一起。**

本地优先的桌面学习工作台：课程录音、实时双语字幕、基于参考文档的实时问答，以及带音标的英文回答。

Svelte 5 · TypeScript · Tauri 2 · Rust · SQLite

</div>

Linye 基于 [Cortex](https://github.com/PndaMan/cortex) 继续开发，保留课程资料管理与学习工具，并加入独立实时问答、可配置的字幕翻译通道和音标词表。应用显示名称为 Linye／聆页，使用独立标识 `study.linye.app` 和数据库 `linye.db`。

这是正在迭代的项目。识别与回答质量取决于录音条件、模型、服务器性能和参考资料，**不承诺亚秒级端到端延迟或无误识别**。

## 可以做什么

### 课程录音与双语字幕

- 录制麦克风；macOS 可选择同时采集系统声音。
- 通过 Voxtral Realtime 4B 网关接收流式原文，分别配置临时译文与最终译文模型。
- 字幕标明临时／最终状态；最终翻译失败时保留原文和可用的临时译文，不冒充最终结果。
- 最新字幕在上方，支持跟随显示和查看历史字幕。
- 停止后选择课程和主题，保存原始录音与已完成的实时转写；双语存档只采用最终译文。
- 选择“仅实时识别”可避免再次调用或下载 Whisper。没有可保存转写时，音频仍保留为未转写资料，而不是凭空生成文本。

Whisper 的本机、云端和家庭服务器转写路径仍是可选功能，**并未从源码中完全删除**。

### 独立实时问答

“实时问答”与“录制课程”是两个独立菜单，不会把问答监听保存成课程录音。

1. 选择课程，上传 PDF／DOCX 等参考文档，等待文字提取完成。
2. 勾选本次回答使用的文档，并选择实时问答模型。
3. 开始麦克风监听。识别确认的原文直接进入回答队列，不等待翻译完成。
4. 相关内容在文档中时，优先根据所选资料回答；不足时允许给出明确标注的“通用参考”。

回答历史独立滚动，最新结果在上方，查看旧答案时不会被新回答直接顶走。历史属于当前页面会话；离开页面或更换课程／参考文档会重置，尚不是持久化问答档案。

当前会提交每条非空的确认字幕，**不是专门的语义问题检测器**。背景聊天可能触发无用回答或 API 费用。请求串行处理，最多保留 8 条等待请求；模型过慢仍可能积压。

### 回答中的英文音标

- 在问答页打开“音标词表”，添加需要辅助发音的英文单词。
- 选择英式或美式读音，让模型生成音标，再人工确认、编辑和保存。
- 已保存音标显示在回答中匹配单词的下方，不为每次回答重复请求模型。
- 最多保存 200 个词，每次最多生成 30 个；暂未填写音标的单词也可保存。

模型生成的音标可能出错，多音词需要手动选择适合语境的读音。

### 资料与学习工具

- 按“课程 → 主题 → 资料”组织 PDF、DOCX／PPTX、EPUB、文字、网页、YouTube、图片和音频。
- 基于资料进行引用问答，生成速查表、闪卡、测验、模拟考试、音频概览、思维导图、信息图和幻灯片提纲。
- Markdown 笔记、日历与截止日期、FSRS 复习、Anki 导入／导出、PDF 导出、专注计时器。
- 可选家庭服务器同步、加密备份、网页搜索、Google Calendar 和 Moodle 集成。

背景音乐、电台和 mpv 播放功能已移除；课程录音与音频概览保留。

## 本地开发

准备 Rust 工具链、Bun，以及对应操作系统的 [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools。

在本仓库根目录运行：

```bash
bun install --frozen-lockfile
bun run tauri dev
```

Tauri 启动钩子会运行 `bun run sidecars`，按目标平台下载 `yt-dlp`、`age` 和 `rclone`，然后启动 Vite。首次启动和构建需要网络。

仅运行 `bun run dev` 是前端开发服务器，**不能代替提供原生 IPC 的桌面应用**。

### 按需要安装工具

| 用途 | 工具／服务 |
|---|---|
| 实时识别 | 下文的 Voxtral 网关；当前 MLX 服务脚本面向 Apple Silicon |
| 本地文本模型 | LM Studio 或 Ollama，模型需要自行下载／加载 |
| 音频转换 | FFmpeg；不包含在上述 sidecar 下载中 |
| PDF 文字提取与预览 | Poppler；部分文字层 PDF 有 Rust 提取后备 |
| Office 可视预览 | LibreOffice；DOCX／PPTX 原生文字提取不依赖它 |
| 扫描件／图片文字 | OCR 服务或配置的视觉模型 |
| 网页搜索 | 启用 JSON 输出的 SearXNG |

## 配置语音识别与模型

### 启动 Voxtral

在运行模型的 **Apple Silicon Mac** 上，从仓库根目录执行：

```bash
homelab/voxtral/setup.sh
homelab/voxtral/run.sh
```

首次设置会创建 Python／MLX 环境并下载模型。默认网关监听 `0.0.0.0:7870`，模型服务只监听 `127.0.0.1:7871`。网关令牌保存到 `.local/voxtral/token`。

macOS 上可复制令牌，不把它打印到终端：

```bash
pbcopy < .local/voxtral/token
```

在 **设置 → 集成 → 实时语音识别** 中选择 Voxtral，并填写网关地址与令牌：

- 同一台电脑：`http://127.0.0.1:7870`。
- 另一台电脑：运行模型的 Mac 的局域网地址，例如 `http://<服务器IP>:7870`；客户端的 `localhost` 不是服务器。
- Intel Mac 可以连接 Apple Silicon 服务端；这份 MLX 脚本不支持在 Intel 上原生运行模型。
- 不可信网络应使用 HTTPS／WSS 或受保护的 VPN，不要直接暴露裸服务。

默认 `VOXTRAL_DELAY_MS=480` 是模型配置延迟，**不是实际字幕或翻译延迟保证**。其他参数见 `homelab/voxtral/run.sh --help` 和 [Voxtral 说明](homelab/voxtral/README.md)。

### 选择文本模型

1. 在 **设置 → API 密钥** 中配置 LM Studio、Ollama、云端服务或自定义 OpenAI 兼容接口。
2. 在 **设置 → 模型** 中分别为实时问答、临时翻译、最终翻译、普通对话和学习材料生成分配模型。
3. LM Studio 模型下拉框打开时读取服务的 `/v1/models`；也可手动输入模型 ID。

常见本机地址为 LM Studio `http://127.0.0.1:1234/v1`、Ollama `http://127.0.0.1:11434`。跨电脑使用时填写服务端地址，并确认网络与服务监听设置。

模型不绑定 Qwen 或某个固定规模。可用小模型产生临时译文，较高质量模型处理整句最终译文；上下文和推理开销也会影响速度。TranslateGemma 使用单独适配的翻译请求路径。音标生成沿用实时问答任务的模型。

实时问答当前需要桌面 AudioWorklet 和 Voxtral；不能与课程录音同时占用采集。麦克风权限由操作系统授予；macOS 系统声音采集还需要屏幕录制权限及 macOS 15 或更新版本。

## 构建与本机签名

本机调试 `.app`，使用临时签名：

```bash
bun run macos:local
```

输出位于 `src-tauri/target/debug/bundle/macos/`。这不是公证发行包。

macOS 发布构建可按架构选择以下命令；需要安装对应 Rust target：

```bash
# Apple Silicon
rustup target add aarch64-apple-darwin
SIDECAR_TARGET=aarch64-apple-darwin bun run tauri build \
  --target aarch64-apple-darwin --bundles app,dmg \
  --config src-tauri/tauri.macos.local.conf.json

# Intel
rustup target add x86_64-apple-darwin
SIDECAR_TARGET=x86_64-apple-darwin bun run tauri build \
  --target x86_64-apple-darwin --bundles app,dmg \
  --config src-tauri/tauri.macos.local.conf.json
```

输出位于 `src-tauri/target/<目标架构>/release/bundle/`。`SIDECAR_TARGET` 必须匹配 Rust target。Ad-hoc 临时签名不等于 Developer ID 签名或 Apple 公证，不能承诺在另一台 Mac 上无需安全提示即可安装。

其他桌面平台使用 `bun run tauri build` 和各自 Tauri 系统依赖。仓库包含移动端配置，但这不代表上述实时问答链路已在手机上完成验证。

## 数据与密钥：发布前必读

**本地优先不等于不保存密钥，也不等于完全不出网。**

- 课程资料、录音、笔记与设置保存在 `study.linye.app` 对应的操作系统应用数据目录；数据库名为 `linye.db`。调试启动可用 `LINYE_DATA_DIR` 指定数据库目录。
- **当前 API key、服务令牌等设置保存于本地 SQLite，不是系统钥匙串，也没有数据库级加密。** 数据库导出和本地备份应视为敏感文件；不要分享个人应用数据目录。
- Voxtral 的 `.local/voxtral/token` 是真实运行时凭据。`.local/`、`.env*`、数据库、私钥／证书、构建产物等被 Git 忽略；**忽略规则不会保护手动上传的整个目录或 ZIP，也不会移除已提交的历史文件**。
- 同步上传过滤模型 API key；Google／Moodle 登录凭据是特定例外，在同步快照中加密。导出数据库不是脱敏导出。
- 云端模型会接收相关文本；识别网关会接收音频。网页导入、模型下载、搜索、同步、备份、日历、Moodle 和更新等启用时也可能访问网络。
- `tauri.conf.json` 中的 updater `pubkey` 是公开验签公钥，不是私钥。

上传源码前查看实际将被提交的文件，不要盲目 `git add .`：

```bash
git status --short
git ls-files -co --exclude-standard
git diff --cached --name-status
git remote -v
```

建议使用 Gitleaks 等工具扫描工作文件及 Git 历史。如果真实密钥曾进入提交，单纯删除当前文件并不够，应先撤销／轮换密钥，再处理历史。

## 验证

```bash
bun run check
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path homelab/syncd/Cargo.toml
```

测试通过不等于已经验证真实麦克风、远端模型、长时间监听或所有平台安装；这些需要另行实机测试。

## 当前边界

- 文档问答的输入有长度与数量上限，长文档会选取片段；“文档回答”标签和来源 ID 校验不是事实正确性保证。
- 实时识别仍可能漏词；大语言模型不能可靠还原未捕获的音频。原始录音应保留以便核对。
- 尚未提供完整的“二次识别＋受约束校正＋修改差异接受／拒绝”精修流程。
- **自动更新仍连接上游 Cortex**，可能覆盖本分支功能。独立发布前需配置自己的更新地址、签名及发行流程；上游安装包不是本仓库修改后的 Linye。
- 旧截图属于上游 Cortex，不作为当前 Linye 版本的运行或功能证明。

## 项目结构

```text
src/                  Svelte 页面、组件、录音／字幕／问答状态
public/               AudioWorklet 音频采集处理器
src-tauri/src/        Rust IPC、资料处理、模型适配、录音和同步
src-tauri/migrations/ SQLite 历史迁移
homelab/voxtral/      Apple Silicon 实时识别服务与网关
homelab/syncd/        独立 Rust 同步服务
homelab/              可选家庭服务器部署
docs/testing/         测试记录与验证边界
```

## 许可证与致谢

采用 [Apache License 2.0](LICENSE)。基于 Cortex 开发，保留上游及所用字体的版权与许可证说明，详见 [NOTICE](NOTICE)。模型权重、运行时及第三方服务遵循各自许可证，不因本仓库开源而自动获得相同授权。
