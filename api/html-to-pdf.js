import { createHtmlPdfHandler } from '../server/htmlPdf.js'
export const config = { api: { bodyParser: false } }
export default createHtmlPdfHandler()
