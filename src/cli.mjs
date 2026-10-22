#!/usr/bin/env node
/**
 * CLI 入口。
 *
 *   node src/cli.mjs <文件>            体检一份对话记录
 *   cat session.jsonl | node src/cli.mjs
 *   node src/cli.mjs <文件> --json     输出机器可读结果
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

  const result = analyze(parsed.blocks);

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
  console.log(renderReport(result, { name, format: parsed.format }, { color }));
  return 0;
}

process.exitCode = main(process.argv);
