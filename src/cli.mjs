#!/usr/bin/env node
/**
 * CLI 入口。
 *
 *   node src/cli.mjs <文件>            体检一份对话记录
 *   cat session.jsonl | node src/cli.mjs
 *   node src/cli.mjs <文件> --json     输出机器可读结果
 *   node src/cli.mjs <文件> --top 8    列出前 8 组冗余与 8 条中段约束（默认 3）
 *   node src/cli.mjs <文件> --offset normalized
 *                                      硬约束位置改按归一化文本里的真实偏移计算
 *
 * 零依赖：只用 node: 内置模块。
 */

import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parseInput } from "./parse.mjs";
import { analyze } from "./analyze.mjs";
import { renderReport } from "./report.mjs";

function readStdin() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function main(argv) {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  if (asJson) args.splice(args.indexOf("--json"), 1);

  // 取值型选项先把值摘出来，否则 "--top 8" 里的 8 会被当成文件名
  const takeValue = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("-")) {
      console.error(`${flag} 后面需要跟一个值`);
      return null;
    }
    args.splice(i, 2);
    return value;
  };

  const topRaw = takeValue("--top");
  if (topRaw === null) return 1;
  let top = 3;
  if (topRaw !== undefined) {
    top = Number(topRaw);
    if (!Number.isInteger(top) || top < 1) {
      console.error(`--top 需要正整数，得到 ${topRaw}`);
      return 1;
    }
  }

  const offsetMode = takeValue("--offset");
  if (offsetMode === null) return 1;
  if (offsetMode !== undefined && offsetMode !== "block" && offsetMode !== "normalized") {
    console.error(`--offset 只能是 block 或 normalized，得到 ${offsetMode}`);
    return 1;
  }

  // 认不出的选项要报错并退出：否则 --tpo 8 会被静默忽略，用户以为生效了。
  const unknown = args.filter((arg) => arg.startsWith("-"));
  if (unknown.length) {
    console.error(`认不出的选项：${unknown.join(" ")}（可用 --json、--top N、--offset block|normalized）`);
    return 1;
  }

  const fileArg = args.find((arg) => !arg.startsWith("-"));

  let raw;
  let name;
  if (fileArg) {
    const path = resolve(fileArg);
    try {
      raw = readFileSync(path, "utf-8");
    } catch (err) {
      console.error(`读不到文件：${path}\n${err.message}`);
      return 1;
    }
    name = basename(path);
  } else {
    raw = readStdin();
    name = "stdin";
    if (!raw.trim()) {
      console.error(
        [
          "用法：",
          "  node src/cli.mjs <文件>          体检一份对话记录",
          "  cat session.jsonl | node src/cli.mjs",
          "",
          "选项：",
          "  --json              输出机器可读结果",
          "  --top N             列出前 N 组冗余与 N 条中段约束（默认 3）",
          "  --offset <mode>     硬约束位置口径：block（默认）或 normalized",
          "",
          "支持：纯文本、JSON 数组、JSON 对象、JSONL。",
        ].join("\n")
      );
      return 1;
    }
  }

  let parsed;
  try {
    parsed = parseInput(raw);
  } catch (err) {
    console.error(`解析失败：${err.message}`);
    return 1;
  }

  const result = analyze(parsed.blocks, offsetMode ? { offsetMode } : {});

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          file: name,
          format: parsed.format,
          totals: result.totals,
          wasted: result.wasted,
          exactGroups: result.exactGroups,
          nearGroups: result.nearGroups,
          constraints: result.constraints,
        },
        null,
        2
      )
    );
    return 0;
  }

  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(renderReport(result, { name, format: parsed.format }, { color, top }));
  return 0;
}

process.exitCode = main(process.argv);
