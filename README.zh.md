# keepdrop

**Jev 兼容的 System One，跑在你已有的 OpenAI 兼容 API 上。**
原文 keep/drop 压缩。不用 waitlist，不落本地权重。

[English](README.md)

这不是 Jev。数字是普通模型估计，不是校准概率。没有 key 时 **fail-open**，不删原文。

## 两条命令

```bash
# 离线看形状（关键字，不是模型）
npx github:kabishou-lab/keepdrop compact --demo --markers --diff

# 真会话：限速、磁盘缓存、把积压审完
keepdrop compact session.jsonl --watch --max-new 4 --diff
```

其余开关见英文 README 的 Reference。不要把 `*.keepdrop-cache.json`、曜堂、病历或公司日志喂进去。

## 合成夹具上的数字（不是真实会话）

`fixtures/transcript.long.json` 带 `[stale]` / `[superseded]`。MiniMax-M3，2026-09-21：26915 → 8512（31.6%），41s，judge $0.00588。`--markers` 同一文件到 56.3%。不能当成生产准确率。

## 许可

MIT
