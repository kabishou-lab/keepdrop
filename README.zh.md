# keepdrop

**Jev 兼容的 System One，跑在你已有的 OpenAI 兼容 API 上。**
原文 keep/drop 压缩。不用 waitlist，不落本地权重。

[English](README.md)

TypeSafe 的 Jev 回答带类型的问题（choice / score / noul），不写散文。keepdrop 用同一套形状，判断 **工具结果留不留**，并且 **不摘要、不改写**。后端是你已经在付费的 Chat Completions。

这不是 Jev。数字是普通模型估计，不是 RLCD 校准概率。

## 60 秒

```bash
npm install keepdrop
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_MODEL=deepseek-chat

npx keepdrop compact fixtures/transcript.sample.json -o compact.json
```

没有 key 时 compact **fail-open**：原文不动。网关挂了也不能删历史。

## compact 做什么

钉住第一条和最近 N 条；只对窗口外的完整工具对提问；一次请求问完 keep call / keep result；三种动作：`keep`、`drop_result`（截断头）、`drop`（占位，不改 user 文本）。

## 评测

夹具是合成的编码 agent transcript，不含产品或医疗数据。

```bash
npx keepdrop eval
```

未设置 `OPENAI_API_KEY` 时跑关键字基线（不是模型）。表上必须写明：后端不是 Jev。

## 这不是什么

不是 TypeSafe Jev，不是权重复现，v0 也不是 pi / Claude Code 插件。楔子是原文压缩，不是再做一个决策 SDK。

## 许可

MIT
