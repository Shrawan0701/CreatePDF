import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadEnv } from 'vite';
import { TOOLS } from '../src/data/tools.js';
import { getPageSeo, INDEXABLE_PATHS, DEFAULT_SITE_URL, siteOrigin } from '../src/seo/metadata.js';
import { ToolGuide, HomeGuide } from '../src/seo/GuideContent.js';

const env = loadEnv('production', process.cwd(), 'VITE_SITE_URL');
const origin = siteOrigin(process.env.VITE_SITE_URL || env.VITE_SITE_URL || DEFAULT_SITE_URL);
const template = await readFile('dist/index.html', 'utf8');
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

function head(seo) {
  const entries = [
    ['name', 'description', seo.description], ['name', 'robots', seo.robots],
    ...Object.entries({ title: seo.title, description: seo.description, type: 'website', url: seo.canonical, site_name: 'CreatePDF.si', locale: 'en_US', image: seo.image, 'image:width': '1200', 'image:height': '630', 'image:alt': 'CreatePDF.si — PDF tools for everyday document work' }).map(([key, value]) => ['property', `og:${key}`, value]),
    ...Object.entries({ card: 'summary_large_image', title: seo.title, description: seo.description, image: seo.image, 'image:alt': 'CreatePDF.si — PDF tools for everyday document work' }).map(([key, value]) => ['name', `twitter:${key}`, value]),
  ];
  return `<title>${escape(seo.title)}</title>\n${entries.map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escape(value)}" />`).join('\n')}\n<link rel="canonical" href="${escape(seo.canonical)}" />\n<script id="page-structured-data" type="application/ld+json">${json(seo.structuredData)}</script>`;
}

function pageContent(seo) {
  const header = h('header', { className: 'workspace-header' }, h('div', { className: 'header-inner' }, h('a', { href: '/', className: 'brand', 'aria-label': 'CreatePDF.si home' }, 'createpdf.si'), h('nav', { className: 'workspace-nav', 'aria-label': 'Main navigation' }, h('a', { href: '/' }, 'Overview'), h('a', { href: '/#tools' }, 'All tools'))));
  let content;
  if (seo.tool) content = h('div', { className: 'tool-page' }, h('header', { className: 'tool-page-header' }, h('h1', { className: 'tool-page-title' }, seo.tool.name), h('p', { className: 'tool-page-desc' }, seo.tool.description)), h(ToolGuide, { tool: seo.tool }));
  else if (seo.path === '/') content = h('div', { className: 'workspace-home' }, h('section', { className: 'workspace-intro' }, h('div', { className: 'intro-copy' }, h('h1', null, 'Less PDF friction.', h('br'), h('span', null, 'More getting it done.')), h('p', null, 'Make the edit. Merge the files. Send it off. Simple tools for everything between open and done.'))), h('section', { id: 'tools', className: 'tool-library' }, h('h2', null, 'Explore the PDF toolkit'), h('div', { className: 'directory-grid' }, TOOLS.map((tool) => h('article', { className: 'directory-item', key: tool.id }, h('a', { href: tool.route }, h('div', null, h('h3', null, tool.name), h('p', null, tool.description))))))), h(HomeGuide));
  else content = h('div', { className: 'tool-page' }, h('h1', { className: 'tool-page-title' }, seo.path === '/settings' ? 'Settings' : 'Page not found'), h('p', { className: 'tool-page-desc' }, seo.description), h('a', { href: '/' }, 'Browse PDF tools'));
  return renderToStaticMarkup(h('div', { className: 'app-shell' }, h('main', { className: 'main-content' }, header, h('div', { className: 'page-content' }, content))));
}

function buildHtml(seo) {
  return template.replace(/\s*<title>[\s\S]*?<\/title>/i, '').replace(/\s*<meta\s+name="description"[^>]*>/i, '').replace('</head>', `${head(seo)}\n</head>`).replace('<div id="root"></div>', `<div id="root">${pageContent(seo)}</div>`);
}

for (const path of [...INDEXABLE_PATHS, '/settings']) {
  const directory = path === '/' ? 'dist' : `dist${path}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/index.html`, buildHtml(getPageSeo(path, origin)));
}
await writeFile('dist/404.html', buildHtml(getPageSeo('/404', origin)));
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${INDEXABLE_PATHS.map((path) => `  <url><loc>${escape(`${origin}${path}`)}</loc></url>`).join('\n')}\n</urlset>\n`);
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
for (const path of [...INDEXABLE_PATHS.filter((path) => path !== '/'), '/settings']) {
  if (!config.rewrites?.some((rule) => rule.source === path && rule.destination === `${path}/index.html`)) throw new Error(`Vercel rewrite missing for ${path}. Run npm run seo:routes and commit vercel.json before deploying.`);
}
process.stdout.write(`Generated ${INDEXABLE_PATHS.length} indexable HTML pages, settings/404 pages, sitemap and robots.txt for ${origin}.\n`);
