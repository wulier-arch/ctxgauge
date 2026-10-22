# 贡献指南

## 本地跑起来

零依赖，不需要 `npm install`：

```bash
git clone https://github.com/wulier-arch/ctxgauge.git
cd ctxgauge
node src/cli.mjs examples/agent-session.jsonl
```

浏览器版：任意静态服务器指向仓库根目录，打开 `/web/` 即可（`web/app.js` 会 import
`../src/*.mjs`，所以要连着 `src/` 一起服务，不能只开 `web/`）。

## 必须通过的自检

CI 会在每次 push / PR 上跑下面这些检查，提 PR 前请在本机跑一遍：

```bash
npm test              # 单元测试
npm run test:layout   # 测试文件结构自检
npm run check:docs    # 文档事实核查
```

CI 另外还会跑：全部源码与脚本的语法检查、跑一遍示例、零依赖校验，以及关键文件是否已提交。

`check:docs` 拦的是另一类问题——README 里写死的测试数、失效的相对链接、以及「已发布到
npm」这类没兑现的说法。它们不影响测试结果，却最容易在改代码时被漏掉，所以在提交时就拦住。

## 改算法时要连带改什么

`src/analyze.mjs` 里的阈值（`minExactChars`、`minNearChars`、`nearThreshold`、
`middleFrom` / `middleTo`）都是**有意选的**，改之前请：

1. 在 `test/analyze.test.mjs` 里补一个能区分「改之前」和「改之后」的用例；
2. 如果阈值会改变默认报告里出现的数字，同步更新 README 里那段真实输出。

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 支持从 stdin 读取
fix: 修正中文按显示宽度对齐
docs: 补充相似度算法说明
test: 覆盖空输入
```

提交信息用中文，一次提交只做一件事。
