/**
 * 浏览器版：和 CLI 共用同一份解析与体检代码。
 * 页面上没有任何网络请求——文件只在本地内存里过一遍。
 *
 * 关于 import 路径：本地开发时页面在 /web/ 下，源码在 ../src/；部署到
 * GitHub Pages 的 /ctxgauge/ 下时，app.js 和 src/ 是同级，走 ./src/。
 * 两种布局都要能用，所以按顺序试，谁先成功用谁——这样不用引入打包步骤。
 */
async function loadModule(name) {
  let lastError;
  for (const base of ["./src/", "../src/"]) {
    try {
      return await import(base + name);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const { parseInput } = await loadModule("parse.mjs");
const { analyze } = await loadModule("analyze.mjs");

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(1)}%`;

const ROLE_LABELS = {
  system: "system",
  user: "user",
  assistant: "assistant",
  tool: "tool",
  unknown: "未标注",
};

/** 内置示例：一份典型的 agent 会话，工具输出占比很高，还有一段被重复读出的文件 */
const SAMPLE = [
  {
    type: "system",
    content:
      "你是一个在用户本机运行的代码助手。\n\n硬约束：\n1. 必须保持零运行时依赖。\n2. 不得修改公开 API 的函数签名。\n3. 提交信息用中文。",
  },
  { role: "user", content: "test/date.test.mjs 里两个用例挂了，帮我修一下，别动公开 API。" },
  { role: "assistant", content: "我先看仓库结构和 src/date.js 的实现，再定位问题。" },
  {
    role: "tool",
    content:
      "$ ls -la\ntotal 48\ndrwxr-xr-x  12 dev staff  384 Oct 21 10:02 .\n-rw-r--r--   1 dev staff 1204 Oct 19 09:11 package.json\n-rw-r--r--   1 dev staff 3310 Oct 20 15:22 README.md\ndrwxr-xr-x   6 dev staff  192 Oct 21 10:01 src\ndrwxr-xr-x   4 dev staff  128 Oct 21 09:58 test",
  },
  {
    role: "tool",
    content:
      "$ cat src/date.js\nimport { parseISO, format } from \"./time.js\";\n\nexport function normalizeDate(input) {\n  if (input == null) return null;\n  const raw = String(input).trim();\n  if (raw === \"\") return null;\n  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;\n  const slash = raw.match(/^(\\d{4})\\/(\\d{1,2})\\/(\\d{1,2})$/);\n  if (slash) return slash.slice(1).map((p, i) => (i ? p.padStart(2, \"0\") : p)).join(\"-\");\n  const dot = raw.match(/^(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})$/);\n  if (dot) return dot.slice(1).map((p, i) => (i ? p.padStart(2, \"0\") : p)).join(\"-\");\n  const iso = parseISO(raw);\n  if (iso) return format(iso, \"YYYY-MM-DD\");\n  return null;\n}",
  },
  {
    role: "assistant",
    content:
      "看到问题了：斜杠和点分隔的正则被多转义了一层，实际匹配的是字面反斜杠。注意这里不得改动 normalizeDate(input) 的签名，它被 index.js 导出。",
  },
  {
    role: "tool",
    content:
      "> node --test test/date.test.mjs\n✖ normalizeDate 处理斜杠分隔\n  AssertionError: expected '2026-10-21' but got 'null'\n✖ normalizeDate 处理点分隔\n  AssertionError: expected '2026-10-21' but got 'null'\nℹ tests 4\nℹ pass 2\nℹ fail 2",
  },
  {
    role: "tool",
    content:
      "$ ls -la\ntotal 48\ndrwxr-xr-x  12 dev staff  384 Oct 21 10:02 .\n-rw-r--r--   1 dev staff 1204 Oct 19 09:11 package.json\n-rw-r--r--   1 dev staff 3310 Oct 20 15:22 README.md\ndrwxr-xr-x   6 dev staff  192 Oct 21 10:01 src\ndrwxr-xr-x   4 dev staff  128 Oct 21 09:58 test",
  },
  {
    role: "tool",
    content:
      "$ cat src/date.js   # 修改后\nimport { parseISO, format } from \"./time.js\";\n\nexport function normalizeDate(input) {\n  if (input == null) return null;\n  const raw = String(input).trim();\n  if (raw === \"\") return null;\n  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;\n  const slash = raw.match(/^(\\d{4})[\\/](\\d{1,2})[\\/](\\d{1,2})$/);\n  if (slash) return slash.slice(1).map((p, i) => (i ? p.padStart(2, \"0\") : p)).join(\"-\");\n  const dot = raw.match(/^(\\d{4})[.](\\d{1,2})[.](\\d{1,2})$/);\n  if (dot) return dot.slice(1).map((p, i) => (i ? p.padStart(2, \"0\") : p)).join(\"-\");\n  return null;\n}",
  },
  { role: "assistant", content: "改完了，两个用例都过，没有新增依赖，签名没变。" },
  { role: "user", content: "好，把 CHANGELOG 补上然后提交。" },
];

function render(result, meta) {
  const { wasted, totals, exactGroups, nearGroups, constraints } = result;

  const numEl = $("waste-num");
  numEl.textContent = pct(wasted.ratio);
  numEl.className =
    "num" + (wasted.ratio >= 0.2 ? " bad" : wasted.ratio >= 0.08 ? " warn" : "");

  $("waste-cap").textContent =
    `${fmt(wasted.chars)} / ${fmt(totals.chars)} 字符是可证明的重复 · ` +
    `${totals.blocks} 块 · 格式 ${meta.format}`;

  const parts = [];
  if (wasted.chars === 0) parts.push("没有找到可证明的重复内容。");
  else parts.push(`${pct(wasted.ratio)} 的内容是可证明的重复。`);
  if (constraints.all.length && constraints.middle.length) {
    parts.push(`${constraints.middle.length} 条硬约束压在中段，考虑挪到开头或结尾。`);
  } else if (constraints.all.length) {
    parts.push("硬约束都在首尾，位置没问题。");
  }
  const toolChars = totals.byRole.tool ?? 0;
  if (toolChars / totals.chars >= 0.3) {
    parts.push(`工具输出占了 ${pct(toolChars / totals.chars)}，这是最值得先动的地方。`);
  }
  $("say").textContent = parts.join(" ");

  $("c-exact").textContent = exactGroups.length ? `${exactGroups.length} 组` : "0";
  $("c-exact-n").textContent = exactGroups.length
    ? `浪费 ${fmt(wasted.exactChars)} 字符`
    : "没有完全一样的块";

  $("c-near").textContent = nearGroups.length ? `${nearGroups.length} 组` : "0";
  $("c-near-n").textContent = nearGroups.length
    ? `浪费 ${fmt(wasted.nearChars)} 字符 · 相似度 ≥ ${pct(result.options.nearThreshold)}`
    : "没有高度相似但被改写的块";

  $("c-tool").textContent = pct(toolChars / totals.chars);
  $("c-tool-n").textContent = `${fmt(toolChars)} 字符来自工具输出`;

  /* 来源条形 */
  const roles = Object.entries(totals.byRole).sort((a, b) => b[1] - a[1]);
  $("roles").innerHTML = roles
    .map(([role, chars]) => {
      const ratio = chars / totals.chars;
      return `<div class="barline">
        <span>${ROLE_LABELS[role] ?? role}</span>
        <span class="track"><span class="fill${role === "tool" ? " tool" : ""}" style="width:${(ratio * 100).toFixed(1)}%"></span></span>
        <span class="num">${fmt(chars)}</span>
        <span class="num">${pct(ratio)}</span>
      </div>`;
    })
    .join("");

  /* 约束位置轴 */
  const axis = $("axis");
  axis.querySelectorAll(".tick").forEach((el) => el.remove());
  for (const c of constraints.all) {
    const tick = document.createElement("div");
    tick.className = "tick" + (c.middle ? " mid" : "");
    tick.style.left = `${(c.position * 100).toFixed(2)}%`;
    tick.title = `${pct(c.position)} · ${c.text}`;
    axis.appendChild(tick);
  }

  const middle = constraints.middle;
  $("constraints").innerHTML = constraints.all.length
    ? middle.length
      ? middle
          .map(
            (c) => `<div class="item" style="border-left-color: var(--amber)">
              <div class="meta">落在 ${pct(c.position)} · 块 #${c.blockIndex} · ${c.role}</div>
              <div class="txt">${escapeHtml(c.text)}</div>
            </div>`
          )
          .join("")
      : `<div class="item"><div class="txt">${constraints.all.length} 条硬约束都在首尾，位置没问题。</div></div>`
    : `<div class="item"><div class="txt">没找到含 must / never / 必须 / 不要 这类硬约束的句子。</div></div>`;

  /* 最值得先删的几段 */
  const groups = [...exactGroups, ...nearGroups].sort((a, b) => b.wasted - a.wasted).slice(0, 5);
  $("groups").innerHTML = groups.length
    ? groups
        .map((g) => {
          const kind = g.similarity === undefined ? "完全重复" : `相似 ${pct(g.similarity)}`;
          return `<div class="item">
            <div class="meta">#${g.indices.join(", #")} · ${kind} ×${g.count} · 省 ${fmt(g.wasted)} 字符</div>
            <div class="txt">${escapeHtml(g.preview)}</div>
          </div>`;
        })
        .join("")
    : `<div class="item"><div class="txt">没有可删的重复块。</div></div>`;

  $("result").style.display = "block";
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function fail(message) {
  const el = $("err");
  el.textContent = message;
  el.classList.remove("hidden");
  $("result").style.display = "none";
}

function run(raw, name) {
  $("err").classList.add("hidden");
  try {
    const parsed = parseInput(raw);
    const result = analyze(parsed.blocks);
    $("status").textContent = name ? `已体检 ${name}` : "已体检粘贴的内容";
    render(result, { format: parsed.format });
  } catch (error) {
    fail(error.message);
    $("status").textContent = "";
  }
}

/* ------------------------------------------------------------- 交互接线 */

const drop = $("drop");
const fileInput = $("file");

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("hot");
});
drop.addEventListener("dragleave", () => drop.classList.remove("hot"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("hot");
  const file = e.dataTransfer?.files?.[0];
  if (file) readFile(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) readFile(file);
});

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => run(String(reader.result ?? ""), file.name);
  reader.onerror = () => fail(`读不到这个文件：${file.name}`);
  reader.readAsText(file);
}

$("run").addEventListener("click", () => {
  const text = $("paste").value;
  if (!text.trim()) {
    fail("先拖一个文件进来，或者粘贴一段上下文。");
    return;
  }
  run(text, null);
});

$("sample").addEventListener("click", () => {
  run(SAMPLE.map((r) => JSON.stringify(r)).join("\n"), "示例会话（合成数据）");
});
