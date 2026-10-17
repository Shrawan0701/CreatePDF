import { richHtmlToPdf } from './richPdf'

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

// Reports can start with a single title cell and contain wider rows later.
export function spreadsheetColumnCount(rows) {
  return rows.reduce((count, row) => Math.max(count, row.length), 0)
}

export function spreadsheetTablesHtml(tables, options = {}) {
  return tables.map(({ name, rows }, tableIndex) => {
    const columns = spreadsheetColumnCount(rows)
    const heading = options.includeSheetNames === false || !name ? '' : `<h2>${escapeHtml(name)}</h2>`
    const body = rows.map(row => `<tr>${Array.from({ length: columns }, (_, index) => `<td>${escapeHtml(row[index])}</td>`).join('')}</tr>`).join('')
    return `<section${tableIndex ? ' data-page-break="before"' : ''}>${heading}<table>${body}</table></section>`
  }).join('')
}

export function spreadsheetTablesToPdf(tables, options = {}) {
  return richHtmlToPdf(spreadsheetTablesHtml(tables, options) || '<p>Empty spreadsheet</p>', {
    ...options, tableMinColumnWidth: options.scaling === 'compact' ? 45 : 65,
  })
}
