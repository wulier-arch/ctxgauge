/**
 * 输入解析：把各种形状的对话记录归一化成 blocks。
 *
 * 支持：
 *   - 纯文本（按空行切段）
 *   - JSON 数组（OpenAI messages 风格）
 *   - JSON 对象（含 messages / items / conversation 字段，或单条 message）
 *   - JSONL（Claude Code / Codex 的会话日志就是这种，每行一个事件）
 *
 * 设计原则：解析失败不要猜，明确报错并告诉用户支持什么。
 * 这里只做结构归一化，不做任何分析——浏览器和 CLI 共用同一份。
 */

const ROLE_ALIASES = new Map([
  ["system", "system"],
  ["developer", "system"],
  ["user", "user"],
  ["human", "user"],
  ["assistant", "assistant"],
  ["ai", "assistant"],
  ["model", "assistant"],
  ["tool", "tool"],
  ["function", "tool"],
  ["tool_result", "tool"],
  ["tool_use", "assistant"],
]);

/** 把 role 收敛到 system / user / assistant / tool / unknown */
export function normalizeRole(raw) {
  if (!raw) return "unknown";
  return ROLE_ALIASES.get(String(raw).toLowerCase()) ?? "unknown";
}

/** 从 content 里递归抽出纯文本；非文本部件（图片、工具调用参数对象）直接跳过 */
export function extractText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        // {type:"text", text:"..."} / {type:"tool_result", content:"..."}
        if (typeof part.text === "string") return part.text;
        if (part.content != null) return extractText(part.content);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (content.content != null) return extractText(content.content);
  }
  return "";
}

/** 单条 message → block（可能没有文本，返回 null） */
function messageToBlock(record, index) {
  const role = normalizeRole(
    record.role ?? record.type ?? record.sender ?? record.author
  );
  const text = extractText(
    record.content ?? record.text ?? record.message?.content ?? record.message
  );
  if (!text.trim()) return null;
  return { index, role, text };
}

/** 把一组 message 记录铺平成 blocks */
function fromRecords(records) {
  const blocks = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const block = messageToBlock(record, blocks.length);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** 纯文本 → 按空行切段 */
function fromPlainText(text) {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => ({ index, role: "unknown", text: chunk }));
}

/**
 * 解析入口。
 * @param {string} raw 文件内容
 * @returns {{format: string, blocks: Array<{index:number, role:string, text:string}>}}
 */
export function parseInput(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("输入是空的，没有可体检的内容。");
  }

  const text = raw.trim();

  // 1) JSONL：每一行都是合法 JSON 对象
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 1) {
    const records = [];
    let allJson = true;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        allJson = false;
        break;
      }
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        allJson = false;
        break;
      }
    }
    if (allJson) {
      const blocks = fromRecords(records.flat());
      if (blocks.length) return { format: "jsonl", blocks };
    }
  }

  // 2) 整份 JSON
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed;
    let parseFailed = false;
    try {
      parsed = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
    if (!parseFailed) {
      const records = Array.isArray(parsed)
        ? parsed
        : parsed.messages ?? parsed.items ?? parsed.conversation ?? [parsed];
      const blocks = Array.isArray(records) ? fromRecords(records.flat()) : [];
      if (blocks.length) return { format: "json", blocks };
      // JSON 能解析但抽不出文本：说明是不认识的字段名。这时候退回「按纯文本分析」
      // 只会把整份 JSON 当成一段话，给出没意义的结果，所以直接报错。
      throw new Error(
        "这份 JSON 里没找到带文本的 message。\n" +
          "支持的形状：数组 / {messages:[...]} / 单条 {role, content}，\n" +
          "文本字段取 content、text 或 message.content。"
      );
    }
  }

  // 3) 纯文本兜底
  const blocks = fromPlainText(text);
  if (!blocks.length) {
    throw new Error("没解析出任何内容块，请检查文件是不是空文件。");
  }
  return { format: "text", blocks };
}
