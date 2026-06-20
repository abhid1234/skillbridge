/**
 * Minimal, zero-dependency YAML subset — just enough for SkillBridge frontmatter.
 *
 * Supported (by design, not full YAML):
 *  - block maps via 2-space indentation
 *  - block sequences ("- item")
 *  - flow sequences ("[a, b, c]") and empty flow map "{}" / flow seq "[]"
 *  - scalars: bare strings, single/double-quoted strings, integers, true/false
 *  - full-line comments (a line whose first non-space char is '#')
 *
 * NOT supported: anchors, multi-line scalars, flow maps with entries, tags.
 * This is deliberate: SkillBridge frontmatter never needs them. Authors who need
 * exotic YAML should use a `targets.<harness>.frontmatter` override (passed through
 * by the converter, not parsed semantically here).
 */

export type YamlValue =
  | string
  | number
  | boolean
  | YamlValue[]
  | { [k: string]: YamlValue };

interface Line {
  indent: number;
  content: string;
  raw: string;
  n: number; // 1-based source line number for error messages
}

function lex(text: string): Line[] {
  const out: Line[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmedRight = raw.replace(/\s+$/, "");
    const noIndent = trimmedRight.replace(/^\s*/, "");
    if (noIndent === "" || noIndent.startsWith("#")) continue; // blank / comment
    const indent = trimmedRight.length - noIndent.length;
    out.push({ indent, content: noIndent, raw: trimmedRight, n: i + 1 });
  }
  return out;
}

/** Parse a scalar token (the value part of `key: value` or a flow element). */
function parseScalar(tokenRaw: string): YamlValue {
  let token = tokenRaw.trim();
  if (token === "" || token === "~" || token === "null") return "";
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "[]") return [];
  if (token === "{}") return {};
  // quoted (comments inside quotes are preserved; no stripping/coercion)
  if (token.length >= 2 && token[0] === '"' && token[token.length - 1] === '"') {
    return unescapeDouble(token.slice(1, -1));
  }
  if (token.length >= 2 && token[0] === "'" && token[token.length - 1] === "'") {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  // flow sequence
  if (token.startsWith("[") && token.endsWith("]")) {
    return splitFlow(token.slice(1, -1)).map(parseScalar);
  }
  // --- fail loud on constructs this subset cannot faithfully represent ---
  if (/^[|>][+-]?\d*$/.test(token)) {
    throw new Error(`block scalars ("| "/"> ") are not supported in SkillBridge frontmatter — use a quoted single-line string, or move long text into the body / references/`);
  }
  if (token[0] === "{") {
    throw new Error(`inline flow maps ({ ... }) are not supported — use the nested block form (key:\\n  sub: value)`);
  }
  if (token[0] === "&" || token[0] === "*" || token[0] === "!") {
    throw new Error(`YAML anchors/aliases/tags (&, *, !) are not supported in SkillBridge frontmatter`);
  }
  // strip an inline comment from a bare (unquoted) scalar: " value # note" -> "value".
  // Only when '#' is preceded by whitespace (so URLs like http://x/#frag are kept).
  const ci = token.search(/\s#/);
  if (ci >= 0) token = token.slice(0, ci).trimEnd();
  // integer — but NOT leading-zero forms (007 stays a string, matching YAML 1.2)
  if (/^-?(0|[1-9]\d*)$/.test(token)) return parseInt(token, 10);
  // bare string
  return token;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(["\\nt])/g, (_m, c) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    return c; // " or \
  });
}

/** Split a flow-sequence body on commas, respecting quotes. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (quote === '"' && ch === "\\") {
        // escaped char inside a double-quoted string — consume the next char literally
        if (i + 1 < body.length) buf += body[++i];
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ",") {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== "" || parts.length > 0) parts.push(buf);
  return parts.map((p) => p.trim()).filter((p, idx, arr) => !(p === "" && arr.length === 1));
}

/** Split `key: value` at the first colon that separates a key from its value. */
function splitKeyValue(content: string): { key: string; value: string } | null {
  // key cannot contain ':' ; find first ':' followed by space or end-of-line
  for (let i = 0; i < content.length; i++) {
    if (content[i] === ":" && (i + 1 >= content.length || content[i + 1] === " ")) {
      return { key: content.slice(0, i).trim(), value: content.slice(i + 1).trim() };
    }
  }
  return null;
}

/**
 * Parse a block (map or sequence) consisting of all lines at `indent` (and their
 * children). Returns the parsed value and the index of the first unconsumed line.
 */
function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  // Determine block kind from the first line at this indent.
  let i = start;
  const isSeq = lines[i].content.startsWith("- ") || lines[i].content === "-";

  if (isSeq) {
    const arr: YamlValue[] = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].content.startsWith("- ") || lines[i].content === "-")) {
      const itemInline = lines[i].content === "-" ? "" : lines[i].content.slice(2).trim();
      const itemIndent = indent + 2;
      if (itemInline === "") {
        // nested block belongs to this item
        const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent + 2;
        const [val, next] = parseBlock(lines, i + 1, childIndent);
        arr.push(val);
        i = next;
      } else if (splitKeyValue(itemInline)) {
        // inline map item: "- key: value" plus continuation lines indented past the dash
        const sub: Line[] = [{ indent: itemIndent, content: itemInline, raw: itemInline, n: lines[i].n }];
        i++;
        while (i < lines.length && lines[i].indent > indent) { sub.push(lines[i]); i++; }
        const [val] = parseBlock(sub, 0, itemIndent);
        arr.push(val);
      } else {
        arr.push(parseScalar(itemInline));
        i++;
      }
    }
    return [arr, i];
  }

  // map
  const map: { [k: string]: YamlValue } = {};
  while (i < lines.length && lines[i].indent === indent) {
    const kv = splitKeyValue(lines[i].content);
    if (!kv) throw new Error(`Invalid YAML at line ${lines[i].n}: expected "key: value" near "${lines[i].raw}"`);
    if (kv.value === "") {
      // value is on following indented lines (nested map/seq) — or empty
      const hasChild = i + 1 < lines.length && lines[i + 1].indent > indent;
      if (hasChild) {
        const childIndent = lines[i + 1].indent;
        const [val, next] = parseBlock(lines, i + 1, childIndent);
        map[kv.key] = val;
        i = next;
      } else {
        map[kv.key] = "";
        i++;
      }
    } else {
      map[kv.key] = parseScalar(kv.value);
      i++;
    }
  }
  return [map, i];
}

export function parseYaml(text: string): YamlValue {
  const lines = lex(text);
  if (lines.length === 0) return {};
  const baseIndent = lines[0].indent;
  const [val] = parseBlock(lines, 0, baseIndent);
  return val;
}

// ---------------------------------------------------------------------------
// Stringify (emit) — produces valid YAML for our value subset.
// ---------------------------------------------------------------------------

const BARE = /^[A-Za-z0-9_./@][A-Za-z0-9_./@-]*$/;

function isArrayOfObjects(v: YamlValue): boolean {
  return Array.isArray(v) && v.length > 0 &&
    v.every((e) => e !== null && typeof e === "object" && !Array.isArray(e) && Object.keys(e).length > 0);
}

function scalarToYaml(v: YamlValue): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "[" + v.map((e) => scalarToYaml(e)).join(", ") + "]";
  if (typeof v === "object") return "{}"; // only empty objects appear inline
  const s = String(v);
  if (s === "") return '""';
  if (BARE.test(s) && !/^(true|false|null|~)$/.test(s) && !/^-?\d+$/.test(s)) return s;
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

export function stringifyYaml(value: YamlValue, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return pad + scalarToYaml(value) + "\n";
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return pad + "{}\n";
  let out = "";
  for (const [k, v] of entries) {
    if (isArrayOfObjects(v)) {
      // YAML block sequence of maps:  key:\n  - k1: v1\n    k2: v2
      out += `${pad}${k}:\n`;
      for (const el of v as YamlValue[]) {
        const inner = stringifyYaml(el, indent + 2).replace(/\n$/, "").split("\n");
        inner[0] = "  ".repeat(indent + 1) + "- " + inner[0].slice((indent + 2) * 2);
        out += inner.join("\n") + "\n";
      }
    } else if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) {
      out += `${pad}${k}:\n` + stringifyYaml(v, indent + 1);
    } else {
      out += `${pad}${k}: ${scalarToYaml(v as YamlValue)}\n`;
    }
  }
  return out;
}
