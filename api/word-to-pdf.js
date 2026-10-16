import { createWordPdfHandler } from '../server/wordPdf.js'
export const config = { api: { bodyParser: false } }
export default createWordPdfHandler()
