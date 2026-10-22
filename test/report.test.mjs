import { test } from "node:test";
import assert from "node:assert/strict";
import { displayWidth, renderReport, verdict } from "../src/report.mjs";
import { analyze } from "../src/analyze.mjs";

const blocks = [
  { index: 0, role: "system", text: "你必须保持零依赖，不得新增运行时依赖。" },
  { index: 1, role: "tool", text: "工具输出内容".repeat(20) },
];

test("中文按两个显示宽度算", () => {
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("a中b"), 4);
});

test("报告不含颜色控制符时是纯文本", () => {
  const result = analyze(blocks);
  const text = renderReport(result, { name: "demo.jsonl", format: "jsonl" }, { color: false });
  assert.ok(!text.includes("\x1b["));
  assert.ok(text.includes("ctxgauge"));
  assert.ok(text.includes("demo.jsonl"));
});

test("开颜色时带 ANSI 转义", () => {
  const result = analyze(blocks);
  const text = renderReport(result, { name: "demo.jsonl", format: "jsonl" }, { color: true });
  assert.ok(text.includes("\x1b["));
});

test("报告会列出每个来源的占比", () => {
  const result = analyze(blocks);
  const text = renderReport(result, { name: "x", format: "jsonl" }, { color: false });
  assert.ok(text.includes("system"));
  assert.ok(text.includes("tool"));
  assert.ok(text.includes("%"));
});

test("结论只陈述事实：没有重复就直说", () => {
  const result = analyze([
    { index: 0, role: "user", text: "帮我看看这个函数为什么慢。" },
    { index: 1, role: "assistant", text: "因为它每次都在重建索引。" },
  ]);
  const text = verdict(result);
  assert.ok(text.includes("没有找到可证明的重复内容"));
});

test("工具输出占比过高时结论会点出来", () => {
  const result = analyze(blocks);
  const text = verdict(result);
  assert.ok(text.includes("工具输出占了"));
});

test("top 选项控制冗余组与中段约束的展示条数", () => {
  // 造 5 组互不相同的完全重复块，每组 2 份
  const dup = (n) => `第${n}组重复内容，这是一段足够长的文本用于触发完全重复判定。`.repeat(3) + `标记${n}`;
  const items = [];
  for (let i = 0; i < 5; i++) {
    items.push({ index: i, role: "tool", text: dup(i) });
    items.push({ index: 100 + i, role: "tool", text: dup(i) });
  }
  const result = analyze(items);
  assert.equal(result.exactGroups.length, 5);

  const listed = (top) => {
    const text = renderReport(result, { name: "demo.jsonl", format: "jsonl" }, { color: false, top });
    return (text.match(/省 \d+ 字符/g) || []).length;
  };
  assert.equal(listed(3), 3);
  assert.equal(listed(5), 5);
});
