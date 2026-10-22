import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, normalizeText } from "../src/analyze.mjs";

/** 造一个 block 列表，省得每条测试都写全字段 */
const make = (texts) =>
  texts.map((entry, index) => {
    const [role, text] = Array.isArray(entry) ? entry : ["unknown", entry];
    return { index, role, text };
  });

const LONG = (label) =>
  `这是${label}的一段很长的内容，用来触发近重复检测。` +
  "它包含足够多的字符，让 5-gram 的 Jaccard 相似度有意义。" +
  "重复的部分应该被识别出来，而不是被当成两段独立信息。".repeat(8);

test("归一化折叠空白", () => {
  assert.equal(normalizeText("  a \n\n b\t"), "a b");
});

test("完全重复的块被合并，浪费量等于多出来的份数", () => {
  const text =
    "这条规则在上下文里出现了两次，它是完全一样的，而且长度明确超过四十个字符的阈值，用来验证完全重复的判定逻辑。";
  // 先守住前提：短于阈值时这段根本不会参与判定，测试会失去意义
  assert.ok(text.length >= 40, "用例文本必须超过 minExactChars");
  const result = analyze(make([text, "别的内容，和上面完全不一样，同样足够长以避免误判。", text]));
  assert.equal(result.exactGroups.length, 1);
  assert.equal(result.exactGroups[0].count, 2);
  assert.equal(result.exactGroups[0].wasted, normalizeText(text).length);
  assert.ok(result.wasted.chars > 0);
});

test("短文本不参与完全重复判定", () => {
  const result = analyze(make(["ok", "ok", "ok"]));
  assert.equal(result.exactGroups.length, 0);
  assert.equal(result.wasted.chars, 0);
});

test("近重复：改写过的同一段内容被识别", () => {
  const a = LONG("原始");
  const b = `${LONG("原始")}这是后来补的一句尾巴，不影响主体相似度。`;
  const result = analyze(make([a, b]));
  assert.equal(result.nearGroups.length, 1);
  assert.equal(result.nearGroups[0].count, 2);
  assert.ok(result.nearGroups[0].similarity >= 0.75);
  // 浪费量 = 两段之和减去较长那段
  const expected = a.length + b.length - Math.max(a.length, b.length);
  assert.equal(result.nearGroups[0].wasted, expected);
});

test("长度差太多的两段不做近重复比较", () => {
  const result = analyze(make([LONG("短"), `${LONG("短")}${"追加".repeat(400)}`]));
  assert.equal(result.nearGroups.length, 0);
});

test("完全重复的块不会在近重复里再算一遍", () => {
  const text = LONG("重复");
  const result = analyze(make([text, text]));
  assert.equal(result.exactGroups.length, 1);
  assert.equal(result.nearGroups.length, 0);
  // 浪费量不应该被重复计算
  assert.equal(result.wasted.chars, normalizeText(text).length);
});

test("硬约束落在中段会被标记", () => {
  const head = "开头是一些背景说明，讲清楚这个项目在做什么，没有硬约束。";
  const middle = "注意：不得修改公开 API 的函数签名。";
  const tail = "结尾是一些补充说明，同样没有约束，只是背景信息而已。";
  const result = analyze(make([head, middle, tail]));
  assert.equal(result.constraints.all.length, 1);
  assert.equal(result.constraints.middle.length, 1);
  assert.ok(result.constraints.middle[0].position > 0.3);
  assert.ok(result.constraints.middle[0].position < 0.7);
});

test("硬约束在开头不算中段风险", () => {
  const result = analyze(
    make([
      "必须保持零依赖，不得新增任何运行时依赖包。",
      "接下来是一大段背景说明，讲清楚来龙去脉和上下文信息。".repeat(4),
    ])
  );
  assert.equal(result.constraints.all.length, 1);
  assert.equal(result.constraints.middle.length, 0);
});

test("英文硬约束同样能识别", () => {
  const result = analyze(
    make([
      "背景说明，先交代一下需求。".repeat(3),
      "You must never commit directly to main.",
      "结尾说明。".repeat(3),
    ])
  );
  assert.equal(result.constraints.all.length, 1);
});

test("按来源统计字符占比", () => {
  const result = analyze(
    make([
      ["system", "系统提示".repeat(5)],
      ["tool", "工具输出".repeat(50)],
      ["user", "用户提问".repeat(5)],
    ])
  );
  assert.equal(result.totals.blocks, 3);
  assert.ok(result.totals.byRole.tool > result.totals.byRole.system);
  const sum = Object.values(result.totals.byRole).reduce((a, b) => a + b, 0);
  assert.equal(sum, result.totals.chars);
});

test("干净上下文不报假阳性", () => {
  const result = analyze(
    make([
      ["system", "你必须用中文回答，不要输出多余的解释。"],
      ["user", "帮我写一个快排。"],
      ["assistant", "好的，下面是实现思路和代码。"],
    ])
  );
  assert.equal(result.wasted.chars, 0);
  assert.equal(result.exactGroups.length, 0);
  assert.equal(result.nearGroups.length, 0);
});

test("空内容直接报错", () => {
  assert.throws(() => analyze([]), /没有可分析的文本/);
});
