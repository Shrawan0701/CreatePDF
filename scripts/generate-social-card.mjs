// Optional asset maintenance. The generated PNG is committed; Vercel builds need no browser.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#f7f9f5"/><rect y="614" width="1200" height="16" fill="#327968"/>
    <rect x="72" y="64" width="54" height="54" rx="14" fill="#327968"/><g stroke="white" fill="none" stroke-width="2.5"><path d="M88 78h14l10 10v18H88z"/><path d="M102 78v12h10M94 97h12M100 93v10"/></g>
    <text x="142" y="103" font-family="Arial,sans-serif" font-size="37" font-weight="700" fill="#252f2a">createpdf<tspan fill="#738078">.tech</tspan></text>
    <text x="72" y="252" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="#252f2a">Free PDF tools.</text>
    <text x="72" y="336" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="#327968">Less busywork.</text>
    <text x="76" y="408" font-family="Arial,sans-serif" font-size="26" fill="#64736b">Convert · Merge · Compress · Edit · Sign</text>
    <rect x="76" y="466" width="365" height="54" rx="9" fill="#e4efe9"/>
    <text x="96" y="500" font-family="Arial,sans-serif" font-size="21" fill="#327968">No watermarks. No app account.</text>
    <g transform="translate(880 180) rotate(8)"><rect x="0" y="0" width="200" height="268" rx="13" fill="#e4efe9" stroke="#cbd9d0"/><rect x="-28" y="30" width="200" height="268" rx="13" fill="white" stroke="#cbd9d0"/><text x="4" y="105" font-family="Arial,sans-serif" font-size="35" font-weight="700" fill="#327968">PDF</text><g stroke="#dce5dc" stroke-width="8" stroke-linecap="round"><path d="M4 143h130M4 165h130M4 187h100"/></g><path d="m20 237 20 20 43-49" fill="none" stroke="#327968" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg></body></html>`);
  await page.screenshot({ path: 'public/social-card.png', type: 'png' });
  console.log('Generated public/social-card.png (1200 × 630).');
} finally { await browser.close(); }
