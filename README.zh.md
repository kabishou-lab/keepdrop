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

```
keepdrop compact  fixtures/transcript.sample.json
  eligible 3 · keep 1 · drop 2
  2268 → 2006 字符 · 7999 ms · fail_open false
```

`keepdrop eval`：9 对工具动作，MiniMax-M3 与金标 **7/9 一致**，fail-open 0。关键字基线 9/9（不是模型）。

账单工单 `decide`：urgent 0.95 / team=billing / severity=blocking，约 3.3 秒。

MiniMax 走 `reasoning_split`，keepdrop 会剥 `<think>`、读 `reasoning_content`。

## 这不是什么

不是 TypeSafe Jev，不是权重复现，v0 也不是 pi / Claude Code 插件。楔子是原文压缩。

## 许可

MIT
