// Geometry is in PDF points, measured from the top-left of the displayed page.
export function wordLinkRectangle(rectangle, transform) {
  if (!rectangle || rectangle.length !== 4 || !Array.from(rectangle).every(Number.isFinite)) return null
  const [left, bottom, right, top] = rectangle
  const points = [[left, bottom], [right, bottom], [right, top], [left, top]].map(([x, y]) => [
    x * transform[0] + y * transform[2] + transform[4],
    x * transform[1] + y * transform[3] + transform[5],
  ])
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export function groupWordLines(items) {
  const lines = []
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find(line => Math.abs(line.y - item.y) <= Math.max(1.5, Math.min(line.size, item.size) * .22))
    if (line) { line.items.push(item); line.size = Math.max(line.size, item.size) }
    else lines.push({ y: item.y, size: item.size, items: [item] })
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => a.y - b.y)
}

function mergeEdges(segments, horizontal) {
  const edges = []
  for (const s of segments) {
    const position = horizontal ? s.y1 : s.x1
    const start = horizontal ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2)
    const end = horizontal ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2)
    if (Math.abs(horizontal ? s.y1 - s.y2 : s.x1 - s.x2) > 1 || end - start < 2) continue
    edges.push({ position, start, end })
  }
  const merged = []
  for (const edge of edges.sort((a, b) => a.position - b.position || a.start - b.start)) {
    const same = merged.find(s => Math.abs(s.position - edge.position) < 1.5 && edge.start <= s.end + 2 && edge.end >= s.start - 2)
    if (same) { same.start = Math.min(same.start, edge.start); same.end = Math.max(same.end, edge.end) }
    else merged.push({ ...edge })
  }
  return merged
}

export function detectWordTables(items, segments) {
  const horizontal = mergeEdges(segments, true).filter(edge => edge.end - edge.start > 40)
  const vertical = mergeEdges(segments, false)
  const tables = []
  const groups = []
  for (const edge of horizontal) {
    const group = groups.find(g => Math.abs(g[0].start - edge.start) < 2 && Math.abs(g[0].end - edge.end) < 2)
    if (group) group.push(edge); else groups.push([edge])
  }
  const connectedGroups = []
  for (const group of groups) {
    let current = []
    for (const edge of group.sort((a, b) => a.position - b.position)) {
      const previous = current.at(-1)
      const joined = !previous || [edge.start, edge.end].every(x => vertical.some(rule => Math.abs(rule.position - x) < 2 && rule.start <= previous.position + 2 && rule.end >= edge.position - 2))
      if (!joined) { connectedGroups.push(current); current = [] }
      current.push(edge)
    }
    if (current.length) connectedGroups.push(current)
  }
  for (const group of connectedGroups) {
    if (group.length < 3) continue
    const ys = group.map(edge => edge.position).sort((a, b) => a - b)
    const left = group[0].start, right = group[0].end
    // Only vertical rules spanning this grid define columns. Text alignment
    // alone must not turn an ordinary letter into a table.
    const xs = vertical.filter(edge => edge.position >= left - 2 && edge.position <= right + 2 && edge.start <= ys[0] + 2 && edge.end >= ys.at(-1) - 2).map(edge => edge.position).sort((a, b) => a - b)
    if (xs.length < 3 || xs.length > 65) continue
    if (Math.abs(xs[0] - left) > 2 || Math.abs(xs.at(-1) - right) > 2) continue
    const tableItems = items.filter(item => item.x + item.width / 2 >= left - 1 && item.x + item.width / 2 <= right + 1 && item.y > ys[0] && item.y <= ys.at(-1) + 1)
    if (!tableItems.length) continue
    const rows = ys.slice(1).map((bottom, row) => xs.slice(1).map((end, col) => tableItems.filter(item => item.y > ys[row] && item.y <= bottom && item.x + item.width / 2 >= xs[col] && item.x + item.width / 2 < end + .1)))
    tables.push({ x: left, y: ys[0], width: right - left, height: ys.at(-1) - ys[0], xs, ys, rows, items: tableItems, ruled: true })
  }
  return tables.sort((a, b) => a.y - b.y)
}

export function detectBorderlessWordTables(items, excluded = new Set()) {
  const lines = groupWordLines(items.filter(item => !excluded.has(item)))
  const groups = []
  for (const line of lines) {
    const cells = []
    for (const item of line.items) {
      const last = cells.at(-1)
      if (last && item.x - (last.at(-1).x + last.at(-1).width) < Math.max(14, item.size * 1.8)) last.push(item)
      else cells.push([item])
    }
    if (cells.length < 3) continue
    const previous = groups.at(-1)
    const same = previous && line.y - previous.at(-1).y < line.size * 4 && cells.length === previous[0].cells.length && cells.every((cell, index) => Math.abs(cell[0].x - previous[0].cells[index][0].x) < 4)
    if (same) previous.push({ ...line, cells }); else groups.push([{ ...line, cells }])
  }
  return groups.filter(group => group.length >= 3 && group.every((line, index) => !index || !lines.some(other => other.y > group[index - 1].y + 1 && other.y < line.y - 1))).map(group => {
    const x = group[0].cells[0][0].x
    const right = Math.max(...group.flatMap(line => line.items.map(item => item.x + item.width))) + 6
    const xs = [...group[0].cells.map(cell => cell[0].x - 3), right]
    const ys = [...group.map(line => line.y - line.size), group.at(-1).y + group.at(-1).size * .4]
    return { x: x - 3, y: ys[0], width: right - x + 3, height: ys.at(-1) - ys[0], xs, ys, rows: group.map(line => line.cells), items: group.flatMap(line => line.items), ruled: false }
  })
}

export function wordPageSelection(value, count) {
  if (!value.trim()) return Array.from({ length: count }, (_, index) => index + 1)
  const selected = new Set()
  for (const token of value.split(',').map(part => part.trim())) {
    if (!/^\d+(?:\s*-\s*\d+)?$/.test(token)) throw new Error('Enter pages such as 1-3, 5.')
    const [start, end = start] = token.split('-').map(Number)
    if (start < 1 || end < start || end > count) throw new Error(`Choose pages between 1 and ${count}.`)
    for (let index = start; index <= end; index++) selected.add(index)
  }
  return [...selected].sort((a, b) => a - b)
}
