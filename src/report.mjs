/**
 * 终端报告渲染。中英文混排要按显示宽度对齐，不能用 String.length。
 * 颜色只在 TTY 下开，管道输出保持干净。
 */

const RESET = "\x1b[0m";
const COLORS = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
};

/** 估算字符在终端里的显示宽度：CJK / 全角按 2 算 */
export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

function padEnd(text, target) {
  const gap = target - displayWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

function padStart(text, target) {
  const gap = target - displayWidth(text);
  return gap > 0 ? " ".repeat(gap) + text : text;
}

const fmt = (n) => n.toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function bar(ratio, width = 16) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

const ROLE_LABELS = {
  system: "system",
  user: "user",
  assistant: "assistant",
  tool: "tool",
  unknown: "未标注",
};

export function renderReport(result, meta = {}, options = {}) {
  const color = options.color ?? false;
  const c = (name, text) => (color ? `${COLORS[name]}${text}${RESET}` : text);
  const out = [];

  /* 标题 */
  out.push("");
  out.push(
    `${c("bold", "ctxgauge")} ${c("dim", "· 上下文体检")}   ${meta.name ?? "stdin"}`
  );
  out.push(
    c(
      "dim",
      `格式 ${meta.format ?? "?"} · ${result.totals.blocks} 块 · ${fmt(
        result.totals.chars
      )} 字符`
    )
  );

  /* 来源占比 */
  out.push("");
  out.push(c("bold", "按来源"));
  const roleEntries = Object.entries(result.totals.byRole).sort((a, b) => b[1] - a[1]);
  for (const [role, chars] of roleEntries) {
    const ratio = chars / result.totals.chars;
    const label = ROLE_LABELS[role] ?? role;
    const line = `  ${padEnd(label, 10)}${c("blue", bar(ratio))} ${padStart(
      fmt(chars),
      7
    )}  ${padStart(pct(ratio), 5)}`;
    out.push(line);
  }

  /* 冗余 */
  out.push("");
  out.push(c("bold", "冗余"));
  const { exactGroups, nearGroups, wasted } = result;
  out.push(
    `  完全重复  ${exactGroups.length} 组 · 浪费 ${fmt(wasted.exactChars)} 字符`
  );
  out.push(
    `  近重复    ${nearGroups.length} 组 · 浪费 ${fmt(wasted.nearChars)} 字符`
  );
  out.push(c("dim", "  " + "─".repeat(46)));
  const wasteColor = wasted.ratio >= 0.2 ? "red" : wasted.ratio >= 0.08 ? "yellow" : "green";
  out.push(
    `  合计      ${c(wasteColor, `${fmt(wasted.chars)} 字符 · ${pct(wasted.ratio)}`)}`
  );

  const topGroups = [...exactGroups, ...nearGroups]
    .sort((a, b) => b.wasted - a.wasted)
    .slice(0, options.top ?? 3);
  if (topGroups.length) {
    out.push("");
    out.push(c("dim", "  最值得先删的几段："));
    for (const group of topGroups) {
      const kind = group.similarity === undefined ? "重复" : `相似 ${pct(group.similarity)}`;
      out.push(
        `   ${c("dim", `#${group.indices.join(", #")}`)} ${c(
          "dim",
          `${kind} ×${group.count}`
        )} ${c("dim", `省 ${fmt(group.wasted)} 字符`)}`
      );
      out.push(`   ${c("dim", `└ ${group.preview}`)}`);
    }
  }

  /* 硬约束位置 */
  out.push("");
  out.push(c("bold", "硬约束位置"));
  const { constraints } = result;
  if (constraints.all.length === 0) {
    out.push(c("dim", "  没找到含 must / never / 必须 / 不要 这类硬约束的句子。"));
  } else {
    const line =
      `  ${constraints.all.length} 条硬约束，其中 ` +
      (constraints.middle.length
        ? c("yellow", `${constraints.middle.length} 条落在中段`)
        : c("green", "0 条落在中段")) +
      c("dim", "（30%–70%，模型最容易忽略的位置）");
    out.push(line);
    for (const item of constraints.middle.slice(0, options.top ?? 3)) {
      out.push(
        `   ${c("yellow", `! ${padStart(pct(item.position), 5)}`)} ${c("dim", item.text)}`
      );
    }
  }

  /* 结论 */
  out.push("");
  out.push(c("bold", "结论"));
  out.push(`  ${verdict(result)}`);
  out.push("");

  return out.join("\n");
}

/** 一句话结论：只陈述算得准的事实，不替用户做决定 */
export function verdict(result) {
  const { wasted, constraints, totals } = result;
  const parts = [];

  if (wasted.chars === 0) {
    parts.push("没有找到可证明的重复内容。");
  } else {
    parts.push(
      `${pct(wasted.ratio)} 的内容是可证明的重复（${fmt(wasted.chars)} / ${fmt(
        totals.chars
      )} 字符）。`
    );
  }

  if (constraints.all.length && constraints.middle.length) {
    parts.push(
      `${constraints.middle.length} 条硬约束压在中段，考虑挪到开头或结尾。`
    );
  } else if (constraints.all.length) {
    parts.push("硬约束都在首尾，位置没问题。");
  }

  const toolChars = totals.byRole.tool ?? 0;
  if (toolChars / totals.chars >= 0.3) {
    parts.push(
      `工具输出占了 ${pct(toolChars / totals.chars)}，这是最值得先动的地方。`
    );
  }

  return parts.join(" ");
}
