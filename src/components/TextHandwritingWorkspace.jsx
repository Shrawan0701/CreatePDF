import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, FilePlus2, LoaderCircle, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { HandwritingPagePreview } from './HandwritingPagePreview'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { FormGroup, ProgressBar, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { buildTextHandwritingPlan, createHandwritingPdf, HANDWRITING_PAPERS, HANDWRITING_STYLES, handwritingDefaults, loadHandwritingFonts } from '../services/pdfHandwriting'
import './PdfHandwritingWorkspace.css'
import './TextHandwritingWorkspace.css'

const defaults = () => ({ ...handwritingDefaults(), flow: 'lines' })
const sample = 'A little progress every day\n\nA new skill begins with a small, repeatable habit. Choose one thing you want to learn, set aside a few quiet minutes, and give it your full attention.\n\nMake a simple plan:\n1. Pick one clear goal.\n2. Practise a little each day.\n3. Write down what you discover.\n4. Review your progress at the end of the week.\n\nSome days will feel easier than others. Keep your notes, ask questions, and take the next small step. Consistency turns a good intention into lasting progress.'
const limit = 200_000

export function TextHandwritingWorkspace() {
  const { showToast } = useApp()
  const [text, setText] = useState(''), [options, setOptions] = useState(defaults), [filename, setFilename] = useState('handwritten-notes')
  const [fonts, setFonts] = useState(null), [fontError, setFontError] = useState(''), [fontRetry, setFontRetry] = useState(0)
  const [page, setPage] = useState(0), [tab, setTab] = useState('preview'), [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState(''), [error, setError] = useState('')
  const editor = useRef(null), fileInput = useRef(null), operation = useRef(null), cached = useRef(null)
  const params = useMemo(() => ({ text, options }), [text, options]), deferred = useDeferredValue(params)
  const pending = params !== deferred
  const title = filename.trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 100) || 'handwritten-notes'
  const counts = useMemo(() => ({ characters: text.length, words: text.trim() ? text.trim().split(/\s+/u).length : 0 }), [text])

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    let cancelled = false; setFontError('')
    loadHandwritingFonts().then(loaded => { if (!cancelled) setFonts(loaded) }).catch(failure => { if (!cancelled) setFontError(failure.message || 'Could not load writing styles.') })
    return () => { cancelled = true }
  }, [fontRetry])

  const { plan, planError } = useMemo(() => {
    if (!fonts || !deferred.text.trim()) return { plan: null, planError: '' }
    try {
      if (deferred.text.length > limit) throw new Error('Use up to 200,000 characters per document.')
      return { plan: buildTextHandwritingPlan(deferred.text, deferred.options, fonts), planError: '' }
    } catch (failure) { return { plan: null, planError: failure.message || 'Could not lay out this text.' } }
  }, [fonts, deferred])
  const resultCurrent = result?.plan === plan && result?.title === title && !pending
  const invalidate = () => { cached.current = null; setResult(null); setTab('preview'); setError('') }
  const changeText = value => { invalidate(); setText(value) }
  const change = updates => { invalidate(); setOptions(previous => ({ ...previous, ...updates })) }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setProgress(0) }
  const insertPageBreak = () => {
    if (busy || !editor.current) return
    const { selectionStart, selectionEnd } = editor.current, insertion = '\n\f\n'
    if (text.length - (selectionEnd - selectionStart) + insertion.length > limit) return
    changeText(text.slice(0, selectionStart) + insertion + text.slice(selectionEnd))
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(selectionStart + insertion.length, selectionStart + insertion.length) })
  }
  const importText = async file => {
    if (!file || operation.current) return
    if (!/\.(txt|text)$/i.test(file.name) && file.type !== 'text/plain') { setError('Choose a plain text (.txt) file.'); return }
    if (file.size > 2 * 1024 * 1024) { setError('Choose a text file smaller than 2 MB.'); return }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setProgress(0); setStatus('Reading text…'); setError('')
    try {
      const content = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
      if (controller.signal.aborted || operation.current !== controller) return
      if (content.length > limit) throw new Error('Use up to 200,000 characters per document.')
      if (content.includes('\u0000')) throw new Error('Choose a plain UTF-8 text file.')
      changeText(content); setFilename(file.name.replace(/\.[^.]+$/, '') || 'handwritten-notes'); setPage(0)
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not read this text file.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  const create = async action => {
    if (!plan || pending || busy || operation.current) return
    if (cached.current?.plan === plan && cached.current.title === title) {
      if (action === 'preview') { setResult(cached.current); setTab('pdf') }
      else downloadBlob(cached.current.blob, `${title}.pdf`)
      return
    }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setProgress(0); setStatus('Creating PDF…'); setError('')
    try {
      const blob = await createHandwritingPdf(plan, { title, signal: controller.signal, onProgress: (value, label) => { if (operation.current === controller) { setProgress(value); setStatus(label) } } })
      if (controller.signal.aborted || operation.current !== controller) return
      const output = { blob, plan, title }; cached.current = output; setResult(output)
      if (action === 'preview') setTab('pdf')
      else { downloadBlob(blob, `${title}.pdf`); showToast(`${plan.pages.length} handwriting ${plan.pages.length === 1 ? 'page' : 'pages'} ready.`, 'success') }
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || 'Could not create this PDF.') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }

  return <ToolPage toolId="text-to-handwriting"><div className="text-handwriting-workspace">
    <input ref={fileInput} type="file" accept=".txt,.text,text/plain" hidden disabled={busy} onChange={event => { importText(event.target.files?.[0]); event.target.value = '' }} />
    <div className="text-hand-grid"><div className="text-hand-controls">
      <section className="tool-panel text-hand-editor" aria-label="Text editor">
        <div className="text-hand-editor-toolbar"><h2>Your text</h2><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> Import TXT</button><button className="btn btn-secondary btn-sm" disabled={busy || !text} title="Insert a page break at the cursor" onClick={insertPageBreak}><FilePlus2 size={14} /> Page break</button><button className="icon-btn" aria-label="Clear text" title="Clear text" disabled={busy || !text} onClick={() => { changeText(''); setPage(0); editor.current?.focus() }}><Trash2 size={15} /></button></div>
        <textarea ref={editor} className="form-textarea" aria-label="Text to convert to handwriting" placeholder="Type or paste your text here…" value={text} maxLength={limit} disabled={busy} spellCheck onChange={event => changeText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); create('download') } }} />
        <div className="text-hand-counts"><span>{counts.words.toLocaleString()} words · {counts.characters.toLocaleString()} characters</span>{!text && <button disabled={busy} onClick={() => changeText(sample)}>Try sample</button>}{plan && <span>{plan.pages.length} {plan.pages.length === 1 ? 'page' : 'pages'}</span>}</div>
        <div className="text-hand-actions"><button className="btn btn-primary" title="Download PDF (Ctrl+Enter)" disabled={!plan || pending || busy} onClick={() => create('download')}>{busy ? <LoaderCircle size={17} className="hand-spin" /> : <Download size={17} />}{busy ? 'Working…' : 'Download PDF'}</button><button className="btn btn-secondary" disabled={!plan || pending || busy} onClick={() => create('preview')}><Eye size={16} /> Preview PDF</button></div>
      </section>
      <section className="tool-panel hand-settings" aria-label="Handwriting settings"><fieldset disabled={busy}>
        <legend>Writing style</legend><div className="hand-style-options" role="group" aria-label="Writing style">{Object.entries(HANDWRITING_STYLES).map(([value, settings]) => <button key={value} aria-pressed={options.style === value} style={{ fontFamily: `"${settings.family}", cursive` }} onClick={() => change({ style: value })}><span>Aa</span><small>{settings.label}</small></button>)}</div>
        <div className="hand-ink"><span>Ink</span>{[['#173f78', 'Blue'], ['#252b30', 'Black'], ['#8d253a', 'Red']].map(([color, label]) => <button key={color} aria-label={`${label} ink`} aria-pressed={options.ink === color} style={{ '--ink': color }} onClick={() => change({ ink: color })} />)}<input type="color" aria-label="Custom ink colour" value={options.ink} onChange={event => change({ ink: event.target.value })} /><button className="text-hand-reset" onClick={() => { invalidate(); setOptions(defaults()) }}><RotateCcw size={12} /> Reset style</button></div>
        <div className="hand-field-pair"><FormGroup label="Text size (pt)"><input className="form-input" type="number" min={10} max={30} step={1} value={options.fontSize} onChange={event => change({ fontSize: event.target.value })} /></FormGroup><FormGroup label="Line spacing"><select className="form-select" value={options.spacing} onChange={event => change({ spacing: Number(event.target.value) })}><option value={1.35}>Compact</option><option value={1.7}>Normal</option><option value={2.1}>Loose</option></select></FormGroup></div>
        <div className="hand-field-pair"><FormGroup label="Paper"><select className="form-select" value={options.paper} onChange={event => change({ paper: event.target.value })}><option value="ivory">Ivory</option><option value="white">White</option><option value="cream">Cream</option></select></FormGroup><FormGroup label="Ruling"><select className="form-select" value={options.rules} onChange={event => change({ rules: event.target.value })}><option value="lined">Blue ruled</option><option value="gray">Gray ruled</option><option value="grid">Grid</option><option value="plain">Plain</option></select></FormGroup></div>
        <details className="hand-advanced"><summary>Page layout</summary><div className="hand-field-pair"><FormGroup label="Page size"><select className="form-select" value={options.size} onChange={event => change({ size: event.target.value })}>{Object.keys(HANDWRITING_PAPERS).map(value => <option key={value}>{value}</option>)}</select></FormGroup><FormGroup label="Orientation"><select className="form-select" value={options.orientation} onChange={event => change({ orientation: event.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup></div><div className="hand-field-pair"><FormGroup label="Margin (mm)"><input className="form-input" type="number" min={10} max={35} value={options.margin} onChange={event => change({ margin: event.target.value })} /></FormGroup><FormGroup label="Text flow"><select className="form-select" value={options.flow} onChange={event => change({ flow: event.target.value })}><option value="lines">Keep line breaks</option><option value="paragraphs">Reflow paragraphs</option></select></FormGroup></div><label className="hand-check"><input type="checkbox" checked={options.marginLine} disabled={options.rules === 'plain'} onChange={event => change({ marginLine: event.target.checked })} /> Red margin line</label><label className="hand-check"><input type="checkbox" checked={options.pageNumbers} onChange={event => change({ pageNumbers: event.target.checked })} /> Page numbers</label></details>
        <FormGroup label="PDF name"><input className="form-input" autoComplete="off" maxLength={100} value={filename} onChange={event => { invalidate(); setFilename(event.target.value) }} /></FormGroup>
      </fieldset>
      {!fonts && !fontError && <p className="hand-status" role="status"><LoaderCircle size={14} className="hand-spin" /> Loading writing styles…</p>}
      {fontError && <p className="hand-error" role="alert">{fontError} <button className="btn btn-secondary btn-sm" onClick={() => setFontRetry(value => value + 1)}>Retry</button></p>}
      {planError && <p className="hand-error" role="alert">{planError}</p>}
      </section>
    </div><section className="hand-review text-hand-review" aria-label="Handwriting preview">
      <div className="hand-review-tabs" role="group" aria-label="Preview view"><button aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Live preview</button>{resultCurrent && <button aria-pressed={tab === 'pdf'} onClick={() => setTab('pdf')}>Exported PDF</button>}</div>
      {tab === 'pdf' && resultCurrent ? <DocumentPdfPreview blob={result.blob} heading="Handwriting PDF" readyLabel="Matches your download" initialPage={Math.min(page + 1, plan.pages.length)} /> : <HandwritingPagePreview plan={plan} page={page} onPage={setPage} updating={pending} />}
    </section></div>
    {busy && <div className="hand-progress"><ProgressBar value={progress} label={status} /><button className="btn btn-secondary btn-sm" onClick={cancel}><X size={14} /> Cancel</button></div>}
    {error && <p className="hand-error" role="alert">{error}</p>}
  </div></ToolPage>
}
