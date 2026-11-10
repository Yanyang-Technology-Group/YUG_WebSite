import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateStoredArticles } from '../lib/articles.mjs';
import { validateSiteContent } from '../lib/site-content.mjs';
import { defaultSiteContent, migratePortalDefaults } from '../public/site-content-schema.js';
import { articles as examples } from '../public/portal-data.js';
const root = process.cwd();
const out = path.join(root, 'out');
for (const name of ['next', 'views', 'admin.html']) await rm(path.join(out, name), { recursive: true, force: true });
const hashes = new Set();
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc\s*=/i.test(match[1]) && match[2]) hashes.add("'sha256-" + createHash('sha256').update(match[2]).digest('base64') + "'");
    }
  }
}
await inspect(out);
const policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' " + [...hashes].join(' ') + "; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
await writeFile(path.join(out, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: ' + policy + '\n');
// Only published content is exported; private runtime records stay outside out/.
async function optional(name, fallback) { try { return JSON.parse(await readFile(path.join(root, 'data', name), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
const articles = validateStoredArticles((await optional('articles.json', { articles: examples.map(article => ({ ...article, status: 'published', isSample: true, source: '晏阳联合政府' })) })).articles);
const siteContent = migratePortalDefaults(validateSiteContent(await optional('site-content.json', defaultSiteContent)));
const published = articles.filter(article => article.status === 'published');
if (published.length > 898 || [...published, siteContent].some(value => Buffer.byteLength(JSON.stringify(value)) > 1500000)) throw new Error('Pages 初始快照超过 D1 单次导入上限：最多 898 篇公开文章、单条 1.5 MB。请调整公开内容快照，较大内容在初始化后分批导入。');
await writeFile(path.join(out, 'portal-seed.json'), JSON.stringify({ version: 1, articles: published, siteContent }, null, 2));
console.log('Pages 输出 out/ 已准备；公开内容快照将在首次请求时通过 D1 绑定安全导入。');
