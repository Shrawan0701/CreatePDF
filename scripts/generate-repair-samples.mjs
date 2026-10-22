import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Manual-use assets only. This generator does not run the application or checks.
const sections = [
  {
    title: 'Servon - Home Page Review', subtitle: 'Project report | Chapter 5.1',
    paragraphs: [
      'Overview',
      'Servon is a restaurant operations platform. The home page introduces the product, explains the main benefits, and gives visitors a clear way to request a demonstration. This report records the intended content and the decisions behind the first release.',
      'Hero section',
      'The headline is: Run Your Restaurant. We Handle the Chaos. A short introduction explains that the platform connects ordering, billing, inventory, and reporting. The primary action is Book a Demo. A second action lets an existing restaurant manager sign in.',
      'Navigation and account access',
      'The navigation contains Product, Features, Pricing, and Contact. Login opens the restaurant dashboard. Book a Demo opens a short enquiry form. Keyboard focus must remain visible on every link and button. The navigation should collapse into a menu on smaller screens.',
      'Feature overview',
      'Quick QR ordering reduces waiting time. A shared order queue helps the kitchen prepare dishes in sequence. Billing brings taxes and discounts into one receipt. Inventory alerts identify ingredients that need replenishment before service begins.',
      'Acceptance criteria',
      'The headline must be readable without overlapping the description. The demo button must work with a keyboard. Images must have alternative text. The layout must remain usable on a narrow mobile screen. Form errors should explain how to correct the entered value.',
      'Expected result',
      'A visitor can understand the product, review its benefits, and reach the demo request form without creating an account. A returning manager can open the login page directly.',
    ],
  },
  {
    title: 'Implementation and Quality Notes', subtitle: 'Project report | Chapter 5.2',
    paragraphs: [
      'Component structure',
      'The application separates navigation, hero content, feature cards, enquiry form, and footer into reusable components. Shared spacing and typography tokens keep each page consistent. The dashboard loads only after the visitor signs in.',
      'Enquiry workflow',
      'The enquiry form asks for a restaurant name, contact person, email address, and preferred demo date. Required fields are identified before submission. The interface disables duplicate submissions while a request is being processed and retains entered values if the request fails.',
      'Order lifecycle',
      'A new order begins in the received state. The kitchen moves it to preparing and then ready. The service team completes the order after delivery. Every transition records a timestamp so managers can review waiting time during peak hours.',
      'Data validation',
      'Prices must be non-negative. Quantities must be whole numbers greater than zero. Dates are displayed in the restaurant time zone. Errors are attached to the relevant input rather than replacing the entire page with a generic message.',
      'Accessibility review',
      'All actions have descriptive names. Dialogs move focus to the first available control and restore focus when closed. Status messages are announced to assistive technology. Text contrast is checked against both light and dark backgrounds.',
      'Release checklist',
      'Confirm that navigation links open the correct routes. Submit the enquiry form with valid and invalid data. Resize the layout from desktop to mobile. Verify that a slow connection does not hide the current progress. Confirm that a failed request can be retried.',
      'Handover',
      'The handover includes setup instructions, environment variable names, data migration notes, and a short guide to restoring a backup. Secrets are never copied into screenshots or sample documents. The operations team receives a list of known limitations.',
    ],
  },
  {
    title: 'Pilot Deployment Field Notes', subtitle: 'Project report | Chapter 6 | Dense text recovery sample',
    paragraphs: [
      'Preparation',
      'Before the pilot, the team met the restaurant manager and listed the tasks performed during a typical service. These included opening the register, updating unavailable dishes, accepting orders, printing receipts, reconciling payments, and closing the register at the end of the day.',
      'The team photographed existing paper menus and entered the initial catalogue. Each item was assigned a category, tax rate, preparation time, and availability flag. The manager checked spelling and prices before the data was imported into the pilot environment.',
      'Opening shift',
      'The opening checklist started with a connection check and a review of inventory alerts. Staff signed in using individual accounts. The shift lead confirmed that receipt printers were reachable and that the kitchen display showed the correct service date.',
      'The first trial order contained two main courses, one drink, and a special preparation note. Staff compared the kitchen ticket with the customer receipt. They confirmed that the note appeared on the kitchen display without changing the displayed dish name.',
      'Peak service',
      'During the busiest period, the team observed the time between order entry and preparation. The kitchen requested a larger indication for urgent orders. Service staff asked for a clearer distinction between items that were ready and orders that were fully complete.',
      'A network interruption occurred during a payment attempt. The interface retained the pending order and explained that the payment result had not yet been confirmed. Staff checked the payment terminal before trying again. This avoided collecting the same payment twice.',
      'Inventory review',
      'The inventory report showed the opening balance, deliveries, recorded usage, adjustments, and closing balance for each ingredient. The manager compared the calculated balance with a physical count. Differences were recorded as adjustments with a reason and an author.',
      'The team noted that recipe quantities must use the same unit as the stock record. A recipe expressed in grams cannot be subtracted directly from an inventory item recorded in kilograms. Unit conversion therefore takes place before a stock movement is stored.',
      'End-of-day reconciliation',
      'At the end of service, the cashier compared cash, card, and other payment totals against receipts. Voided orders were reviewed separately. Discounts were grouped by reason so the manager could distinguish promotional offers from corrections made by staff.',
      'The shift lead exported the sales summary and checked that the report covered the complete service window. The report included an opening time, closing time, restaurant identifier, currency, and the name of the staff member who completed reconciliation.',
      'Feedback and follow-up',
      'The pilot produced three immediate improvements: a larger kitchen status indicator, clearer payment progress, and a more compact order list on small tablets. The team recorded each change with an owner and a target date rather than adding untracked requests to the release.',
      'A second pilot will compare the revised workflow with the original observations. Success will be measured using preparation time, payment corrections, and the number of orders requiring manual assistance. The team will also interview staff after the closing shift.',
      'Final observation',
      'Readable information is essential in every operational document. This sample deliberately compresses text baselines and repeats selected text runs in the damaged version. Recovery should present each retained line with fresh spacing, while structural repair should preserve the original layout.',
      'Document reference: SERVON-PILOT-2026. Prepared by the product implementation team. This is fictional content for manual evaluation of PDF repair and text recovery.',
    ],
  },
];

function wrap(value, font, size, maxWidth) {
  const lines = []; let current = '';
  for (const word of value.split(/\s+/)) {
    if (current && font.widthOfTextAtSize(`${current} ${word}`, size) > maxWidth) { lines.push(current); current = ''; }
    current += `${current ? ' ' : ''}${word}`;
  }
  if (current) lines.push(current);
  return lines;
}

async function createReport(overlap) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(overlap ? 'Repair sample - overlapping selectable text' : 'Repair sample - clean reference');
  pdf.setAuthor('CreatePDF.tech'); pdf.setCreator('CreatePDF.tech');
  pdf.setSubject('Fictional project report for manually comparing repair modes');
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index], page = pdf.addPage([595.28, 841.89]);
    const ink = rgb(.12, .17, .22), accent = rgb(.17, .42, .35);
    page.drawRectangle({ x: 42, y: 745, width: 511, height: 62, color: rgb(.94, .97, .96) });
    page.drawText(section.subtitle, { x: 54, y: 786, size: 9, font: regular, color: accent });
    page.drawText(section.title, { x: 54, y: 760, size: 18, font: bold, color: ink });
    const lines = section.paragraphs.flatMap(value => wrap(value, regular, 9.2, 499).map(text => ({ text, heading: value.length < 45 })));
    const spacing = Math.min(14, 650 / lines.length);
    const fontSize = Math.min(9.2, spacing / 1.4);
    let y = 720;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const options = { x: 48, y, size: fontSize, font: line.heading ? bold : regular, color: ink };
      page.drawText(line.text, options);
      if (overlap && lineIndex % 7 === 2) page.drawText(line.text, { ...options, x: options.x + .35, y: options.y - .35 });
      // Two distinct problems: paragraphs squeezed onto one another and exact
      // duplicate overlays. The text itself stays intact and extractable.
      y -= overlap ? 3.2 : spacing;
    }
    page.drawText(`Source page ${index + 1} of ${sections.length} | Fictional manual-use sample`, { x: 48, y: 25, size: 8, font: regular, color: rgb(.4, .45, .48) });
  }
  return pdf.save({ useObjectStreams: false });
}

const clean = await createReport(false), overlapping = await createReport(true);
// Deliberately invalid cross-reference offset; all page objects/content remain.
// Native structural recovery can reconstruct references without inventing data.
const damaged = Buffer.from(Buffer.from(clean).toString('latin1').replace(/startxref\s+\d+\s+%%EOF/, 'startxref\n999999999\n%%EOF'), 'latin1');
const files = [
  ['repair-overlapping-text.pdf', overlapping],
  ['repair-clean-reference.pdf', clean],
  ['repair-damaged-structure.pdf', damaged],
  ['repair-samples-readme.txt', `Repair PDF manual-use samples\n\nAll three PDFs contain a fictional three-page project report.\n\n1. repair-overlapping-text.pdf\nChoose Recover readable text, using PDF drawing order. It should create a clean text layout and remove identical text overlays. More output pages are normal: the original dense text is reflowed at a readable size. Images and interactive content are not copied in this mode.\n\n2. repair-clean-reference.pdf\nReadable reference containing the same report content in the same source-page order. The recovered layout need not match this design exactly.\n\n3. repair-damaged-structure.pdf\nChoose Repair structure. Its startxref offset is deliberately invalid; the page content is intact. Some readers already recover this automatically. Structure repair rewrites references; it does not change text layout.\n\nRebuild pages preserves visible appearance and does not separate overlapping text. These samples are not malware and do not contain missing content.\n`],
];
for (const directory of ['../public/samples/', '../artifacts/']) {
  const path = new URL(directory, import.meta.url);
  await mkdir(path, { recursive: true });
  for (const [name, contents] of files) await writeFile(new URL(name, path), contents);
}
for (const [name] of files) process.stdout.write(`${fileURLToPath(new URL(`../public/samples/${name}`, import.meta.url))}\n`);
