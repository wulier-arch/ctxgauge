/**
 * 文档事实核查：README / CHANGELOG 里写的东西必须和代码对得上。
 *
 *   1. 零依赖：package.json 不能有 dependencies / peerDependencies
 *   2. README 写的测试数 == 实际跑出来的测试数
 *   3. package.json 的版本必须在 CHANGELOG 里有条目
 *   4. README 的相对链接必须指向存在的文件
 *   5. 不能出现「已发布到 npm」这类没兑现的说法（本包未发布）
 *
 * 运行：node scripts/check-docs.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

const read = (rel) => readFileSync(resolve(root, rel), "utf-8");
const pkg = JSON.parse(read("package.json"));

/* ------------------------------------------------------------ 1. 零依赖 */
{
  const deps = Object.keys(pkg.dependencies ?? {});
  const peer = Object.keys(pkg.peerDependencies ?? {});
  if (deps.length) errors.push(`package.json 有 dependencies：${deps.join(", ")}`);
  if (peer.length) errors.push(`package.json 有 peerDependencies：${peer.join(", ")}`);
  if (existsSync(join(root, "node_modules"))) {
    warnings.push("仓库里存在 node_modules/，确认它没有被提交");
  }
}

/* ------------------------------------------- 2. README 测试数 == 实际 */
let actualTests = null;
try {
  const out = execFileSync("node", ["--test"], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const match = out.match(/^ℹ tests (\d+)$/m);
  if (match) actualTests = Number(match[1]);
} catch (error) {
  const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  const match = out.match(/^ℹ tests (\d+)$/m);
  if (match) actualTests = Number(match[1]);
  errors.push("npm test 没有通过，先修测试再谈文档");
}

if (actualTests === null) {
  warnings.push("没能从 node --test 输出里取到测试数，跳过比对");
} else {
  const readme = read("README.md");
  const claims = [...readme.matchAll(/(\d+)\s*个测试/g)].map((m) => Number(m[1]));
  if (claims.length === 0) {
    warnings.push("README 里没写「N 个测试」，跳过比对");
  }
  for (const claim of claims) {
    if (claim !== actualTests) {
      errors.push(`README 写 ${claim} 个测试，实际 ${actualTests} 个`);
    }
  }
}

/* ------------------------------------------ 3. 版本必须在 CHANGELOG 里 */
{
  const changelog = read("CHANGELOG.md");
  if (!changelog.includes(`## [${pkg.version}]`)) {
    errors.push(`CHANGELOG.md 缺少 ${pkg.version} 的条目，但 package.json 已是该版本`);
  }
}

/* ------------------------------------------------- 4. README 相对链接 */
{
  const readme = read("README.md");
  let checked = 0;
  for (const match of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split("#")[0];
    if (!path) continue;
    checked++;
    if (!existsSync(join(root, path))) {
      errors.push(`README.md: 相对链接指向不存在的文件 —— ${target}`);
    }
  }
  if (checked === 0) warnings.push("README 里没有任何相对链接，确认正则是否失效");
}

/* ------------------------------------- 5. 不能宣称已发布到 npm */
{
  for (const file of ["README.md", "package.json"]) {
    const text = read(file);
    if (/npm (i|install|install -g) ctxgauge|npx ctxgauge/.test(text)) {
      errors.push(
        `${file}: 宣称可以用 npm/npx 安装，但这个包还没发布 —— 装上会 404`
      );
    }
  }
}

/* ------------------------------------ 6. og:image 指向的图必须真的在仓库里 */
{
  const html = read("web/index.html");
  for (const match of html.matchAll(/content="(https:\/\/wulier-arch\.github\.io\/ctxgauge\/([^"]+))"/g)) {
    const [, , file] = match;
    if (!existsSync(join(root, "web", file))) {
      errors.push(`web/index.html: og:image 指向 ${file}，但 web/${file} 不存在 —— 分享出去是裂图`);
    }
  }
}

/* --------------------------------------------------------------- 汇总 */for (const w of warnings) console.log(`⚠️  ${w}`);
for (const e of errors) console.error(`❌ ${e}`);

if (errors.length === 0) {
  console.log(`✅ 文档事实核查通过（${warnings.length} 条提示）`);
} else {
  console.error(`\n共 ${errors.length} 个问题。`);
  process.exit(1);
}
