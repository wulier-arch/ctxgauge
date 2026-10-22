import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInput, extractText, normalizeRole } from "../src/parse.mjs";

test("纯文本按空行切段", () => {
  const { format, blocks } = parseInput("第一段内容。\n\n第二段内容。\n\n\n第三段。");
  assert.equal(format, "text");
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].text, "第二段内容。");
  assert.equal(blocks[0].role, "unknown");
});

test("OpenAI messages 数组", () => {
  const raw = JSON.stringify([
    { role: "system", content: "你是助手" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "在的" },
  ]);
  const { format, blocks } = parseInput(raw);
  assert.equal(format, "json");
  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((b) => b.role),
    ["system", "user", "assistant"]
  );
});

test("含 messages 字段的对象", () => {
  const raw = JSON.stringify({
    messages: [
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ],
  });
  const { blocks } = parseInput(raw);
  assert.equal(blocks.length, 2);
});

test("JSONL 每行一个事件", () => {
  const raw = [
    JSON.stringify({ type: "system", content: "约束一" }),
    JSON.stringify({ role: "user", content: "任务" }),
    JSON.stringify({ role: "tool", content: "输出" }),
  ].join("\n");
  const { format, blocks } = parseInput(raw);
  assert.equal(format, "jsonl");
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].role, "tool");
});

test("content 是部件数组时只取文本", () => {
  const raw = JSON.stringify([
    {
      role: "user",
      content: [
        { type: "text", text: "看这张图" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    },
  ]);
  const { blocks } = parseInput(raw);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "看这张图");
});

test("工具结果部件里的 content 会被抽出来", () => {
  const text = extractText([
    { type: "tool_result", content: [{ type: "text", text: "命令输出" }] },
  ]);
  assert.equal(text, "命令输出");
});

test("空输入直接报错，不返回空结果", () => {
  assert.throws(() => parseInput("   \n  "), /输入是空的/);
});

test("JSON 结构认不出来时报错，而不是把整份 JSON 当一段话", () => {
  assert.throws(() => parseInput('{"foo":1}'), /没找到带文本的 message/);
});

test("JSON 语法错误时退回纯文本", () => {
  const { format, blocks } = parseInput('{"broken": 这里少个引号}');
  assert.equal(format, "text");
  assert.equal(blocks.length, 1);
});

test("role 别名收敛", () => {
  assert.equal(normalizeRole("Human"), "user");
  assert.equal(normalizeRole("model"), "assistant");
  assert.equal(normalizeRole("developer"), "system");
  assert.equal(normalizeRole("tool_result"), "tool");
  assert.equal(normalizeRole("something-else"), "unknown");
  assert.equal(normalizeRole(undefined), "unknown");
});
