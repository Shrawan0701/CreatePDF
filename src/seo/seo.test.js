import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TOOLS } from '../data/tools';
import { getPageSeo, INDEXABLE_PATHS, siteOrigin } from './metadata';
import { TOOL_GUIDES, FEATURED_SEO_TOOLS } from './toolGuides';
import { ToolGuide } from './GuideContent';
import config from '../../vercel.json';

describe('route SEO coverage', () => {
  it('gives every tool unique titles, descriptions, workflow guidance and canonical URLs', () => {
    const entries = TOOLS.map((tool) => getPageSeo(tool.route));
    expect(new Set(entries.map((entry) => entry.title)).size).toBe(TOOLS.length);
    expect(new Set(entries.map((entry) => entry.description)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      const seo = getPageSeo(tool.route);
      expect(TOOL_GUIDES[tool.id][1]).toHaveLength(3);
      expect(seo.canonical).toBe(`https://createpdf.si${tool.route}`);
      expect(seo.indexable).toBe(true);
      expect(seo.description.length).toBeLessThanOrEqual(165);
      expect(renderToStaticMarkup(createElement(ToolGuide, { tool }))).toContain(`How to use ${tool.name.replaceAll('&', '&amp;')}`);
      expect(seo.structuredData['@graph'].some((entry) => entry['@type'] === 'WebApplication')).toBe(true);
    }
    expect(FEATURED_SEO_TOOLS.every((id) => TOOLS.some((tool) => tool.id === id))).toBe(true);
  });
  it('keeps settings and unknown routes out of search, and strips query/fragment variants', () => {
    expect(getPageSeo('/settings').robots).toContain('noindex');
    expect(getPageSeo('/does-not-exist').indexable).toBe(false);
    expect(getPageSeo('/merge-pdf/?ref=test#preview').canonical).toBe('https://createpdf.si/merge-pdf');
    expect(INDEXABLE_PATHS).not.toContain('/settings');
  });
  it('has a Vercel HTML rewrite for each app route without rewriting API functions or assets', () => {
    for (const tool of TOOLS) expect(config.rewrites).toContainEqual({ source: tool.route, destination: `${tool.route}/index.html` });
    expect(config.rewrites).toContainEqual({ source: '/settings', destination: '/settings/index.html' });
    expect(config.rewrites.some((rule) => rule.source.includes('*') || rule.source.startsWith('/api'))).toBe(false);
    expect(config.functions['api/*.js'].maxDuration).toBe(120);
    expect(config.routes).toBeUndefined();
  });
  it('accepts a public HTTPS origin and rejects credentials or accidental URL paths', () => {
    expect(siteOrigin('https://www.example.com')).toBe('https://www.example.com');
    expect(() => siteOrigin('https://example.com/tools')).toThrow('HTTPS origin');
    expect(() => siteOrigin('https://secret@example.com')).toThrow('HTTPS origin');
  });
});
