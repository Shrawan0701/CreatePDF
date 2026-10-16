import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'

const execute = promisify(execFile)
const maxBytes = 32 * 1024 * 1024
let pending = Promise.resolve()
const failure = (message, status = 422) => Object.assign(new Error(message), { status })

// Run an actual Office layout engine; HTML renderers cannot reproduce Word's
// grouped drawings, floating anchors, VML, section layout or pagination.
export async function exportOfficePdf(input, directory, { platform = process.platform, run = execute, env = process.env, progress = () => {} } = {}) {
  if (env.WORD_PDF_ENGINE === 'wasm' || (env.VERCEL && !env.LIBREOFFICE_PATH && env.WORD_PDF_ENGINE !== 'libreoffice')) {
    const { exportWasmPdf } = await import('./wordWasm.js')
    return exportWasmPdf(await readFile(input), progress)
  }
  const output = join(directory, 'document.pdf')
  const options = { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 }
  progress('Converting document')
  if (platform === 'win32' && env.WORD_PDF_ENGINE !== 'libreoffice') {
    const script = fileURLToPath(new URL('./word-export.ps1', import.meta.url))
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', input, '-OutputPath', output], options)
  } else {
    const binary = env.LIBREOFFICE_PATH || (platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.com' : 'soffice')
    const profile = pathToFileURL(join(directory, 'office-profile')).href
    await run(binary, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', directory, input], options)
  }
  const bytes = await readFile(output)
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw failure('The Office engine did not produce a valid PDF.')
  return bytes
}

export async function convertWordDocument(bytes, { exporter = exportOfficePdf } = {}) {
  if (!bytes.length || bytes.length > maxBytes) throw failure('Choose a DOCX document up to 32 MB.', 413)
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw failure('Choose a valid DOCX Word document.', 400) }
  if (!zip.file('word/document.xml')) throw failure('The DOCX document is missing its main content.', 400)
  const directory = await mkdtemp(join(tmpdir(), 'createpdf-office-'))
  try {
    const input = join(directory, 'document.docx')
    await writeFile(input, bytes)
    return await exporter(input, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export function createWordPdfHandler({ convert, env = process.env } = {}) {
  const convertFile = convert || ((bytes, progress) => convertWordDocument(bytes, {
    exporter: (input, directory) => exportOfficePdf(input, directory, { env, progress }),
  }))
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      response.statusCode = 405
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: 'Use POST to convert a DOCX document.' }))
      return
    }
    let streaming = false
    let heartbeat
    const event = data => { if (!response.destroyed) response.write(`${JSON.stringify(data)}\n`) }
    const progress = label => { if (streaming) event({ type: 'progress', label }) }
    try {
      if (Number(request.headers['content-length']) > maxBytes) throw failure('Choose a DOCX document up to 32 MB.', 413)
      let bytes
      if (Buffer.isBuffer(request.body)) bytes = request.body
      else {
        const chunks = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > maxBytes) throw failure('Choose a DOCX document up to 32 MB.', 413)
          chunks.push(chunk)
        }
        bytes = Buffer.concat(chunks)
      }
      if (request.headers.accept?.includes('application/vnd.createpdf.word-stream')) {
        streaming = true
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/vnd.createpdf.word-stream')
        response.setHeader('X-Accel-Buffering', 'no')
        response.flushHeaders?.()
        progress('Upload complete. Waiting for conversion slot')
        // Keep the connection active while an Office engine is busy. Heartbeats
        // indicate activity only; they do not invent a conversion percentage.
        heartbeat = setInterval(() => event({ type: 'heartbeat' }), 5000)
      }
      // Desktop Word automation runs one document at a time, without touching
      // the user's open document. Failed jobs do not block the next request.
      const job = pending.then(() => {
        progress('Preparing document')
        return convertFile(bytes, progress)
      })
      pending = job.catch(() => {})
      const pdf = await job
      if (streaming) {
        clearInterval(heartbeat)
        event({ type: 'pdf', length: pdf.length })
        response.end(pdf)
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/pdf')
      response.setHeader('Content-Disposition', 'attachment; filename="document.pdf"')
      response.end(pdf)
    } catch (error) {
      if (!error.status) console.error('Word PDF conversion failed:', error)
      const message = error.status ? error.message : 'The Word conversion engine could not process this document. Please try again. If it keeps failing, check the conversion function logs.'
      if (streaming) {
        event({ type: 'error', error: message })
        response.end()
        return
      }
      response.statusCode = error.status || 503
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: message }))
    } finally { clearInterval(heartbeat) }
  }
}
