/**
 * 体检逻辑。只做「能算准」的事，不猜 token 数、不下「删掉不影响理解」这种结论。
 *
 * 四项：
 *   1. 完全重复 —— 归一化后一模一样的块，多出来的那份是纯浪费，可证明
 *   2. 近重复   —— 字符 5-gram 的 Jaccard 相似度，同一段内容被改写/截断后的重复
 *   3. 硬约束位置 —— 含 must/never/必须/不要 的句子落在上下文的哪个位置，
 *                    中段是模型最容易忽略的地方（lost in the middle）
 *   4. 来源占比 —— 尤其是工具输出占了多少
 */

const CONSTRAINT_PATTERN =
  /\b(must|never|always|only|do not|don't|required|mandatory|forbidden)\b|必须|不要|禁止|只能|务必|一律|不得|严禁/i;

/** 归一化：折叠空白、去首尾，只用于比对，不影响原始统计 */
export function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** 字符 n-gram 集合 */
function shingles(text, size) {
  const set = new Set();
  const limit = text.length - size;
  for (let i = 0; i <= limit; i++) set.add(text.slice(i, i + size));
  return set;
}

function jaccard(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let hit = 0;
  for (const item of small) if (large.has(item)) hit++;
  return hit / (a.size + b.size - hit);
}

/** 并查集，用来把近重复的块聚成一组 */
function makeUnionFind(size) {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return { find, union };
}

const preview = (text, max = 72) => {
  const flat = normalizeText(text);
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export function analyze(blocks, options = {}) {
  const opts = {
    minExactChars: 40,
    minNearChars: 160,
    nearThreshold: 0.75,
    shingleSize: 5,
    middleFrom: 0.3,
    middleTo: 0.7,
    // 硬约束位置的分母口径：
    //   block      按块序号推进的 offset / 原文总长（历史行为，含块间不存在的空白）
    //   normalized 归一化文本里的流式位置 / 归一化后总长（位置是真实的字符偏移）
    // 两者只在块首有空白时不同，但归一化口径给出的百分比才对得上「文本里第几个字」。
    offsetMode: "block",
    maxNearPairs: 200000,
    ...options,
  };

  if (opts.offsetMode !== "block" && opts.offsetMode !== "normalized") {
    throw new Error(`offsetMode 只能是 block 或 normalized，得到 ${opts.offsetMode}`);
  }

  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (totalChars === 0) throw new Error("没有可分析的文本。");
  // 归一化口径的流式位置表：第 i 块的首个字符在归一化拼接串里的偏移。
  const normalized = opts.offsetMode === "normalized";
  const streamOffsets = [];
  let streamTotal = 0;
  for (const block of blocks) {
    const flat = normalizeText(block.text);
    streamOffsets.push(streamTotal);
    streamTotal += flat.length;
  }

  /* ---------------------------------------------------------- 来源占比 */
  const byRole = {};
  for (const block of blocks) {
    byRole[block.role] = (byRole[block.role] ?? 0) + block.text.length;
  }

  /* ------------------------------------------------------------ 完全重复 */
  const exactBuckets = new Map();
  for (const block of blocks) {
    const key = normalizeText(block.text);
    if (key.length < opts.minExactChars) continue;
    const bucket = exactBuckets.get(key) ?? [];
    bucket.push(block.index);
    exactBuckets.set(key, bucket);
  }

  const exactGroups = [];
  const exactMemberIndices = new Set();
  for (const [key, indices] of exactBuckets) {
    if (indices.length < 2) continue;
    exactGroups.push({
      indices,
      count: indices.length,
      chars: key.length,
      wasted: key.length * (indices.length - 1),
      preview: preview(key),
    });
    for (const i of indices) exactMemberIndices.add(i);
  }
  exactGroups.sort((a, b) => b.wasted - a.wasted);
  const exactWasted = exactGroups.reduce((sum, g) => sum + g.wasted, 0);

  /* -------------------------------------------------------------- 近重复 */
  const candidates = blocks.filter(
    (b) => !exactMemberIndices.has(b.index) && normalizeText(b.text).length >= opts.minNearChars
  );
  const sets = candidates.map((b) =>
    shingles(normalizeText(b.text), opts.shingleSize)
  );
  const uf = makeUnionFind(candidates.length);
  const pairSim = new Map();
  let pairsChecked = 0;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (pairsChecked++ > opts.maxNearPairs) break;
      const li = candidates[i].text.length;
      const lj = candidates[j].text.length;
      // 长度差太多不可能是同一段内容的改写，先剪掉
      if (Math.max(li, lj) / Math.min(li, lj) > 1.8) continue;
      const sim = jaccard(sets[i], sets[j]);
      if (sim >= opts.nearThreshold) {
        uf.union(i, j);
        pairSim.set(`${i}-${j}`, sim);
      }
    }
  }

  const nearBuckets = new Map();
  candidates.forEach((block, i) => {
    const root = uf.find(i);
    const bucket = nearBuckets.get(root) ?? [];
    bucket.push({ block, i });
    nearBuckets.set(root, bucket);
  });

  const nearGroups = [];
  for (const bucket of nearBuckets.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => b.block.text.length - a.block.text.length);
    const longest = sorted[0].block.text.length;
    const wasted = bucket.reduce((sum, x) => sum + x.block.text.length, 0) - longest;
    if (wasted <= 0) continue;
    let similarity = 1;
    for (const [key, sim] of pairSim) {
      const [i, j] = key.split("-").map(Number);
      if (bucket.some((x) => x.i === i) && bucket.some((x) => x.i === j)) {
        similarity = Math.min(similarity, sim);
      }
    }
    nearGroups.push({
      indices: sorted.map((x) => x.block.index),
      count: bucket.length,
      wasted,
      similarity,
      preview: preview(sorted[0].block.text),
    });
  }
  nearGroups.sort((a, b) => b.wasted - a.wasted);
  const nearWasted = nearGroups.reduce((sum, g) => sum + g.wasted, 0);

  /* -------------------------------------------------------- 硬约束位置 */
  // 句子切分与位置口径解耦：
  //   block      —— 位置按块序号推进的 offset / 原文总长（历史行为）
  //   normalized —— 位置是归一化拼接串里的真实字符偏移 / 归一化总长
  // 块首的空白在两种口径下的归属不同，其余情况两者完全一致。
  const SENTENCE = /[^。！？；!?;\n]+[。！？；!?;\n]?/g;
  const constraints = [];
  const constraintTotal = normalized ? streamTotal : totalChars;
  let offset = 0;
  for (const [k, block] of blocks.entries()) {
    // 归一化串里句子之间的分隔符（换行等）已被折叠，推进前缀时要补回一个空格
    const flat = normalized ? normalizeText(block.text) : "";
    let flatCursor = 0;
    for (const match of block.text.matchAll(SENTENCE)) {
      const sentence = match[0].trim();
      if (!sentence) continue;
      if (!CONSTRAINT_PATTERN.test(sentence)) continue;
      let position;
      if (normalized) {
        const flatSentence = normalizeText(sentence);
        const start = flat.indexOf(flatSentence, flatCursor);
        flatCursor = start === -1 ? flatCursor : start + flatSentence.length;
        position = (streamOffsets[k] + (start === -1 ? flatCursor : start)) / constraintTotal;
      } else {
        position = (offset + match.index) / constraintTotal;
      }
      constraints.push({
        blockIndex: block.index,
        role: block.role,
        text: preview(sentence, 60),
        position,
        middle: position >= opts.middleFrom && position <= opts.middleTo,
      });
    }
    offset += block.text.length;
  }

  /* ------------------------------------------------------------ 汇总 */
  const wastedChars = exactWasted + nearWasted;
  const middleConstraints = constraints.filter((c) => c.middle);

  return {
    totals: {
      chars: totalChars,
      blocks: blocks.length,
      byRole,
    },
    exactGroups,
    nearGroups,
    wasted: {
      chars: wastedChars,
      ratio: totalChars ? wastedChars / totalChars : 0,
      exactChars: exactWasted,
      nearChars: nearWasted,
    },
    constraints: {
      all: constraints,
      middle: middleConstraints,
      middleRatio: constraints.length ? middleConstraints.length / constraints.length : 0,
    },
    options: opts,
  };
}
