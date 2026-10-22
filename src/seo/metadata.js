import { TOOLS } from '../data/tools.js';
import { SEO_TITLES, TOOL_GUIDES } from './toolGuides.js';
import { BRAND_ICONS } from '../data/brand.js';

export const DEFAULT_SITE_URL = 'https://createpdf.tech';
export function siteOrigin(value = DEFAULT_SITE_URL) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('VITE_SITE_URL must be your public HTTPS origin, for example https://createpdf.tech.');
  return url.origin;
}
export const INDEXABLE_PATHS = ['/', ...TOOLS.map((tool) => tool.route)];
export const APP_PATHS = [...INDEXABLE_PATHS, '/settings'];
export const normalizePath = (path) => path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
const snippet = (value) => value.length <= 165 ? value : `${value.slice(0, 162).replace(/\s+\S*$/, '').replace(/[.,;:]$/, '')}…`;

export function getPageSeo(pathname, origin = DEFAULT_SITE_URL) {
  const path = normalizePath(pathname);
  const site = siteOrigin(origin);
  const tool = TOOLS.find((item) => item.route === path);
  const home = path === '/';
  const indexable = home || Boolean(tool);
  const title = home ? 'Free PDF Tools Online - Convert, Edit & Merge | CreatePDF.tech' : tool ? `${SEO_TITLES[tool.id] || `${tool.name} Online`} | CreatePDF.tech` : path === '/settings' ? 'Settings | CreatePDF.tech' : 'Page Not Found | CreatePDF.tech';
  const description = home
    ? 'Free online PDF tools to merge, split, compress, edit, sign and convert documents without watermarks. Explore PDF translation, chat and AI summaries, too.'
    : tool ? snippet(`${tool.description}. ${TOOL_GUIDES[tool.id][0]}`) : path === '/settings' ? 'Manage your CreatePDF.tech appearance and local browser storage.' : 'This CreatePDF.tech page could not be found. Browse the PDF toolkit to find the tool you need.';
  const canonical = `${site}${path === '/' ? '/' : path}`;
  const webSite = { '@type': 'WebSite', '@id': `${site}/#website`, name: 'CreatePDF.tech', alternateName: 'CreatePDF', url: `${site}/`, inLanguage: 'en' };
  const organization = { '@type': 'Organization', '@id': `${site}/#organization`, name: 'CreatePDF.tech', url: `${site}/`, logo: `${site}${BRAND_ICONS.icon512}` };
  const graph = [webSite, organization];
  if (indexable) graph.push({ '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: title, description, inLanguage: 'en', isPartOf: { '@id': webSite['@id'] }, publisher: { '@id': organization['@id'] } });
  if (tool) {
    graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'PDF tools', item: `${site}/` }, { '@type': 'ListItem', position: 2, name: tool.name, item: canonical }] });
    graph.push({ '@type': 'WebApplication', '@id': `${canonical}#application`, name: tool.name, description, url: canonical, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript and a modern web browser.', isAccessibleForFree: true, ...(tool.catKey === 'ai' ? {} : { offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }), featureList: [tool.description, TOOL_GUIDES[tool.id][0]], publisher: { '@id': organization['@id'] } });
  }
  if (home) graph.push({ '@type': 'ItemList', name: 'CreatePDF.tech PDF tools', numberOfItems: TOOLS.length, itemListElement: TOOLS.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, url: `${site}${item.route}` })) });
  return { path, title, description, canonical, tool, indexable, image: `${site}/social-card.png`, robots: indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow', structuredData: { '@context': 'https://schema.org', '@graph': indexable ? graph : [] } };
}
