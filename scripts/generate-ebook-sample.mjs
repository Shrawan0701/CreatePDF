import { mkdir, readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const title = 'Small Steps, Better Projects'
const chapters = [
  { title: '1. Start With a Clear Goal', content: `
    <p>A useful project begins with a problem that someone can describe in ordinary language. Before choosing a framework, drawing a screen, or writing a task list, write one sentence explaining what a person should be able to accomplish.</p>
    <p>For our example, a small community library wants to track borrowed books. Its volunteers currently use a notebook. The notebook works until several people update it at once, a return date is missed, or a reader asks whether a particular book is available.</p>
    <h2>Define the first useful result</h2>
    <p>The first version should help a volunteer find a book, lend it to a reader, and record its return. These three actions form a complete workflow. Recommendation engines and elaborate dashboards can wait.</p>
    <ul><li><strong>Problem:</strong> lending records are difficult to share.</li><li><strong>Audience:</strong> volunteers working at the library desk.</li><li><strong>Outcome:</strong> an accurate record of each active loan.</li></ul>
    <blockquote>A small feature that works from beginning to end is more useful than several unfinished features.</blockquote>
    <p>Success should be observable. A volunteer should be able to check a book out without asking for technical help. Another volunteer should see that loan immediately. Returning the book should make it available again.</p>
    <p><em>Reflection:</em> Describe a project you want to build. Write the problem, the person who experiences it, and the smallest result that would help.</p>` },
  { title: '2. Plan a Manageable Week', content: `
    <p>A plan is a way to make decisions before the day becomes crowded. It should reveal the next useful action rather than attempt to predict every detail of the project.</p>
    <p>Start by separating the essential workflow from supporting improvements. For the library, checking out and returning a book are essential. A custom color theme is an improvement. Both can be valuable, but they do not have the same priority.</p>
    <h2>A sample work plan</h2>
    <table><tr><th>Day</th><th>Focus</th><th>Expected result</th></tr>
    <tr><td>Monday</td><td>Understand the workflow</td><td>Sketch the three main actions</td></tr>
    <tr><td>Tuesday</td><td>Build the book list</td><td>Search and view available books</td></tr>
    <tr><td>Wednesday</td><td>Create lending records</td><td>Check out a book to a reader</td></tr>
    <tr><td>Thursday</td><td>Handle returns</td><td>Close a loan and update availability</td></tr>
    <tr><td>Friday</td><td>Test and review</td><td>Complete the workflow with a volunteer</td></tr></table>
    <p>Leave space for unexpected work. A question about missing reader details or an unusual return date is part of building the product. A schedule without any room for discovery is likely to become inaccurate.</p>
    <ol><li>Choose one result for the day.</li><li>Break it into tasks that can be checked.</li><li>Finish and review the result.</li><li>Write down the next unresolved question.</li></ol>
    <p>At the end of the week, compare the working product with the original goal. Measure progress by completed actions, not by the length of the task list.</p>` },
  { title: '3. Design for the Reader', content: `
    <p>People use an interface to get something done. Clear labels, predictable actions, and useful feedback reduce the amount of attention required to complete a task.</p>
    <h2>A familiar example</h2>
    <p>A volunteer searches for a book by title. The result should show the title, author, and availability together. If the book is unavailable, the interface should explain why rather than offering a checkout button that fails later.</p>
    <p>The image below is an embedded PNG. It is included to help test whether book images remain visible and proportional in the PDF.</p>
    <p><img src="images/sample.png" alt="CreatePDF.tech sample book illustration" width="140" height="140" /></p>
    <p><em>Figure 1. An embedded illustration for the image conversion check.</em></p>
    <h2>A short usability checklist</h2>
    <ul><li>Use a descriptive label for each field.</li><li>Keep the main action close to the information it affects.</li><li>Explain errors beside the relevant field.</li><li>Check keyboard access and readable text sizes.</li><li>Try the layout on a small screen.</li></ul>
    <p>Good feedback also matters after an action succeeds. A brief confirmation can show which book was borrowed and when it should be returned. That confirmation gives the volunteer a chance to catch a mistake while it is easy to correct.</p>
    <p>For a sample external link, visit <a href="https://example.com/">Example Domain</a>. The link should remain clickable after conversion.</p>` },
  { title: '4. Test the Complete Journey', content: `
    <p>Testing individual buttons is useful, but a project also needs checks that follow a person through a complete journey. A book can appear correctly in a search result while the lending workflow still fails.</p>
    <h2>Follow a realistic scenario</h2>
    <p>Create a reader, find an available book, record the loan, and confirm that the book can no longer be borrowed by another reader. Then record the return and check that it becomes available again.</p>
    <p>Repeat the journey with different data. Try a long book title, a reader with two family names, and a title containing punctuation. An interface that looks good with short sample values may become awkward with ordinary real-world information.</p>
    <table><tr><th>Scenario</th><th>What to check</th></tr><tr><td>No search results</td><td>A clear empty state and a way to search again</td></tr><tr><td>Book already borrowed</td><td>No duplicate active loan</td></tr><tr><td>Missing reader details</td><td>A useful validation message</td></tr><tr><td>Long title</td><td>Text wraps without hiding important actions</td></tr></table>
    <p>Record a problem with enough detail for someone else to reproduce it. Include the starting state, the action taken, the expected result, and the actual result. A screenshot can help, but it does not replace a clear description.</p>
    <p><strong>Testing note:</strong> In this eBook, check that table cells stay readable, headings remain distinct, and no paragraph disappears at a page boundary.</p>` },
  { title: '5. Review, Learn, and Continue', content: `
    <p>A useful review connects the work completed with the problem the project was intended to solve. Show the library volunteer the working checkout and return process. Ask them to use it while you observe without explaining every step.</p>
    <p>Notice where they hesitate. A pause may reveal an unclear label, missing information, or an action placed somewhere unexpected. Ask what they expected to happen before suggesting a solution.</p>
    <h2>Write a practical project summary</h2>
    <ul><li><strong>Completed:</strong> searchable book list, checkout, and returns.</li><li><strong>Learned:</strong> volunteers need to see the return date immediately.</li><li><strong>Next:</strong> add a simple view of overdue loans.</li><li><strong>Deferred:</strong> recommendations and advanced reports.</li></ul>
    <p>Keep a short record of decisions. A future contributor should be able to understand why the first version uses a simple workflow and which improvements were deliberately postponed.</p>
    <h2>PDF review checklist</h2>
    <ol><li>Confirm that all five chapters appear in this order.</li><li>Check bold text, italic text, lists, and tables.</li><li>Find the illustration in Chapter 3.</li><li>Try the clickable link in Chapter 3.</li><li>Change the font, margins, and page size.</li><li>Turn chapter page breaks off and compare the page count.</li></ol>
    <p>Finishing a small, useful version creates a foundation for the next one. Continue with a clear goal, evidence from actual use, and enough room to improve the details.</p>
    <p><strong>END OF SAMPLE BOOK</strong></p>` },
]
const xhtml = (heading, body) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>${heading}</title></head><body><h1>${heading}</h1>${body}</body></html>`
const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
zip.file('EPUB/book.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:ab6b58ba-cdf4-4dd0-aeca-67ca10eb0c7b</dc:identifier><dc:title>${title}</dc:title><dc:creator>CreatePDF.tech Sample Library</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-17T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="image" href="images/sample.png" media-type="image/png"/>${chapters.map((_, index) => `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join('')}</spine></package>`)
zip.file('EPUB/nav.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${chapters.map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml">${chapter.title}</a></li>`).join('')}</ol></nav></body></html>`)
for (const [index, chapter] of chapters.entries()) zip.file(`EPUB/chapter-${index + 1}.xhtml`, xhtml(chapter.title, chapter.content))
zip.file('EPUB/images/sample.png', await readFile('public/icons/createpdf-f4545349bb-icon512.png'))
await mkdir('artifacts', { recursive: true })
const filename = 'artifacts/Small_Steps_Better_Projects_Test.epub'
await writeFile(filename, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
const verify = await JSZip.loadAsync(await readFile(filename), { checkCRC32: true })
for (let index = 1; index <= chapters.length; index++) if (!verify.file(`EPUB/chapter-${index}.xhtml`)) throw new Error('Missing sample chapter')
console.log(`Created and verified ${filename}: ${chapters.length} chapters, two tables, lists, image, and link.`)
