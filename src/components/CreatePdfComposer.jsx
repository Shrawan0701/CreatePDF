import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, Download, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Redo2, Scissors, Table as TableIcon, Underline, Undo2 } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { CreateImageControls } from './CreateImageControls'
import { FormGroup, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { richHtmlToPdf, sanitizeDocumentHtml } from '../services/richPdf'

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function selectionBookmark(editor) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null
  const path = node => {
    const indices = []
    while (node !== editor) { indices.unshift([...node.parentNode.childNodes].indexOf(node)); node = node.parentNode }
    return indices
  }
  const range = selection.getRangeAt(0)
  return { start: path(range.startContainer), startOffset: range.startOffset, end: path(range.endContainer), endOffset: range.endOffset }
}

function restoreBookmark(editor, bookmark) {
  const nodeAt = path => path.reduce((node, index) => node?.childNodes[index], editor)
  const range = document.createRange()
  const start = bookmark && nodeAt(bookmark.start)
  const end = bookmark && nodeAt(bookmark.end)
  if (start && end) {
    range.setStart(start, Math.min(bookmark.startOffset, start.nodeType === 3 ? start.length : start.childNodes.length))
    range.setEnd(end, Math.min(bookmark.endOffset, end.nodeType === 3 ? end.length : end.childNodes.length))
  } else { range.selectNodeContents(editor); range.collapse(false) }
  const selection = window.getSelection()
  selection.removeAllRanges(); selection.addRange(range)
  return range
}

function editorMarkup(value) {
  const document = new DOMParser().parseFromString(value, 'text/html')
  for (const element of document.querySelectorAll('[data-selected]')) element.removeAttribute('data-selected')
  for (const element of document.querySelectorAll('[data-font-size]')) element.removeAttribute('data-font-size')
  for (const element of document.querySelectorAll('font')) { element.removeAttribute('size'); element.removeAttribute('face') }
  for (const element of document.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li')) {
    const alignment = element.style.textAlign || element.getAttribute('align')
    if (['left', 'center', 'right'].includes(alignment)) element.setAttribute('data-align', alignment)
  }
  for (const element of [...document.querySelectorAll('div')].reverse()) {
    if (element.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote')) continue
    const paragraph = document.createElement('p')
    for (const attribute of element.attributes) paragraph.setAttribute(attribute.name, attribute.value)
    paragraph.innerHTML = element.innerHTML
    element.replaceWith(paragraph)
  }
  return sanitizeDocumentHtml(document.body.innerHTML)
}

export function CreatePdfComposer() {
  const { showToast } = useApp()
  const editorRef = useRef(null)
  const selectionRef = useRef(null)
  const imageRef = useRef(null)
  const requestRef = useRef(null)
  const historyRef = useRef({ entries: [{ html: '<p><br></p>', selection: null }], index: 0, group: null, time: 0 })
  const [markup, setMarkup] = useState('')
  const [name, setName] = useState('Untitled document')
  const [layout, setLayout] = useState({ pageSize: 'A4', orientation: 'portrait', fontSize: 12, fontFamily: 'sans-serif', margin: 46, lineHeight: 1.35, header: '', footer: '' })
  const [format, setFormat] = useState({ block: 'p' })
  const [insert, setInsert] = useState(null)
  const [link, setLink] = useState({ text: '', url: '' })
  const [table, setTable] = useState({ rows: 3, columns: 3 })
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selectedImage, setSelectedImage] = useState(null)
  const [fontScope, setFontScope] = useState('document')
  const options = useMemo(() => ({ ...layout,
    fontSize: Math.max(8, Math.min(32, Number(layout.fontSize) || 12)),
    margin: Math.max(20, Math.min(100, Number(layout.margin) || 46)),
    lineHeight: Math.max(1.1, Math.min(2, Number(layout.lineHeight) || 1.35)),
    title: name.trim() || 'Untitled document', inlineFormatting: true,
  }), [layout, name])
  const stats = useMemo(() => {
    const document = new DOMParser().parseFromString(markup, 'text/html')
    for (const element of document.querySelectorAll('p,div,h1,h2,h3,li,td,th,br')) element.append(document.createTextNode(' '))
    const text = document.body.textContent.replace(/\s+/g, ' ').trim()
    return { words: text ? text.split(' ').length : 0, characters: text.length, content: Boolean(text || document.querySelector('img,table')) }
  }, [markup])
  const update = (key, value) => setLayout(current => ({ ...current, [key]: value }))

  const rememberSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode) || !editorRef.current.contains(selection.focusNode)) return
    selectionRef.current = selection.getRangeAt(0).cloneRange()
    const history = historyRef.current
    history.entries[history.index].selection = selectionBookmark(editorRef.current)
    const range = selection.getRangeAt(0)
    const first = range.startContainer.nodeType === 1 ? range.startContainer.childNodes[range.startOffset] || range.startContainer : range.startContainer
    const anchor = first.nodeType === 1 ? first : first.parentElement
    const block = anchor.closest('h1,h2,h3,p')?.tagName.toLowerCase() || 'p'
    const style = getComputedStyle(anchor)
    const hasSelection = !selection.isCollapsed && Boolean(selection.toString())
    setFontScope(hasSelection ? 'selection' : 'document')
    setFormat({ block, hasSelection, fontFamily: style.fontFamily.includes('Times') ? 'serif' : 'sans-serif', fontSize: Math.round(parseFloat(style.fontSize) * 3 / 4 * 100) / 100, bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline'), left: document.queryCommandState('justifyLeft'), center: document.queryCommandState('justifyCenter'), right: document.queryCommandState('justifyRight') })
  }, [])

  useEffect(() => {
    editorRef.current.innerHTML = '<p><br></p>'
    document.addEventListener('selectionchange', rememberSelection)
    return () => document.removeEventListener('selectionchange', rememberSelection)
  }, [rememberSelection])

  const sync = (inputType, record = true, timestamp = 0) => {
    const editor = editorRef.current
    for (const span of editor.querySelectorAll('[data-text-size]')) {
      const size = Number(span.dataset.textSize)
      if (Number.isFinite(size) && size >= 6 && size <= 72) span.style.fontSize = `${size * 4 / 3}px`
      else { span.removeAttribute('data-text-size'); span.style.removeProperty('font-size') }
    }
    const html = editor.innerHTML.replace(/ data-selected(?:="")?/g, '')
    const history = historyRef.current
    if (record && html !== history.entries[history.index].html) {
      const group = ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(inputType) ? inputType : null
      const snapshot = { html, selection: selectionBookmark(editor) }
      const now = timestamp
      if (group && history.group === group && now - history.time < 1000 && history.index === history.entries.length - 1) history.entries[history.index] = snapshot
      else {
        history.entries.splice(history.index + 1)
        history.entries.push(snapshot)
        if (history.entries.length > 100) history.entries.shift()
        history.index = history.entries.length - 1
      }
      history.group = group; history.time = now
    }
    setMarkup(editorMarkup(html))
    setSelectedImage(current => {
      if (!current) return null
      const image = [...editorRef.current.querySelectorAll('img')].find(image => image.dataset.editorImage === current.id)
      return image ? { id: current.id, src: image.src, width: Number(image.dataset.imageWidth) || 100, align: image.dataset.align || 'left' } : null
    })
    rememberSelection()
  }
  useEffect(() => {
    for (const image of editorRef.current.querySelectorAll('img')) {
      image.toggleAttribute('data-selected', image.dataset.editorImage === selectedImage?.id)
    }
  }, [selectedImage, markup])
  const command = (action, value, savedRange = selectionRef.current) => {
    const editor = editorRef.current
    editor.focus({ preventScroll: true })
    const history = historyRef.current
    history.group = null
    if (action === 'undo' || action === 'redo') {
      history.index = Math.max(0, Math.min(history.entries.length - 1, history.index + (action === 'undo' ? -1 : 1)))
      const snapshot = history.entries[history.index]
      editor.innerHTML = snapshot.html
      selectionRef.current = restoreBookmark(editor, snapshot.selection)
      sync(undefined, false)
      return
    }
    const selection = window.getSelection()
    const range = savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange : document.createRange()
    if (range !== savedRange) { range.selectNodeContents(editor); range.collapse(false) }
    selection.removeAllRanges()
    selection.addRange(range)
    document.execCommand('styleWithCSS', false, false)
    document.execCommand('defaultParagraphSeparator', false, 'p')
    document.execCommand(action, false, value)
    sync()
    history.group = null
  }

  // Direct DOM edits preserve table/paragraph structure. The same snapshot
  // history handles these edits and normal typing, including keyboard undo.
  const editDocument = mutate => {
    const clone = editorRef.current.cloneNode(true)
    if (mutate(clone) === false) return
    const bookmark = selectionBookmark(editorRef.current)
    editorRef.current.innerHTML = clone.innerHTML
    selectionRef.current = restoreBookmark(editorRef.current, bookmark)
    historyRef.current.group = null
    sync()
  }
  const changeSelectedFont = (attribute, value) => {
    const editor = editorRef.current
    const selected = selectionRef.current?.cloneRange()
    if (!selected || selected.collapsed || !editor.contains(selected.commonAncestorContainer)) return
    // Wrap each selected text fragment separately, retaining block boundaries,
    // links and existing bold/italic markup even across paragraphs or cells.
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    const fragments = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!selected.intersectsNode(node)) continue
      const start = node === selected.startContainer ? selected.startOffset : 0
      const end = node === selected.endContainer ? selected.endOffset : node.length
      if (end > start) fragments.push({ node, start, end })
    }
    const spans = []
    for (const { node, start, end } of fragments) {
      const range = document.createRange()
      range.setStart(node, start); range.setEnd(node, end)
      const span = document.createElement('span')
      span.setAttribute(attribute, value)
      span.append(range.extractContents())
      range.insertNode(span)
      spans.push(span)
    }
    if (!spans.length) return
    editor.focus({ preventScroll: true })
    const range = document.createRange()
    range.setStartBefore(spans[0]); range.setEndAfter(spans.at(-1))
    const selection = window.getSelection()
    selection.removeAllRanges(); selection.addRange(range)
    selectionRef.current = range.cloneRange()
    historyRef.current.group = null
    sync()
  }
  const selectImage = image => {
    if (!image.dataset.editorImage) image.dataset.editorImage = crypto.randomUUID()
    setSelectedImage({ id: image.dataset.editorImage, src: image.src, width: Number(image.dataset.imageWidth) || 100, align: image.dataset.align || 'left' })
  }
  const changeImage = changes => editDocument(clone => {
    const image = [...clone.querySelectorAll('img')].find(image => image.dataset.editorImage === selectedImage?.id)
    if (!image) return false
    if (changes.src) image.src = changes.src
    if (changes.width) { image.dataset.imageWidth = changes.width; image.style.width = `${changes.width}%`; image.removeAttribute('width'); image.removeAttribute('height') }
    if (changes.align) image.dataset.align = changes.align
  })
  const removeImage = () => editDocument(clone => {
    const image = [...clone.querySelectorAll('img')].find(image => image.dataset.editorImage === selectedImage?.id)
    if (!image) return false
    image.replaceWith(document.createElement('br'))
  })
  const moveBlock = direction => {
    const editor = editorRef.current
    let block = selectedImage ? [...editor.querySelectorAll('img')].find(image => image.dataset.editorImage === selectedImage.id) : selectionRef.current?.startContainer
    if (!block || !editor.contains(block) || block === editor) return
    while (block.parentNode !== editor) block = block.parentNode
    const index = [...editor.childNodes].indexOf(block)
    editDocument(clone => {
      const target = clone.childNodes[index]
      const neighbor = direction < 0 ? target.previousSibling : target.nextSibling
      if (!neighbor) return false
      if (direction < 0) clone.insertBefore(target, neighbor)
      else clone.insertBefore(neighbor, target)
      target.setAttribute?.('data-moved-block', '')
    })
    const target = editor.querySelector('[data-moved-block]')
    if (target) {
      target.removeAttribute('data-moved-block')
      const range = document.createRange()
      range.selectNodeContents(target); range.collapse(false)
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
      rememberSelection()
      target.scrollIntoView({ block: 'nearest' })
    }
  }

  const getPdf = useCallback(() => {
    if (requestRef.current?.markup === markup && requestRef.current?.options === options) return requestRef.current.promise
    const request = { markup, options }
    request.promise = richHtmlToPdf(markup, options).catch(error => {
      if (requestRef.current === request) requestRef.current = null
      throw error
    })
    requestRef.current = request
    return request.promise
  }, [markup, options])
  useEffect(() => {
    if (!stats.content) return
    let cancelled = false
    const timer = setTimeout(() => {
      getPdf().then(blob => { if (!cancelled) setPreview({ markup, options, blob }) }).catch(error => { if (!cancelled) setPreview({ markup, options, error: error.message }) })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [getPdf, markup, options, stats.content])

  const addImage = file => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return showToast('Choose a PNG or JPG image.', 'warning')
    const range = selectionRef.current?.cloneRange()
    const reader = new FileReader()
    reader.onload = () => {
      const id = crypto.randomUUID()
      command('insertHTML', `<p><img src="${reader.result}" alt="${escapeHtml(file.name)}" data-editor-image="${id}" data-image-width="100" style="width:100%"></p><p><br></p>`, range)
      selectImage([...editorRef.current.querySelectorAll('img')].find(image => image.dataset.editorImage === id))
    }
    reader.onerror = () => showToast('Could not read this image.', 'error')
    reader.readAsDataURL(file)
  }
  const addLink = event => {
    event.preventDefault()
    const url = link.url.trim()
    try { if (!['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(url).protocol)) throw new Error() } catch { return showToast('Enter a valid web, email, or telephone link.', 'warning') }
    command('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(link.text.trim() || url)}</a>`)
    setInsert(null)
  }
  const addTable = event => {
    event.preventDefault()
    const columns = Math.max(1, Math.min(8, Number(table.columns) || 1))
    const rows = Math.max(1, Math.min(20, Number(table.rows) || 1))
    command('insertHTML', `<table><thead><tr>${Array.from({ length: columns }, (_, index) => `<th>Heading ${index + 1}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: rows }, () => `<tr>${'<td><br></td>'.repeat(columns)}</tr>`).join('')}</tbody></table><p><br></p>`)
    setInsert(null)
  }
  const download = async () => {
    if (!stats.content) return
    setBusy(true)
    try {
      const blob = await getPdf()
      setPreview({ markup, options, blob })
      downloadBlob(blob, `${name.trim().replace(/\.pdf$/i, '') || 'Untitled document'}.pdf`)
      showToast('PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const toolbarButton = (label, Icon, action, active, value) => <button type="button" title={label} aria-label={label} aria-pressed={active === undefined ? undefined : Boolean(active)} onMouseDown={event => event.preventDefault()} onClick={() => command(action, value)}><Icon size={17} /></button>
  const current = preview?.markup === markup && preview?.options === options

  return <ToolPage toolId="create-pdf"><div className="composer-layout create-composer-layout">
    <div className="tool-panel create-writing-panel">
      <div className="create-document-heading"><div><h2 className="tool-panel-title">Write your document</h2><p className="form-hint">Start writing, then check your pages before downloading.</p></div></div>
      <FormGroup label="Document name"><input className="form-input" value={name} onChange={event => setName(event.target.value)} /></FormGroup>
      <FormGroup label="Apply font to"><select className="form-select" value={fontScope} onChange={event => setFontScope(event.target.value)}><option value="document">Document defaults</option><option value="selection" disabled={!format.hasSelection}>Selected text</option></select></FormGroup>
      <div className="form-grid create-font-settings">
        <FormGroup label={fontScope === 'selection' ? 'Selected text font' : 'Document font'}><select className="form-select" value={fontScope === 'selection' ? format.fontFamily : layout.fontFamily} onChange={event => fontScope === 'selection' ? changeSelectedFont('data-text-font', event.target.value) : update('fontFamily', event.target.value)}><option value="sans-serif">Arial (sans serif)</option><option value="serif">Times (serif)</option></select></FormGroup>
        {fontScope === 'selection' ? <FormGroup label="Selected text size (pt)"><select className="form-select" value={format.fontSize} onChange={event => changeSelectedFont('data-text-size', event.target.value)}>{[...new Set([6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, format.fontSize])].filter(Boolean).sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}</select></FormGroup> : <FormGroup label="Document font size (pt)"><input className="form-input" type="number" min="8" max="32" value={layout.fontSize} onChange={event => update('fontSize', event.target.value)} onBlur={() => update('fontSize', options.fontSize)} /></FormGroup>}
      </div>
      <p className="form-hint create-font-hint">{fontScope === 'selection' ? 'Changes apply only to your highlighted text.' : 'Sets the document defaults. Highlight text to give it its own font or size.'}</p>
      <div className="create-format-toolbar" role="toolbar" aria-label="Document formatting">
        <select className="form-select" aria-label="Text style" value={format.block} onChange={event => command('formatBlock', event.target.value)}><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></select>
        <div className="create-toolbar-group">{toolbarButton('Undo', Undo2, 'undo')}{toolbarButton('Redo', Redo2, 'redo')}</div>
        <div className="create-toolbar-group">{toolbarButton('Bold', Bold, 'bold', format.bold)}{toolbarButton('Italic', Italic, 'italic', format.italic)}{toolbarButton('Underline', Underline, 'underline', format.underline)}</div>
        <div className="create-toolbar-group">{toolbarButton('Align left', AlignLeft, 'justifyLeft', format.left)}{toolbarButton('Align center', AlignCenter, 'justifyCenter', format.center)}{toolbarButton('Align right', AlignRight, 'justifyRight', format.right)}</div>
        <div className="create-toolbar-group">{toolbarButton('Bulleted list', List, 'insertUnorderedList')}{toolbarButton('Numbered list', ListOrdered, 'insertOrderedList')}</div>
        <div className="create-toolbar-group">{[[-1, ArrowUp, 'Move block up'], [1, ArrowDown, 'Move block down']].map(([direction, Icon, label]) => <button type="button" key={label} title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={() => moveBlock(direction)}><Icon size={17} /></button>)}</div>
        <div className="create-toolbar-group">
          <button type="button" aria-label="Insert link" title="Insert link" onMouseDown={event => event.preventDefault()} onClick={() => { setLink({ text: selectionRef.current?.toString() || '', url: '' }); setInsert(insert === 'link' ? null : 'link') }}><LinkIcon size={17} /></button>
          <button type="button" aria-label="Insert table" title="Insert table" onMouseDown={event => event.preventDefault()} onClick={() => setInsert(insert === 'table' ? null : 'table')}><TableIcon size={17} /></button>
          <button type="button" aria-label="Insert image" title="Insert image" onMouseDown={event => event.preventDefault()} onClick={() => imageRef.current.click()}><ImageIcon size={17} /></button>
          {toolbarButton('Insert page break', Scissors, 'insertHTML', undefined, '<div data-page-break="before"><p><br></p></div>')}
        </div>
      </div>
      {selectedImage && <CreateImageControls key={`${selectedImage.id}:${selectedImage.width}:${selectedImage.src.length}`} image={selectedImage} onChange={changeImage} onMove={moveBlock} onRemove={removeImage} onClose={() => setSelectedImage(null)} onError={message => showToast(message, 'error')} />}
      <input ref={imageRef} type="file" hidden accept="image/png,image/jpeg" aria-label="Image file" onChange={event => { addImage(event.target.files?.[0]); event.target.value = '' }} />
      {insert === 'link' && <form className="create-insert-panel" onSubmit={addLink}><FormGroup label="Link text"><input className="form-input" value={link.text} onChange={event => setLink(current => ({ ...current, text: event.target.value }))} /></FormGroup><FormGroup label="Link address"><input className="form-input" autoFocus placeholder="https://example.com" value={link.url} onChange={event => setLink(current => ({ ...current, url: event.target.value }))} /></FormGroup><div className="action-row"><button className="btn btn-primary btn-sm" type="submit">Add link</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setInsert(null)}>Cancel</button></div></form>}
      {insert === 'table' && <form className="create-insert-panel" onSubmit={addTable}><div className="form-grid"><FormGroup label="Body rows"><input className="form-input" type="number" min="1" max="20" value={table.rows} onChange={event => setTable(current => ({ ...current, rows: event.target.value }))} /></FormGroup><FormGroup label="Columns"><input className="form-input" type="number" min="1" max="8" value={table.columns} onChange={event => setTable(current => ({ ...current, columns: event.target.value }))} /></FormGroup></div><div className="action-row"><button className="btn btn-primary btn-sm" type="submit">Add table</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setInsert(null)}>Cancel</button></div></form>}
      <div ref={editorRef} className="create-document-editor rich-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label="Document content" aria-multiline="true" data-placeholder="Start writing your document…" onInput={event => sync(event.nativeEvent.inputType, true, event.timeStamp)} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); command(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo') }
        else setSelectedImage(null)
      }} onClick={event => { if (event.target.tagName === 'IMG') selectImage(event.target); else setSelectedImage(null) }} onPaste={event => {
        event.preventDefault()
        const html = event.clipboardData.getData('text/html')
        command(html ? 'insertHTML' : 'insertText', html ? editorMarkup(html) : event.clipboardData.getData('text/plain'))
      }} onDrop={event => { if (event.dataTransfer.files?.length) { event.preventDefault(); addImage(event.dataTransfer.files[0]) } }} style={{ fontFamily: layout.fontFamily === 'serif' ? '"Times New Roman", serif' : 'Arial, sans-serif', fontSize: `${options.fontSize * 4 / 3}px`, lineHeight: options.lineHeight }} />
      <div className="create-document-stats"><span>{stats.words} {stats.words === 1 ? 'word' : 'words'} · {stats.characters} characters</span><span>PNG and JPG images supported</span></div>
      <details className="create-page-settings"><summary>Page settings <span>{layout.pageSize} · {layout.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</span></summary><div className="form-grid">
        <FormGroup label="Page size"><select className="form-select" value={layout.pageSize} onChange={event => update('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
        <FormGroup label="Orientation"><select className="form-select" value={layout.orientation} onChange={event => update('orientation', event.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></FormGroup>
        <FormGroup label="Margins (points)"><input className="form-input" type="number" min="20" max="100" value={layout.margin} onChange={event => update('margin', Number(event.target.value) || 46)} /></FormGroup>
        <FormGroup label="Line spacing"><input className="form-input" type="number" min="1.1" max="2" step="0.1" value={layout.lineHeight} onChange={event => update('lineHeight', Number(event.target.value) || 1.35)} /></FormGroup>
        <FormGroup label="Header"><input className="form-input" value={layout.header} onChange={event => update('header', event.target.value)} /></FormGroup>
        <FormGroup label="Footer" hint="Use {page} and {total} for page numbers"><input className="form-input" value={layout.footer} onChange={event => update('footer', event.target.value)} /></FormGroup>
      </div></details>
      <button className="btn btn-primary btn-lg create-download" disabled={!stats.content || busy} onClick={download}><Download size={17} />{busy ? 'Creating…' : 'Download PDF'}</button>
    </div>
    <DocumentPdfPreview blob={stats.content ? preview?.blob : null} updating={stats.content && !current} error={current ? preview?.error : ''} empty={!stats.content} emptyLabel="Start writing to preview" />
  </div></ToolPage>
}
