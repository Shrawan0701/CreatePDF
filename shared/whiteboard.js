export const BOARD_WIDTH = 1600
export const BOARD_HEIGHT = 900
export const MAX_BOARD_ACTIONS = 2000
export const MAX_BOARD_BYTES = 4 * 1024 * 1024
export const blankBoard = () => ({ width: BOARD_WIDTH, height: BOARD_HEIGHT, revision: 0, actions: [] })
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/
const colorPattern = /^#[a-f0-9]{6}$/i
const bounded = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback
const validId = value => typeof value === 'string' && idPattern.test(value)

export function roomCode(value) {
  let text = String(value || '').trim()
  if (/^[a-z]+:/i.test(text)) {
    try { text = new URL(text).searchParams.get('room') || '' } catch { text = '' }
  }
  if (!/^[a-z0-9_-]{6,48}$/i.test(text)) throw new Error('Enter a room code or paste a whiteboard room link.')
  return text.toUpperCase()
}

export function normalizeBoardAction(source, board, index = 0) {
  if (!source || !['stroke', 'erase', 'rect', 'ellipse', 'line', 'text'].includes(source.kind)) throw new Error('Unsupported drawing action.')
  const point = value => {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error('Invalid drawing coordinates.')
    return { x: Math.round(bounded(value.x, 0, board.width, 0) * 10) / 10, y: Math.round(bounded(value.y, 0, board.height, 0) * 10) / 10 }
  }
  const action = { id: validId(source.id) ? source.id : `legacy-${index}`, author: validId(source.author) ? source.author : 'legacy', order: bounded(source.order, 0, Number.MAX_SAFE_INTEGER, index), kind: source.kind, width: bounded(source.width, 1, 60, 4), color: colorPattern.test(source.color) ? source.color : '#172b27', hidden: source.hidden === true }
  if (source.kind === 'stroke' || source.kind === 'erase') {
    if (!Array.isArray(source.points) || !source.points.length || source.points.length > 12000) throw new Error('This stroke is too long. Draw shorter strokes.')
    action.points = source.points.map(point)
  } else if (source.kind === 'text') {
    if (typeof source.text !== 'string' || !source.text.trim() || source.text.length > 2000) throw new Error('Use up to 2,000 characters in a text box.')
    action.at = point(source.at); action.text = source.text; action.fontSize = bounded(source.fontSize, 12, 120, Math.max(14, action.width * 5)); action.baseline = source.baseline === 'top' ? 'top' : 'alphabetic'
  } else { action.from = point(source.from); action.to = point(source.to) }
  return action
}

export function assertBoardSize(board) {
  if (board.actions.length > MAX_BOARD_ACTIONS || board.actions.reduce((count, action) => count + (action.points?.length || 0), 0) > 100000 || new TextEncoder().encode(JSON.stringify(board)).length > MAX_BOARD_BYTES) throw new Error('This board is full. Save or export it, then start a new board.')
}
export function normalizeBoard(source = {}) {
  const board = { width: bounded(source.width, 200, 5000, BOARD_WIDTH), height: bounded(source.height, 200, 5000, source.schemaVersion === 2 ? BOARD_HEIGHT : 600), revision: bounded(source.revision, 0, Number.MAX_SAFE_INTEGER, 0), actions: [] }
  if (!Array.isArray(source.actions) || source.actions.length > MAX_BOARD_ACTIONS) throw new Error('This board contains too many drawing actions.')
  board.actions = source.actions.map((action, index) => normalizeBoardAction(action, board, index))
  if (new Set(board.actions.map(action => action.id)).size !== board.actions.length) throw new Error('This board contains duplicate drawing IDs.')
  assertBoardSize(board)
  return board
}
export function normalizeBoardOperation(source, board, author) {
  if (!source || !validId(source.id)) throw new Error('Invalid drawing operation.')
  if (source.kind === 'add') {
    if (!validId(source.action?.id) || board.actions.some(action => action.id === source.action.id)) throw new Error('This drawing action already exists.')
    return { id: source.id, kind: 'add', action: { ...normalizeBoardAction(source.action, board), author, hidden: false } }
  }
  if (source.kind === 'visibility' && Array.isArray(source.ids) && source.ids.length > 0 && source.ids.length <= MAX_BOARD_ACTIONS && source.ids.every(validId) && typeof source.visible === 'boolean') return { id: source.id, kind: 'visibility', ids: [...new Set(source.ids)], visible: source.visible }
  throw new Error('Invalid drawing operation.')
}
export function applyBoardOperation(board, operation, revision = board.revision + 1) {
  const ids = new Set(operation.ids)
  const actions = operation.kind === 'add' ? [...board.actions, { ...operation.action, order: revision }] : board.actions.map(action => ids.has(action.id) ? { ...action, hidden: !operation.visible } : action)
  return { ...board, revision, actions }
}
