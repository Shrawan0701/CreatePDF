import { useEffect } from 'react';
import { getPageSeo, DEFAULT_SITE_URL } from '../seo/metadata';

export default function SeoHead({ pathname }) {
  useEffect(() => {
    const seo = getPageSeo(pathname, import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL);
    document.title = seo.title;
    const meta = (attribute, name, content) => {
      let element = document.head.querySelector(`meta[${attribute}="${name}"]`);
      if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, name); document.head.append(element); }
      element.content = content;
    };
    meta('name', 'description', seo.description); meta('name', 'robots', seo.robots);
    for (const [key, value] of Object.entries({ title: seo.title, description: seo.description, url: seo.canonical, type: 'website', site_name: 'CreatePDF.si', locale: 'en_US', image: seo.image, 'image:width': '1200', 'image:height': '630', 'image:alt': 'CreatePDF.si — PDF tools for everyday document work' })) meta('property', `og:${key}`, value);
    for (const [key, value] of Object.entries({ card: 'summary_large_image', title: seo.title, description: seo.description, image: seo.image, 'image:alt': 'CreatePDF.si — PDF tools for everyday document work' })) meta('name', `twitter:${key}`, value);
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    canonical.href = seo.canonical;
    let schema = document.getElementById('page-structured-data');
    if (!schema) { schema = document.createElement('script'); schema.type = 'application/ld+json'; schema.id = 'page-structured-data'; document.head.append(schema); }
    schema.textContent = JSON.stringify(seo.structuredData);
  }, [pathname]);
  return null;
}
