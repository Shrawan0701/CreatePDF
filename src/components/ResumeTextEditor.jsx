import { useCallback, useEffect, useRef, useState } from 'react'
import { paintResumeEditor, readResumeEditor, resumeEditorHtml } from '../services/resumeFormatting'
import { safeResumeUrl } from '../services/resumeModel'

export function ResumeTextEditor({ label, value, onChange, bullets = false, bodyColor, linkColor }) {
  const editorRef = useRef(null)
  const selectionRef = useRef(null)
  const localValueRef = useRef(null)
  const [color, setColor] = useState('#175cd3')
  const [selected, setSelected] = useState(false)
  const [link, setLink] = useState(null)
  const remember = useCallback(() => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode) || !editorRef.current.contains(selection.focusNode)) return
    selectionRef.current = selection.getRangeAt(0).cloneRange()
    setSelected(!selection.isCollapsed && Boolean(selection.toString()))
  }, [])
  useEffect(() => {
    if (localValueRef.current !== value) {
      editorRef.current.innerHTML = resumeEditorHtml(value)
      paintResumeEditor(editorRef.current)
      localValueRef.current = value
      selectionRef.current = null
      setSelected(false)
    }
  }, [value])
  useEffect(() => {
    document.addEventListener('selectionchange', remember)
    return () => document.removeEventListener('selectionchange', remember)
  }, [remember])
  const sync = () => {
    const next = readResumeEditor(editorRef.current)
    localValueRef.current = next
    onChange(next)
    remember()
  }
  const command = (action, value) => {
    const editor = editorRef.current
    const saved = selectionRef.current
    editor.focus({ preventScroll: true })
    const range = saved && editor.contains(saved.commonAncestorContainer) ? saved : document.createRange()
    if (range !== saved) { range.selectNodeContents(editor); range.collapse(false) }
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
    document.execCommand('styleWithCSS', false, false)
    document.execCommand('defaultParagraphSeparator', false, 'p')
    document.execCommand(action, false, value)
    sync()
  }
  const addLink = event => {
    event.preventDefault()
    const url = safeResumeUrl(link.url)
    if (!url) return setLink(current => ({ ...current, error: 'Enter a valid HTTP or HTTPS link.' }))
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const range = selectionRef.current
    if (range && !range.collapsed && range.toString() === link.text) command('createLink', url)
    else command('insertHTML', `<a href="${escape(url)}">${escape(link.text || url)}</a>`)
    setLink(null)
  }
  return <div className="resume-text-field">
    <span className="form-label">{label}</span>
    <div className="resume-text-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {[['Bold', 'bold'], ['Italic', 'italic'], ['Undo', 'undo'], ['Redo', 'redo'], ...(bullets ? [['New bullet', 'insertParagraph']] : [])].map(([title, action]) => <button type="button" key={title} onMouseDown={event => event.preventDefault()} onClick={() => command(action)}>{title}</button>)}
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => setLink(link ? null : { text: selectionRef.current?.toString() || '', url: '' })}>Link</button>
      <label className="resume-inline-color">Text color<input type="color" value={color} aria-label={`${label} selected text color`} onChange={event => setColor(event.target.value)} /></label>
      <button type="button" disabled={!selected} onMouseDown={event => event.preventDefault()} onClick={() => command('foreColor', color)}>Apply color</button>
    </div>
    {link && <form className="resume-inline-link" onSubmit={addLink}><label>Link text<input className="form-input" value={link.text} onChange={event => setLink(current => ({ ...current, text: event.target.value }))} /></label><label>Link address<input className="form-input" required value={link.url} placeholder="https://example.com" onChange={event => setLink(current => ({ ...current, url: event.target.value }))} /></label>{link.error && <p className="resume-field-error" role="alert">{link.error}</p>}<div className="action-row"><button type="submit" className="btn btn-primary btn-sm">Apply link</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setLink(null)}>Cancel</button></div></form>}
    <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-label={label} aria-multiline="true" className="form-textarea resume-rich-editor" data-bullets={bullets || undefined} onInput={sync} onBlur={remember} onPaste={event => { event.preventDefault(); command('insertHTML', resumeEditorHtml(event.clipboardData.getData('text/plain'))) }} style={{ color: bodyColor, '--resume-editor-link-color': linkColor }} />
    <p className="form-hint resume-format-hint">{bullets ? 'Each new line is a bullet. ' : ''}Highlight text, choose a color, then apply. Formatting stays visible as you write.</p>
  </div>
}
