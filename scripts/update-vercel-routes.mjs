import { readFile, writeFile } from 'node:fs/promises';
import { TOOLS } from '../src/data/tools.js';

const config = JSON.parse(await readFile('vercel.json', 'utf8'));
delete config.routes;
config.$schema = 'https://openapi.vercel.sh/vercel.json';
config.trailingSlash = false;
config.redirects = [
  { source: '/index.html', destination: '/', permanent: true },
  { source: '/:tool/index.html', destination: '/:tool', permanent: true },
];
config.rewrites = [...TOOLS.map((tool) => tool.route), '/settings'].map((path) => ({ source: path, destination: `${path}/index.html` }));
config.headers = [
  { source: '/api/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
  { source: '/settings', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
  { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
];
await writeFile('vercel.json', JSON.stringify(config, null, 2) + '\n');
console.log(`Configured ${config.rewrites.length} explicit Vercel page rewrites. API functions and static assets keep their own routes.`);
