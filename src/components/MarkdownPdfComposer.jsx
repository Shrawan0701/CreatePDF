import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { FormGroup, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { richHtmlToPdf } from '../services/richPdf'
import { markdownToHtml } from '../services/markdownImport'

const sample = '# Document title\n\nWrite **Markdown** here and check the PDF pages as you type.\n\n## Highlights\n\n- Headings and lists\n- **Bold**, *italic*, and [links](https://example.com)\n- Tables and code blocks\n\n```js\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n```'

export function MarkdownPdfComposer() {
  const { showToast } = useApp()
  const editorRef = useRef(null)
  const requestRef = useRef(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const [text, setText] = useState(sample)
  const [format, setFormat] = useState('markdown')
  const [filename, setFilename] = useState('document')
  const [layout, setLayout] = useState({ pageSize: 'A4', orientation: 'portrait', fontFamily: 'sans-serif', fontSize: 12, margin: 46, lineHeight: 1.35, header: '', footer: '' })
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const update = (key, value) => setLayout(current => ({ ...current, [key]: value }))
  const markup = useMemo(() => markdownToHtml(text, format), [text, format])
  const options = useMemo(() => ({ ...layout, inlineFormatting: true, markdown: true, title: filename.trim() || 'document',
    fontSize: Math.max(8, Math.min(32, Number(layout.fontSize) || 12)),
    codeFontSize: Math.max(8, Math.min(32, Number(layout.fontSize) || 12)) * (format === 'code' ? 1 : .85),
    margin: Math.max(20, Math.min(100, Number(layout.margin) || 46)),
    lineHeight: Math.max(1.1, Math.min(2, Number(layout.lineHeight) || 1.35)),
  }), [layout, filename, format])
  const getPdf = useCallback(() => {
    if (requestRef.current?.markup === markup && requestRef.current.options === options) return requestRef.current.promise
    const request = { markup, options }
    request.promise = richHtmlToPdf(markup, options).catch(error => { if (requestRef.current === request) requestRef.current = null; throw error })
    requestRef.current = request
    return request.promise
  }, [markup, options])
  useEffect(() => {
    if (!text.trim()) return
    let cancelled = false
    const timer = setTimeout(() => {
      getPdf().then(blob => { if (!cancelled) setPreview({ markup, options, blob }) }).catch(error => { if (!cancelled) setPreview({ markup, options, error: error.message }) })
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [getPdf, markup, options, text])
  const importFile = async file => {
    if (!file) return
    try {
      setText(await file.text())
      setFilename(file.name.replace(/\.[^.]+$/, ''))
      setFormat(/\.(md|markdown|txt)$/i.test(file.name) ? 'markdown' : 'code')
      selectionRef.current = { start: 0, end: 0 }
      showToast('File imported. Review your PDF preview.', 'success')
    } catch (error) { showToast(error.message, 'error') }
  }
  const insert = (before, after, placeholder) => {
    const { start, end } = selectionRef.current
    const selected = text.slice(start, end) || placeholder
    setText(text.slice(0, start) + before + selected + after + text.slice(end))
    requestAnimationFrame(() => {
      editorRef.current.focus()
      editorRef.current.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }
  const download = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const blob = await getPdf()
      setPreview({ markup, options, blob })
      downloadBlob(blob, `${filename.trim().replace(/\.pdf$/i, '') || 'document'}.pdf`)
      showToast('PDF created locally.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const current = preview?.markup === markup && preview?.options === options
  return <ToolPage toolId="markdown-to-pdf"><div className="composer-layout markdown-composer-layout">
    <div className="tool-panel">
      <div className="markdown-editor-heading"><h2 className="tool-panel-title">Write or import your document</h2><label className="btn btn-secondary btn-sm">Import file<input type="file" hidden aria-label="Import Markdown or code file" accept=".md,.markdown,.txt,.js,.jsx,.ts,.tsx,.json,.py,.css,.html,.sql,.java,.c,.cpp,text/markdown,text/plain" onChange={event => { importFile(event.target.files?.[0]); event.target.value = '' }} /></label></div>
      <div className="form-grid"><FormGroup label="PDF filename"><input className="form-input" value={filename} onChange={event => setFilename(event.target.value)} /></FormGroup><FormGroup label="Content format"><select className="form-select" value={format} onChange={event => setFormat(event.target.value)}><option value="markdown">Markdown</option><option value="code">Plain text / source code</option></select></FormGroup></div>
      {format === 'markdown' && <div className="markdown-insert-toolbar" role="toolbar" aria-label="Markdown shortcuts">{[['Heading', '\n## ', '\n', 'Heading'], ['Bold', '**', '**', 'bold text'], ['Italic', '*', '*', 'italic text'], ['List', '\n- ', '\n', 'List item'], ['Link', '[', '](https://example.com)', 'link text'], ['Code block', '\n```\n', '\n```\n', 'Your code here'], ['Table', '\n', '\n', '| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |']].map(([label, before, after, placeholder]) => <button type="button" key={label} onMouseDown={event => event.preventDefault()} onClick={() => insert(before, after, placeholder)}>{label}</button>)}</div>}
      <FormGroup label={format === 'markdown' ? 'Markdown source' : 'Text or source code'}><textarea ref={editorRef} className="form-textarea markdown-source-editor" spellCheck={false} value={text} placeholder={format === 'markdown' ? '# Start your document' : 'Paste your text or source code here'} onChange={event => setText(event.target.value)} onSelect={event => { selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd } }} /></FormGroup>
      <div className="markdown-source-meta"><span>{text ? text.split('\n').length : 0} lines · {text.length.toLocaleString()} characters</span><span>Changes update the PDF automatically</span></div>
      <p className="form-hint markdown-source-help">{format === 'markdown' ? 'Use the Code block shortcut for code inside Markdown, or choose Plain text / source code to preserve a whole source file.' : 'Text is printed literally with its indentation and line breaks. Long lines wrap to fit the page.'}</p>
      <details className="create-page-settings" open><summary>PDF settings <span>{layout.pageSize} · {layout.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</span></summary><div className="form-grid">
        <FormGroup label="Page size"><select className="form-select" value={layout.pageSize} onChange={event => update('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
        <FormGroup label="Orientation"><select className="form-select" value={layout.orientation} onChange={event => update('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
        <FormGroup label="Font"><select className="form-select" disabled={format === 'code'} value={format === 'code' ? 'monospace' : layout.fontFamily} onChange={event => update('fontFamily', event.target.value)}>{format === 'code' ? <option value="monospace">Monospace (source code)</option> : <><option value="sans-serif">Sans serif</option><option value="serif">Serif</option></>}</select></FormGroup>
        <FormGroup label="Base font size"><input className="form-input" type="number" min="8" max="32" value={layout.fontSize} onChange={event => update('fontSize', event.target.value)} onBlur={() => update('fontSize', options.fontSize)} /></FormGroup>
        <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={layout.margin} onChange={event => update('margin', event.target.value)} onBlur={() => update('margin', options.margin)} /></FormGroup>
        <FormGroup label="Line spacing"><input className="form-input" type="number" min="1.1" max="2" step=".1" value={layout.lineHeight} onChange={event => update('lineHeight', event.target.value)} onBlur={() => update('lineHeight', options.lineHeight)} /></FormGroup>
        <FormGroup label="Header"><input className="form-input" value={layout.header} onChange={event => update('header', event.target.value)} /></FormGroup>
        <FormGroup label="Footer" hint="Use {page} and {total} for page numbers"><input className="form-input" value={layout.footer} onChange={event => update('footer', event.target.value)} /></FormGroup>
      </div></details>
      <button className="btn btn-primary btn-lg create-download" disabled={busy || !text.trim()} onClick={download}><Download size={17} />{busy ? 'Creating…' : 'Download PDF'}</button>
    </div>
    <DocumentPdfPreview blob={text.trim() ? preview?.blob : null} updating={Boolean(text.trim()) && !current} error={current ? preview?.error : ''} empty={!text.trim()} emptyLabel={format === 'markdown' ? 'Add Markdown to preview' : 'Add text to preview'} />
  </div></ToolPage>
}
