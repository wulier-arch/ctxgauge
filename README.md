# ctxgauge · 上下文体检

> 先量清楚你的 LLM 上下文里**哪部分在浪费窗口**，再谈压缩。

![零依赖](https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-0-4ade80)
![测试](https://img.shields.io/badge/tests-28%20passing-4ade80)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A520-5fa04e)

把一段对话记录丢进去，它告诉你三件**能算准**的事：有多少内容是完全重复的、有多少是被改写过
的近重复、以及那些「必须 / 不得」的硬约束落在了上下文的哪个位置。

全部在本机跑完，不上传、不调用任何模型、不猜 token 数。

---

## 为什么需要它

2026 年做 agent，真正的成本已经不是模型调用，而是**塞进窗口的东西**。一个典型任务要几十次
工具调用，每次的输出都留在上下文里：同一份文件被读两遍、同一条命令的输出出现三次、
一条「不得修改公开 API」的约束被埋在第 43% 的位置——而中段正是模型最容易忽略的地方。

压缩工具能把这些压掉，但压缩之前你得先知道**压什么**。`ctxgauge` 就是这一步。

## 它量什么

| 指标 | 怎么算的 | 为什么可信 |
|---|---|---|
| **完全重复** | 归一化空白后逐块比对 | 一模一样的两段，删掉一份不损失任何信息，这是可证明的 |
| **近重复** | 字符 5-gram 的 Jaccard 相似度 ≥ 0.75 | 相似度是算出来的具体数值，不是「感觉像」 |
| **硬约束位置** | 含 `must` / `never` / `必须` / `不要` 等词的句子在全文的归一化位置 | 位置是确定值；30%–70% 标记为中段风险，依据是 lost-in-the-middle |
| **来源占比** | 按 system / user / assistant / tool 分类统计字符 | 纯统计，没有推断 |

## 快速开始

零依赖，不需要 `npm install`：

```bash
git clone https://github.com/wulier-arch/ctxgauge.git
cd ctxgauge

# 体检一份会话日志（Claude Code / Codex 的 .jsonl 直接能读）
node src/cli.mjs examples/agent-session.jsonl

# 也可以走 stdin
cat session.jsonl | node src/cli.mjs

# 机器可读
node src/cli.mjs examples/agent-session.jsonl --json
```

真实输出（就是上面那条命令跑出来的）：

```
ctxgauge · 上下文体检   agent-session.jsonl
格式 jsonl · 14 块 · 4,237 字符

按来源
  tool      ██████████████░░   3,598  84.9%
  assistant ██░░░░░░░░░░░░░░     425  10.0%
  system    ░░░░░░░░░░░░░░░░     129   3.0%
  user      ░░░░░░░░░░░░░░░░      85   2.0%

冗余
  完全重复  1 组 · 浪费 448 字符
  近重复    1 组 · 浪费 904 字符
  ──────────────────────────────────────────────
  合计      1,352 字符 · 31.9%

  最值得先删的几段：
   #8, #4 相似 97.9% ×2 省 904 字符
   └ $ cat src/date.js # 修改后 import { parseISO, format } from "./time.js"; //…
   #3, #7 重复 ×2 省 448 字符
   └ $ ls -la total 48 drwxr-xr-x 12 dev staff 384 Oct 21 10:02 . drwxr-xr-x …

硬约束位置
  3 条硬约束，其中 1 条落在中段（30%–70%，模型最容易忽略的位置）
   ! 43.0% 注意这里**不得**改动 `normalizeDate(input)` 的签名，它被 index.js 导出。

结论
  31.9% 的内容是可证明的重复（1,352 / 4,237 字符）。 1 条硬约束压在中段，考虑挪到开头或结尾。
  工具输出占了 84.9%，这是最值得先动的地方。
```

## 浏览器版

不想装东西就把文件拖进网页：**<https://wulier-arch.github.io/ctxgauge/>**

页面用的是和 CLI **完全同一份** `src/parse.mjs` + `src/analyze.mjs`，没有任何网络请求，
文件只在你的浏览器内存里过一遍。

## 支持哪些输入

| 形状 | 例子 |
|---|---|
| JSONL | Claude Code / Codex 的会话日志，每行一个事件 |
| JSON 数组 | OpenAI `messages` 风格：`[{role, content}, …]` |
| JSON 对象 | `{messages: [...]}` / `{items: [...]}` / 单条 `{role, content}` |
| 纯文本 | 按空行切段，用来体检任何一段长上下文 |

认不出来的结构会**明确报错**，而不是把整份 JSON 当成一段话糊过去。

## 它不做什么

这部分和上面的功能一样重要：

- **不猜 token 数**。不同模型的 tokenizer 不一样，没有 tokenizer 就给数字是不负责任的。
  这里只报字符数，以及百分比——百分比和 tokenizer 无关，换哪个模型都成立。
- **不替你决定删什么**。它给出「哪几段是重复的、省多少字符」，删不删、怎么删是你的判断。
- **不判断内容质量**。两段相似不代表其中一段没价值，可能是同一份规格的两个版本。
- **不上传、不联网**。CLI 只读本地文件，网页版没有 fetch。

## 相似度是怎么算的

不依赖任何外部库，全部在 `src/analyze.mjs` 里，可以逐行读：

1. 归一化空白后，对每块取字符 5-gram 集合；
2. 两块的 Jaccard 相似度 = 交集 / 并集；
3. ≥ 0.75 视为近重复，用并查集聚成一组；
4. 每组保留最长的那份，其余长度之和记为「可省字符」。

长度相差 1.8 倍以上的两块直接跳过比较（不可能是同一段内容的改写），这是唯一的剪枝，
阈值全部可以通过 `analyze(blocks, { nearThreshold, minNearChars, ... })` 覆盖。

## 工程约定

```bash
npm test            # 28 个测试，零依赖
npm run test:layout # 测试文件结构自检（新增模块必须有测试）
npm run check:docs  # README 里的测试数、链接、版本号必须和代码一致
```

CI 在三档 Node（20 / 24 / 26）上跑同一套检查，另外确认零依赖与关键文件已提交。

## 路线图

- [ ] 支持按 `--top N` 调整展示条数（当前固定 3 / 5）
- [ ] 导出 Markdown 报告，方便贴进 PR 描述
- [ ] 与压缩工具对接：给出「压缩前后丢掉了哪些硬约束」的对比模式

## License

[MIT](LICENSE)
