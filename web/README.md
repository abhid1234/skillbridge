# SkillBridge Playground (web)

A static, **100% client-side** playground: paste a `skill.sb.md`, watch it convert
live to native files for Antigravity, Claude Code, and Codex. No backend, no upload —
the converter core runs in the browser as an ES module.

## Files

```
web/
├── index.html     # page + hero + playground shell
├── style.css      # editorial theme
├── main.js        # UI glue (plain ESM) + embedded sample skills
└── lib/           # GENERATED — the converter core compiled to browser ESM (gitignored)
```

`lib/` is built from the TypeScript converter core (`packages/cli/src`), so the web app
and the CLI share exactly one implementation — no drift.

## Build & run locally

```bash
# 1. compile the converter core to browser ESM (outputs web/lib/)
cd packages/cli && npm run build:web

# 2. serve the static folder (module scripts need http, not file://)
cd ../../web && python3 -m http.server 8771
# open http://localhost:8771
```

## Deploy (any static host)

Build step: `cd packages/cli && npm install && npm run build:web`
Publish directory: `web/`

Works on Vercel, GitHub Pages, Netlify, Cloudflare Pages, etc. There is no server
component and no runtime dependency.
