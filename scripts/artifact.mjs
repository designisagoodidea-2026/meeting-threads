// Turns the Vite build into an Artifact page: the published page is wrapped in its own doctype, head and
// body, so it carries only the title, the stylesheet, the mount point and the script. Assets stay as
// files next to it. Usage: npm run build && node scripts/artifact.mjs <out dir>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
if (!out) throw new Error('usage: node scripts/artifact.mjs <out dir>')
const html = readFileSync('dist/index.html', 'utf8')
const pick = (re, what) => {
  const m = html.match(re)
  if (!m) throw new Error(`artifact: no ${what} in dist/index.html; run npm run build first`)
  return m[1]
}
const css = pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/, 'stylesheet')
const js = pick(/<script type="module"[^>]*src="\.\/([^"]+)"/, 'script')
const title = pick(/<title>([^<]+)<\/title>/, 'title')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync('dist/assets', join(out, 'assets'), { recursive: true })
writeFileSync(
  join(out, 'index.html'),
  `<title>${title}</title>
<link rel="stylesheet" href="${css}">
<div id="root"></div>
<script type="module" src="${js}"></script>
`,
)
console.log(`artifact page written to ${out}`)
