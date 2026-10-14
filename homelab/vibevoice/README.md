# Cortex + VibeVoice 流式识别（Apple Silicon）

## 本机启动

本工作区默认使用原始 BF16 `microsoft/VibeVoice-ASR-Streaming-1.5B`
提供低延迟实时字幕；7B 保留在 `.local/vibevoice-7b/` 供离线质量对比。
运行环境和权重位于 `.local/`，不进入 Git。

从 Cortex 仓库根目录运行：

```sh
bash homelab/vibevoice/run.sh
```

保持该进程运行；Ctrl+C 停止并释放模型。默认仅监听 `127.0.0.1:7870`。
健康检查：`curl http://127.0.0.1:7870/healthz`。
新机器需使用 Apple Silicon macOS，创建独立 Python 环境，安装本目录
`requirements.txt`，并将该模型完整快照下载到上述目录。Intel 笔记本只运行
Cortex 客户端，不运行此 MLX 服务。

## Cortex 设置

1. 设置 → 集成 → 实时语音识别，选择 **VibeVoice 流式识别**。
2. 本机地址填 `http://127.0.0.1:7870`，点击保存和测试连接。
3. 点击测试翻译，检查“设置 → 模型”中选定的对话模型；翻译沿用现有 API 配置。
4. 设置 → 音频，按需要独立选择麦克风和系统声音。默认麦克风开、系统声音关。
5. 录制课程，展开实时翻译面板，选择目标语言。停止时等待尾音识别和翻译完成。

连接错误不会自动切换其他服务或停止完整录音。字幕是预览，可复制双语文本；
选择 Cortex 的“仅实时识别”模式后，完整录音会直接保存 Voxtral 实时字幕，
不会再启动或调用 Whisper。只有主动切换到本机、云端或家庭服务器转写模式后，
重新转写才会使用 Whisper。
说话人编号由模型估计，不等于身份确认；跨新会话不保证编号一致。

## 笔记本通过局域网访问

设置 `VIBEVOICE_HOST=0.0.0.0` 并提供至少 24 字符的随机 `VIBEVOICE_TOKEN` 后启动。
将同一令牌和 Mac Studio 的局域网地址填入笔记本 Cortex。令牌在 WebSocket
首帧发送，不出现在 URL。局域网令牌沿用 Cortex 现有集成设置存储方式，
不是端到端加密；不可信网络必须使用 TLS 反向代理或受信 VPN。
本次默认启动不开放 LAN，也不修改防火墙或安装开机启动项。

## 协议和资源边界

此服务是 Cortex 的 MLX 适配器，不是微软 CUDA demo 的直接替代 URL。
`/ws/cortex` 首帧：`{"protocol":"cortex-pcm-v1","token":"..."}`。
等待 `{"type":"ready","sample_rate":16000}` 后发送单声道 16 kHz 小端 PCM16。
服务端保留重采样相位和模型 KV 缓存，使用训练配置的窗口和前瞻。
输出增量 `{type:"chunk",index,at,text}`；`at` 为音频块时间，不是词级对齐时间。
发送文本 `end` 后排空尾音，等待 `{type:"done"}`。丢块或断线不会悄悄重连拼接。

仅一个并发录音会话；接收积压最多 30 秒，单会话最长一小时。客户端翻译
独立排队，最多 12 个等待项；错误保留原文。后续需用真实长课评估延迟和说话人质量。
服务只对送入实时识别的音频做最多 4 倍温和增益，保存的完整录音不变。
Metal 分配上限 22 GiB，缓存上限 256 MiB。`/healthz` 会报告收到音频的
时长、音量、增益、已处理时长和当前积压，便于区分采集问题与推理过慢。

测试：`bun test src/lib/vibevoice.test.ts`、
`.local/vibevoice-7b/venv/bin/python homelab/vibevoice/test_server.py`。
