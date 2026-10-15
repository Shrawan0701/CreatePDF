export function parseCsv(content) {
  const source = String(content).replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let closedQuote = false
  const finishCell = () => { row.push(cell); cell = ''; closedQuote = false }
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++ }
      else if (character === '"') { quoted = false; closedQuote = true }
      else cell += character
      continue
    }
    if (character === ',') finishCell()
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index++
      finishCell()
      rows.push(row)
      row = []
    } else if (character === '"') {
      if (cell || closedQuote) throw new Error('Unexpected quote in a CSV field.')
      quoted = true
    } else if (closedQuote) {
      if (character !== ' ' && character !== '\t') throw new Error('A quoted CSV field must end with a comma or a new line.')
    } else cell += character
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  if (cell || row.length || closedQuote) { finishCell(); rows.push(row) }
  return rows.filter((values) => values.some((value) => value.trim()))
}

export function formatCsv(rows) {
  return '\uFEFF' + rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
}
