import { convertString } from "./lib/convert-core.js";
import { importToSkillBridge } from "./lib/import-core.js";
import { compatibilityMatrix } from "./lib/badge-core.js";
import { diagnose, applyFix } from "./lib/doctor-core.js";

// Sub-agent texts for the currently loaded skill (sibling agents/<name>.sb.md).
let currentAgents = [];
// Diff-vs-source toggle state.
let diffMode = false;

// Minimal LCS line diff → array of { type: 'eq'|'add'|'del', text }.
function lineDiff(aText, bText) {
  const a = aText.split("\n"), b = bText.split("\n");
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "eq", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: "del", text: a[i++] }); }
  while (j < m) { out.push({ type: "add", text: b[j++] }); }
  return out;
}

// ---- target display metadata ----
const TARGET_ORDER = ["claude-code", "antigravity", "codex", "cursor"];
const TARGET_META = {
  "claude-code": { name: "Claude Code", color: "#7a1f2b", where: ".claude/skills/" },
  "antigravity": { name: "Antigravity", color: "#3367d6", where: ".agents/skills/" },
  "codex":       { name: "Codex",       color: "#10a37f", where: ".agents/skills/" },
  "cursor":      { name: "Cursor",      color: "#7048e8", where: ".cursor/skills/" },
};

// ---- sample skills (embedded so the page is self-contained) ----
// ---- shareable permalinks (skill encoded in the URL hash) ----
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64decode(b64) {
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
function updateHash(skillText) {
  const hash = "#s=" + b64encode(skillText);
  history.replaceState(null, "", location.pathname + location.search + hash);
}
function skillFromHash() {
  const m = location.hash.match(/[#&]s=([^&]+)/);
  return m ? b64decode(m[1]) : null;
}

const SAMPLES = {
  "commit-helper": `---
name: commit-helper
description: Writes a clear, conventional-commits message for the current staged git diff. Use when the user asks to commit, write a commit message, or save my work.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [git, commits, productivity]
mcp:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "\${GITHUB_TOKEN}"
targets:
  claude-code:
    frontmatter:
      allowed-tools: "Bash(git diff*), Bash(git status*), Bash(git log*)"
---

# Commit Helper

Generate a Conventional Commits message for what is currently staged.

## Steps
1. Run \`git diff --staged\` to see the staged changes. If nothing is staged, say so and stop.
2. Run \`git log -5 --oneline\` to match the repo's existing message style.
3. Draft a message: \`<type>(<scope>): <summary>\` where type is one of feat|fix|docs|refactor|test|chore.
   - Summary <= 72 chars, imperative mood.
   - Add a body only if the change needs explanation.
4. Show the message to the user. Do **not** commit until they approve.
`,

  "explain-code (minimal / lossless core)": `---
name: explain-code
description: Explains a selected block of code in plain language, line by line. Use when the user asks what does this do, explain this code, or walk me through this.
---

# Explain Code

Given a block of code:
1. Summarize what it does in one sentence.
2. Walk through it in logical chunks (not always line-by-line) in plain language.
3. Call out any non-obvious behavior, side effects, or gotchas.
4. Keep it concise — assume a competent reader who is new to *this* code.
`,

  "screenshot-grabber (tools + http MCP, very lossy)": `---
name: screenshot-grabber
description: Captures a full-page screenshot of a URL via a hosted browser MCP and saves it locally. Use when the user asks for a screenshot of a website.
spec_version: "0.1"
keywords: [browser, screenshot, qa]
tools:
  filesystem: write
  shell:
    - "ls "
  network:
    - "api.screenshot.example"
  mcp: ["browser/capture"]
mcp:
  browser:
    url: "https://mcp.browser.example/mcp"
    headers:
      Authorization: "Bearer \${BROWSER_TOKEN}"
---

# Screenshot Grabber

1. Ask the browser MCP to capture a full-page screenshot of the given URL.
2. Save the returned image into ./screenshots/ with a timestamped filename.
3. Report the saved path to the user.
`,
};

// ---- helpers ----
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function langFor(p) {
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".toml")) return "toml";
  return "text";
}
function downloadName(p) {
  return p.replace(/^[./]+/, "").replace(/\//g, "_");
}
function selectedTargets() {
  const checked = new Set(
    [...document.querySelectorAll("#targets input:checked")].map((i) => i.value),
  );
  return TARGET_ORDER.filter((t) => checked.has(t));
}

// ---- difference analysis (what's specific to each harness) ----
const CORE_KEYS = new Set(["name", "description"]);
// tokens that mark a harness-specific MCP encoding
const MCP_TOKENS = ['"type"', "serverUrl", "bearer_token_env_var", "experimental_use_rmcp_client", "[mcp_servers"];

// In a SKILL.md, highlight frontmatter lines whose top-level key isn't part of the
// portable core (name/description) — i.e. fields this harness adds via mapping/override.
function analyzeSkillMd(content) {
  const lines = content.split("\n");
  const hl = new Set();
  const extraKeys = [];
  let fence = 0, inFm = false, curHl = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") { fence++; inFm = fence === 1; continue; }
    if (!inFm) continue;
    const m = line.match(/^(\s*)([^:\s][^:]*):/);
    if (m && m[1].length === 0) {
      const key = m[2].trim();
      curHl = !CORE_KEYS.has(key);
      if (curHl) { hl.add(i); extraKeys.push(key); }
    } else if (curHl) {
      hl.add(i); // nested/continuation under a highlighted key
    }
  }
  return { hl, extraKeys };
}

function mcpHighlights(content) {
  const hl = new Set();
  content.split("\n").forEach((ln, i) => { if (MCP_TOKENS.some((t) => ln.includes(t))) hl.add(i); });
  return hl;
}

// Render file content as per-line spans, marking highlighted (harness-specific) lines.
function renderCode(content, hl) {
  return content.split("\n")
    .map((ln, i) => `<span class="ln${hl.has(i) ? " hl" : ""}">${escapeHtml(ln) || " "}</span>`)
    .join("");
}

// Render a unified line-diff of the source skill.sb.md vs an emitted file.
function renderDiff(source, content) {
  return lineDiff(source, content)
    .map((d) => {
      const cls = d.type === "add" ? "ln dadd" : d.type === "del" ? "ln ddel" : "ln";
      const mark = d.type === "add" ? "+ " : d.type === "del" ? "- " : "  ";
      return `<span class="${cls}">${escapeHtml(mark + d.text) || " "}</span>`;
    })
    .join("");
}

// Generate a paste-into-repo shell script that installs this target's files.
function installScript(result) {
  const dirs = [];
  for (const f of result.files) {
    const slash = f.path.lastIndexOf("/");
    if (slash > 0) {
      const d = f.path.slice(0, slash);
      if (!dirs.includes(d)) dirs.push(d);
    }
  }
  const lines = ["#!/usr/bin/env bash", "set -e", "# Run from your project root."];
  for (const d of dirs) lines.push(`mkdir -p ${d}`);
  for (const f of result.files) {
    // Pick a heredoc delimiter that does NOT appear as a line in the content,
    // so content containing "SKILLBRIDGE_EOF" can't break out of the heredoc.
    let delim = "SKILLBRIDGE_EOF";
    const contentLines = f.content.split("\n");
    let n = 0;
    while (contentLines.includes(delim)) delim = `SKILLBRIDGE_EOF_${++n}`;
    lines.push(`cat > ${f.path} <<'${delim}'`);
    lines.push(f.content.replace(/\n+$/, ""));
    lines.push(delim);
  }
  return lines.join("\n") + "\n";
}

// Plain-language report of the REAL cross-harness differences SkillBridge reconciled
// (paths, MCP formats, harness-specific frontmatter, tool-permission relocation).
function portabilityReport(results) {
  const active = results.filter((r) => !r.skipped);
  const items = [];
  const dirs = [...new Set(active.map((r) => r.skillDir).filter(Boolean))];
  if (dirs.length > 1) {
    items.push(`Installed to ${dirs.length} different locations — ${dirs.map((d) => d + "/").join("   vs   ")}`);
  }
  const mcp = active.map((r) => (r.files.find((f) => /\.(json|toml)$/.test(f.path)) || {}).path).filter(Boolean);
  if (mcp.length > 1) {
    items.push(`MCP config written ${mcp.length} different ways — ${mcp.map((p) => p.split("/").pop()).join("   ·   ")} (JSON vs TOML, with renamed fields)`);
  }
  for (const r of active) {
    const skill = r.files.find((f) => f.path.endsWith("SKILL.md"));
    if (!skill) continue;
    const { extraKeys } = analyzeSkillMd(skill.content);
    if (extraKeys.length) {
      items.push(`${TARGET_META[r.target].name} keeps harness-specific frontmatter the others can't use — ${extraKeys.join(", ")}`);
    }
  }
  if (active.some((r) => r.warnings.some((w) => /tools[.:]/.test(w)))) {
    items.push("Tool permissions relocated to each harness's own mechanism (frontmatter vs permission engine vs config.toml)");
  }
  return { items, multiLocation: dirs.length > 1 };
}

// Short, plain-language badges summarizing what's distinct about this target's output.
function diffBadges(result) {
  const badges = [];
  const skill = result.files.find((f) => f.path.endsWith("SKILL.md"));
  if (skill) {
    const { extraKeys } = analyzeSkillMd(skill.content);
    badges.push(extraKeys.length ? `frontmatter +${extraKeys.join(", ")}` : "frontmatter: name + description only");
  }
  const mcp = result.files.find((f) => /\.(json|toml)$/.test(f.path));
  if (mcp) badges.push(`MCP → ${mcp.path.split("/").pop()}`);
  return badges;
}

// ---- render ----
function render() {
  const raw = $("editor").value;
  updateHash(raw);
  const targets = selectedTargets();
  const res = convertString(raw, targets, currentAgents);

  const statusEl = $("status");
  const errorsEl = $("errors");
  const summaryEl = $("summary");
  const warnEl = $("warnings");
  const legendEl = $("legend");
  const outEl = $("outputs");
  errorsEl.innerHTML = "";
  summaryEl.innerHTML = "";
  warnEl.innerHTML = "";
  legendEl.innerHTML = "";
  outEl.innerHTML = "";
  outEl.style.gridTemplateColumns = `repeat(${Math.max(targets.length, 1)}, minmax(0, 1fr))`;

  if (!res.ok) {
    statusEl.className = "status err";
    statusEl.textContent = `✗ invalid skill — ${res.errors.length} error(s)`;
    errorsEl.innerHTML = `<div class="errors"><strong>Validation errors</strong><ul>${res.errors
      .map((e) => `<li>${escapeHtml(e)}</li>`)
      .join("")}</ul></div>`;
    return;
  }

  const fileCount = res.results.reduce((n, r) => n + (r.skipped ? 0 : r.files.length), 0);
  statusEl.className = "status ok";
  statusEl.textContent = `✓ valid · ${fileCount} file(s) across ${targets.length} harness(es)`;

  // aggregate warnings (top-level + per-target)
  const warns = [...res.warnings.map((w) => ["", w])];
  for (const r of res.results) for (const w of r.warnings) warns.push([TARGET_META[r.target].name, w]);
  if (warns.length) {
    warnEl.innerHTML = `<details class="warnbox" open><summary>${warns.length} conversion note(s) — what's lossy or needs attention</summary><ul>${warns
      .map(([t, w]) => `<li>${t ? `<b>${escapeHtml(t)}:</b> ` : ""}${escapeHtml(w)}</li>`)
      .join("")}</ul></details>`;
  }

  // compatibility badge — per-harness lossless / lossy / skipped
  const matrix = compatibilityMatrix(raw);
  if (matrix.ok) {
    const badge = document.createElement("div");
    badge.className = "compat";
    for (const e of matrix.entries) {
      const pill = document.createElement("span");
      pill.className = "compat-pill compat-" + e.status;
      pill.style.borderColor = TARGET_META[e.target] ? TARGET_META[e.target].color : "#999";
      const mark = e.status === "lossless" ? "✓" : e.status === "skipped" ? "–" : "⚠";
      pill.textContent = `${TARGET_META[e.target] ? TARGET_META[e.target].name : e.target} ${mark} ${e.status}`;
      badge.appendChild(pill);
    }
    summaryEl.appendChild(badge);
  }

  // portability report — the real cross-harness differences (or "fully portable")
  const report = portabilityReport(res.results);
  const box = document.createElement("div");
  box.className = "summary";
  const title = document.createElement("p");
  title.className = "summary-title";
  if (report.items.length) {
    title.textContent = "Not just three copies — what SkillBridge reconciled for you across harnesses:";
    box.appendChild(title);
    const ul = document.createElement("ul");
    for (const it of report.items) {
      const li = document.createElement("li");
      li.textContent = it;
      ul.appendChild(li);
    }
    box.appendChild(ul);
  } else {
    box.classList.add("portable");
    title.textContent = "✓ Fully portable — this skill converts identically across all three. SkillBridge still saves you placing it correctly per harness; no rewriting needed.";
    box.appendChild(title);
  }
  summaryEl.appendChild(box);

  // legend explaining the highlight (built via DOM — no HTML injection)
  const legend = document.createElement("p");
  legend.className = "legend";
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  legend.appendChild(swatch);
  const b = document.createElement("b");
  b.textContent = "specific to this harness";
  legend.append(" highlighted lines are ", b, " — added, renamed, or reformatted during conversion. Everything else is your portable source.");
  legendEl.appendChild(legend);

  // per-target output
  for (const r of res.results) {
    const meta = TARGET_META[r.target];
    const section = document.createElement("div");
    section.className = "target";
    section.style.borderLeftColor = meta.color;
    const badges = r.skipped ? [] : diffBadges(r);
    let html = `<div class="target-head"><span class="dot" style="background:${meta.color}"></span>` +
      `<h3 style="color:${meta.color}">${meta.name}</h3>` +
      `<span class="where">${r.skillDir ? escapeHtml(r.skillDir) + "/" : meta.where}</span></div>`;
    if (badges.length) {
      html += `<div class="diffbadges">${badges.map((b) => `<span class="b">${escapeHtml(b)}</span>`).join("")}</div>`;
    }
    if (!r.skipped && r.files.length) {
      html += `<div class="install"><span class="install-label">install →</span>` +
        `<button class="btn" data-install-copy>Copy install script</button>` +
        `<button class="btn" data-install-dl>Download .sh</button></div>`;
    }
    if (r.skipped) {
      html += `<p class="skipped">skipped via targets.${r.target}.skip</p>`;
    } else {
      for (const f of r.files) {
        const isSkill = f.path.endsWith("SKILL.md");
        const body = diffMode && isSkill
          ? renderDiff(raw, f.content)
          : renderCode(f.content, isSkill ? analyzeSkillMd(f.content).hl : mcpHighlights(f.content));
        html += `<div class="file"><div class="file-head">` +
          `<span class="file-name">${escapeHtml(f.path)}</span>` +
          `<span class="lang">${diffMode && isSkill ? "diff" : langFor(f.path)}</span>` +
          `<span class="file-actions">` +
          `<button class="btn" data-copy>Copy</button>` +
          `<button class="btn" data-download>Download</button>` +
          `</span></div>` +
          `<pre><code>${body}</code></pre></div>`;
      }
    }
    section.innerHTML = html;

    // wire buttons (closured over content)
    const files = r.skipped ? [] : r.files;
    section.querySelectorAll(".file").forEach((fileEl, idx) => {
      const content = files[idx].content;
      fileEl.querySelector("[data-copy]").addEventListener("click", (ev) => {
        navigator.clipboard.writeText(content).then(() => {
          const b = ev.target;
          b.classList.add("copied");
          b.textContent = "Copied";
          setTimeout(() => { b.classList.remove("copied"); b.textContent = "Copy"; }, 1200);
        });
      });
      const dlName = downloadName(files[idx].path);
      fileEl.querySelector("[data-download]").addEventListener("click", () => {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = dlName;
        a.click();
        URL.revokeObjectURL(url);
      });
    });

    // wire install-script buttons
    if (!r.skipped && r.files.length) {
      const script = installScript(r);
      const copyBtn = section.querySelector("[data-install-copy]");
      const dlBtn = section.querySelector("[data-install-dl]");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(script).then(() => {
          copyBtn.classList.add("copied");
          copyBtn.textContent = "Copied";
          setTimeout(() => { copyBtn.classList.remove("copied"); copyBtn.textContent = "Copy install script"; }, 1200);
        });
      });
      dlBtn.addEventListener("click", () => {
        const blob = new Blob([script], { type: "text/x-shellscript" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `install-${r.target}.sh`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    outEl.appendChild(section);
  }
}

// ---- wire up ----
function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

async function loadRegistry() {
  try {
    const m = await import("./registry.gen.js");
    return {
      registry: Array.isArray(m.REGISTRY) ? m.REGISTRY : [],
      examples: Array.isArray(m.EXAMPLES) ? m.EXAMPLES : [],
    };
  } catch {
    return { registry: [], examples: [] };
  }
}

// Load a skill (and its sibling sub-agents) into the editor + re-render.
function setSkill(text, agents) {
  currentAgents = agents || [];
  $("editor").value = text;
  render();
  document.querySelector(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadIntoEditor(content) {
  setSkill(content, []);
}

async function init() {
  const sel = $("sample");
  const lookup = new Map();

  const { registry, examples } = await loadRegistry();

  const ogEx = document.createElement("optgroup");
  ogEx.label = "Examples";
  for (const key of Object.keys(SAMPLES)) {
    lookup.set(key, { skill: SAMPLES[key], agents: [] });
    const o = document.createElement("option");
    o.value = key;
    o.textContent = key;
    ogEx.appendChild(o);
  }
  // examples that carry sub-agents (e.g. code-reviewer) — demo sub-agent conversion
  for (const ex of examples) {
    const val = "example:" + ex.name;
    lookup.set(val, { skill: ex.skill, agents: ex.agents || [] });
    const o = document.createElement("option");
    o.value = val;
    o.textContent = `${ex.name} (+${(ex.agents || []).length} sub-agent${(ex.agents || []).length === 1 ? "" : "s"})`;
    ogEx.appendChild(o);
  }
  sel.appendChild(ogEx);

  if (registry.length) {
    const ogReg = document.createElement("optgroup");
    ogReg.label = `Registry (${registry.length})`;
    for (const s of registry) {
      const val = "registry:" + s.name;
      lookup.set(val, s.content);
      const o = document.createElement("option");
      o.value = val;
      o.textContent = s.name;
      ogReg.appendChild(o);
    }
    sel.appendChild(ogReg);
  }

  sel.addEventListener("change", () => {
    const v = lookup.get(sel.value);
    if (v != null) setSkill(v.skill, v.agents);
  });
  $("editor").addEventListener("input", debounce(render, 120));
  document.querySelectorAll("#targets input").forEach((i) => i.addEventListener("change", render));

  // import: native SKILL.md -> SkillBridge, fed into the main editor
  $("import-run").addEventListener("click", () => {
    const src = $("import-src").value.trim();
    const statusEl = $("import-status");
    if (!src) { statusEl.textContent = "paste a SKILL.md first"; return; }
    const res = importToSkillBridge(src, $("import-from").value);
    if (!res.ok) { statusEl.textContent = "✗ " + res.errors[0]; return; }
    currentAgents = [];
    $("editor").value = res.sbText;
    render();
    $("import-panel").open = false;
    statusEl.textContent = "";
  });

  const share = $("share");
  share.addEventListener("click", () => {
    updateHash($("editor").value);
    navigator.clipboard.writeText(location.href).then(() => {
      share.classList.add("copied");
      share.textContent = "Link copied!";
      setTimeout(() => { share.classList.remove("copied"); share.textContent = "Copy share link"; }, 1400);
    });
  });

  // diff-vs-source toggle
  $("diff-toggle").addEventListener("change", (e) => { diffMode = e.target.checked; render(); });

  // portability doctor (diagnose + apply fixes)
  const runDoctor = () => {
    const panel = $("doctor-panel");
    panel.innerHTML = "";
    const rep = diagnose($("editor").value);
    const box = document.createElement("div");
    box.className = "doctor";
    if (!rep.ok) {
      box.classList.add("err");
      box.textContent = "✗ " + (rep.errors[0] || "skill does not parse");
      panel.appendChild(box); return;
    }
    if (!rep.findings.length) {
      box.classList.add("ok");
      box.textContent = "✓ no portability issues found";
      panel.appendChild(box); return;
    }
    const title = document.createElement("p");
    title.className = "doctor-title";
    title.textContent = `${rep.findings.length} portability finding(s):`;
    box.appendChild(title);
    const ul = document.createElement("ul");
    for (const f of rep.findings) {
      const li = document.createElement("li");
      if (f.level === "warn") li.className = "warn";
      li.textContent = (f.fix ? "🔧 " : "") + f.message;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const fixable = rep.findings.filter((f) => f.fix);
    if (fixable.length) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Apply ${fixable.length} fix(es)`;
      btn.addEventListener("click", () => {
        let raw = $("editor").value;
        for (const f of rep.findings) {
          if (!f.fix) continue;
          const r = applyFix(f, raw);
          if (r.ok && r.raw) raw = r.raw;
        }
        $("editor").value = raw;
        render();
        runDoctor();
      });
      box.appendChild(btn);
    }
    panel.appendChild(box);
  };
  $("doctor-btn").addEventListener("click", runDoctor);

  // registry gallery + search/filter
  const grid = $("registry-grid");
  if (registry.length) {
    $("registry-count").textContent = String(registry.length);
    const cards = registry.map((s) => {
      const card = document.createElement("div");
      card.className = "rcard";
      const h = document.createElement("h4");
      h.textContent = s.name;
      const p = document.createElement("p");
      p.textContent = s.description;
      const tags = document.createElement("div");
      tags.className = "tags";
      for (const ex of s.exercises || []) {
        const t = document.createElement("span");
        t.className = "tag";
        t.textContent = ex;
        tags.appendChild(t);
      }
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Load in playground";
      btn.addEventListener("click", () => loadIntoEditor(s.content));
      card.append(h, p, tags, btn);
      grid.appendChild(card);
      return { el: card, s };
    });

    const searchEl = $("registry-search");
    const filterBar = $("registry-filter");
    let activeEx = null;
    const apply = () => {
      const q = searchEl.value.trim().toLowerCase();
      for (const { el, s } of cards) {
        const hay = (s.name + " " + s.description + " " + (s.keywords || []).join(" ")).toLowerCase();
        const ok = (!q || hay.includes(q)) && (!activeEx || (s.exercises || []).includes(activeEx));
        el.style.display = ok ? "" : "none";
      }
    };
    for (const ex of [...new Set(registry.flatMap((s) => s.exercises || []))].sort()) {
      const chip = document.createElement("span");
      chip.className = "rchip";
      chip.textContent = ex;
      chip.addEventListener("click", () => {
        if (activeEx === ex) { activeEx = null; chip.classList.remove("active"); }
        else { activeEx = ex; filterBar.querySelectorAll(".rchip").forEach((c) => c.classList.remove("active")); chip.classList.add("active"); }
        apply();
      });
      filterBar.appendChild(chip);
    }
    searchEl.addEventListener("input", apply);
  } else {
    $("registry").style.display = "none";
  }

  // Load from a shared link if present, otherwise the default sample.
  const shared = skillFromHash();
  $("editor").value = shared != null && shared !== "" ? shared : SAMPLES["commit-helper"];
  render();
}

init();
