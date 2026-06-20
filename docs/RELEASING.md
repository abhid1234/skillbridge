# Releasing SkillBridge

Two things need *your* hands (auth + a purchase the CLI won't let an agent do). Everything
else is wired. Run these from the repo root unless noted.

## 1. npm publish (`skillbridge` — the name is free)

The package is at `packages/cli`, name `skillbridge`, with `publishConfig` pinned to the
**public** registry (this machine's default npm registry is the corp Artifact Registry —
`publishConfig` overrides it, so a plain `npm publish` goes to npmjs.org).

```bash
# one-time: log in to PUBLIC npm (NOT the corp registry)
npm login --registry https://registry.npmjs.org      # interactive: your npmjs.com account

cd packages/cli
npm run build            # compile dist/src (publish ships compiled JS only)
npm publish              # publishConfig → registry.npmjs.org, access public
```

Verify first if you like: `npm publish --dry-run --registry https://registry.npmjs.org`
(already checked: 26 files, ~37 kB, compiled JS + README only — no tests/source/web).

After publish: `npx @avee1234/skillbridge convert ./my-skill --to all` works for everyone.
Bump `version` in `packages/cli/package.json` for each subsequent release.

## 2. Custom domain → skill-bridge-playground.space

Vercel refuses agent-run domain purchases, so you buy it; because the repo is linked to the
`ai-edge-gallery/skillbridge` project, buying from here auto-attaches it.

```bash
# from the repo root (it's linked to the skillbridge Vercel project)
vercel domains buy skill-bridge-playground.space --scope ai-edge-gallery     # interactive purchase
# if you already own it elsewhere, instead attach it:
vercel domains add skill-bridge-playground.space skillbridge --scope ai-edge-gallery
```

Then redeploy (or it auto-serves) and verify:
```bash
vercel deploy . --prod --yes --scope ai-edge-gallery
curl -s -o /dev/null -w "%{http_code}\n" https://skill-bridge-playground.space    # expect 200
```

The site's social meta (`web/index.html` og:url / og:image) and the README/blog links
already point at `https://skill-bridge-playground.space`, so nothing else needs re-canonicalizing.

## 3. Launch posts

Drafts live **outside the repo** at `~/Core/Workspace/launch-drafts/skillbridge/`
(`SOCIAL_POSTS.md`, `BLOG_POST.md`) — never commit them. The demo-video **script** is the
only launch artifact tracked here: [`docs/demo-video-script.md`](./demo-video-script.md).

Recommended order (dev-infra audience → HN/communities lead; LinkedIn is the weakest channel
for niche dev content): **Show HN** + the X short post first, Substack same day, LinkedIn with
native video, links in the first comment. Seed a few early comments. Rotate any tokens used.
