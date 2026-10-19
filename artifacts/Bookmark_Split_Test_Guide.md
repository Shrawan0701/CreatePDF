# Bookmark splitter test PDFs

Both PDFs contain the same complete, fictional 12-page Northstar handbook. No passwords or account details are needed. The edge-case file deliberately changes the bookmark outline; it does not change the report content.

## Main PDF: Bookmark_Split_Complete_Test.pdf

- 12 A4 pages with a cover, clickable contents, four chapters, and an appendix.
- 20 usable bookmarks: 5 at level 1, 10 at level 2, and 5 at level 3.
- Three unique embedded raster illustrations: a transparent logo, a landscape illustration, and a budget chart. The logo is reused throughout the document.
- Selectable text, multiple substantive tables, direct and named internal links, external web/email links, and three editable PDF form fields on page 12.

### Expected default result

Choose **Level 1** and **Keep as a separate front-matter PDF**. You should get exactly **6 files**:

| File | Title | Original pages |
| --- | --- | --- |
| 1 | Front matter | 1-2 |
| 2 | Chapter 1: Planning | 3-4 |
| 3 | Chapter 2: Operations | 5-6 |
| 4 | Chapter 3: Finance | 7-8 |
| 5 | Chapter 4: Delivery | 9-10 |
| 6 | Appendix: Reference | 11-12 |

With **Include in the first section**, expect **5 files**: Planning contains pages 1-4; the remaining ranges stay 5-6, 7-8, 9-10, and 11-12.

With **Level 2** and separate front matter, expect **11 files**: pages 1-2, then one file for each page from 3 through 12. **All bookmark levels** produces the same page ranges because bookmarks targeting the same page must be merged.

With **Level 3** and separate front matter, expect **6 files**: 1-3, 4-5, 6-7, 8-9, 10-11, and 12.

### Content checks

1. Preview Planning: its two pages should be pages 3 and 4 from the original.
2. The page-3 link to requirements on page 4 should work inside the Planning output. The return link should also work.
3. The page-4 link to Finance leaves the section, so it may be removed with an internal-link warning. It must not secretly include the Finance pages.
4. Each two-page chapter has similar within-chapter links. The Operations and Finance chapters also exercise named destinations.
5. External website links should still work. Email links open a mail application only; no message is sent by the PDF.
6. With **Keep relevant bookmarks** enabled, the Planning PDF should retain its chapter, two subsection entries, and one third-level entry (4 bookmarks). The other main two-page sections also retain 4 each. Front matter has 0.
7. Appendix should contain the glossary, checklist, and editable reviewer-name, reviewer-email, and review-complete fields. Test form filling in a normal PDF viewer; the in-app preview is a page rendering.
8. Every source page should occur exactly once across the output files. Filenames should have the right section titles, unique numbering, and no forbidden filesystem characters.

## Edge-case PDF: Bookmark_Split_Edge_Cases_Test.pdf

This version has 15 outline entries across two levels: 12 have valid internal targets and 3 have no usable internal target initially.

- Finance is listed before Planning even though its target is later in the PDF. Output sections must follow source page order.
- Two top-level Planning bookmarks point to page 3; one uses a named destination. They must create one section boundary, not an empty duplicate file.
- An external website bookmark must not become a split point automatically.
- An untargeted Operations group has valid nested entries at pages 5 and 6.
- An unresolved named destination can be repaired by entering source page **9** in the review UI.

With the initial **Level 1** selection and separate front matter, expect **4 files** with ranges **1-2, 3-6, 7-10, 11-12**. Planning must be named Planning, not Finance.

If you manually assign page **9** to the unresolved entry, it becomes selected and creates another boundary. Expect **5 files**: **1-2, 3-6, 7-8, 9-10, 11-12**.

## Reuse with the other tools

- **Split by Text:** search for the exact literal marker `SECTION START`. It occurs only on pages 3, 5, 7, 9, and 11. Splitting before these pages yields the same 6 ranges as the main Level 1 bookmark split.
- **Repeated text:** `Northstar Project Handbook` appears in every running header. It can exercise repeated-match review and consecutive-match grouping.
- **Invoice text:** `Invoice Number: NS-2026-008` appears on page 8.
- **Extract Images:** inspect the illustrations and the repeated transparent logo.
- **PDF to HTML / EPUB:** inspect selectable text, headings, tables, pictures, links, and chapter order.
- **Compress PDF:** compare image quality, selectable text, and links. Savings depend on the settings and existing image compression; the file is not padded with meaningless data.

The app has not been tested as part of generating these files. These are sample inputs and expected outcomes for your own checks.
