# keepdrop

**Jev 兼容的 System One，跑在你已有的 OpenAI 兼容 API 上。**
原文 keep/drop 压缩。不用 waitlist，不落本地权重。

[English](README.md)

TypeSafe 的 Jev 回答带类型的问题（choice / score / noul），不写散文。keepdrop 用同一套形状，判断 **工具结果留不留**，并且 **不摘要、不改写**。后端是你已经在付费的 Chat Completions。

这不是 Jev。数字是普通模型估计，不是 RLCD 校准概率。

## 60 秒

```bash
cp .env.example .env   # 填 key，不要提交 .env
# 本实验室默认 MiniMax-M3 @ https://api.minimaxi.com/v1

npx tsx src/cli.ts compact fixtures/transcript.sample.json -o compact.json
```

没有 key 时 compact **fail-open**：原文不动。网关挂了也不能删历史。

## 实测（2026-09-20，MiniMax-M3）

```bash
npx github:kabishou-lab/keepdrop compact --demo --markers
npx github:kabishou-lab/keepdrop compact --demo --dry-run
keepdrop eval --long
keepdrop compact session.jsonl --watch -o compact.json
```

长会话夹具 `fixtures/transcript.long.json`（合成编码 agent 日志，非产品数据），MiniMax-M3 实测 2026-09-21：

```
chars  26915 → 8512  (31.6%)
tokens~ 6729 → 2128
41s · $0.00588 · fail_open false
```

日志砍掉约 68%。`--markers` 离线基线砍到 56.3%。Pi 不提供插件，见 `examples/pi.md`。

账单工单 `decide`：urgent 0.95 / team=billing / severity=blocking，约 3.3 秒。

MiniMax 走 `reasoning_split`，keepdrop 会剥 `<think>`、读 `reasoning_content`。

## 这不是什么

不是 TypeSafe Jev，不是权重复现，v0 也不是 pi / Claude Code 插件。楔子是原文压缩。

## 许可

MIT
