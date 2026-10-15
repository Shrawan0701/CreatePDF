import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FilePlus2, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { DropZone, downloadBlob, formatBytes } from './ui'
import { useApp } from '../context/AppContext'
import { deleteDocument, deleteRecentFile, getDocuments, getStorageEstimate, renameDocument, saveDocument } from '../services/storage'

export default function SavedDocumentsPanel() {
  const { recordRecentFile, showToast } = useApp()
  const [documents, setDocuments] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { getDocuments().then(setDocuments).catch((error) => showToast(error.message, 'error')) }, [showToast])

  const addFiles = async (files) => {
    setBusy(true)
    try {
      const estimate = await getStorageEstimate()
      for (const file of files) {
        if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) throw new Error('Choose a PDF file.')
        if (file.size === 0) throw new Error('The PDF is empty.')
        if (file.size > 200 * 1024 * 1024) throw new Error('This file exceeds the 200 MB local-storage limit.')
        if (estimate.quota && estimate.usage + file.size > estimate.quota) throw new Error('Not enough browser storage is available. Export a backup or clear unused files.')
        const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer())
        if (!header.includes('%PDF-')) throw new Error(`${file.name} is not a valid PDF file.`)
        const id = crypto.randomUUID()
        await saveDocument(id, file.name, file)
        await recordRecentFile({ id, documentId: id, name: file.name, size: file.size, type: 'application/pdf' })
      }
      setDocuments(await getDocuments())
      showToast(`${files.length} PDF${files.length === 1 ? '' : 's'} saved on this device.`, 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }

  const openFromDevice = async () => {
    if (!window.showOpenFilePicker) return
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'PDF documents', accept: { 'application/pdf': ['.pdf'] } }] })
      await addFiles(await Promise.all(handles.map((handle) => handle.getFile())))
    } catch (error) { if (error.name !== 'AbortError') showToast(error.message, 'error') }
  }

  const saveAs = async (document) => {
    if (!window.showSaveFilePicker) return downloadBlob(document.blob, document.name)
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: document.name, types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }] })
      const writable = await handle.createWritable()
      await writable.write(document.blob)
      await writable.close()
      showToast('PDF saved to the selected location.', 'success')
    } catch (error) { if (error.name !== 'AbortError') showToast(error.message, 'error') }
  }

  const rename = async (document) => {
    const name = window.prompt('Document name', document.name)
    if (!name?.trim()) return
    try { await renameDocument(document.id, name); setDocuments(await getDocuments()) } catch (error) { showToast(error.message, 'error') }
  }

  const remove = async (document) => {
    if (!window.confirm(`Delete ${document.name} from this browser?`)) return
    try { await deleteDocument(document.id); await deleteRecentFile(document.id); setDocuments(await getDocuments()) } catch (error) { showToast(error.message, 'error') }
  }

  return <section className="saved-documents-panel"><div className="section-header"><h2 className="section-title">Saved documents</h2>{window.showOpenFilePicker && <button className="btn btn-secondary btn-sm" onClick={openFromDevice}><FolderOpen size={15} /> Choose from device</button>}</div><DropZone accept={['application/pdf', '.pdf']} multiple onFiles={addFiles} className="saved-documents-drop"><FilePlus2 size={21} /><span>{busy ? 'Saving PDFs…' : 'Choose or drop PDFs to keep a local copy'}</span></DropZone><p className="form-hint">Saved only in this browser. Export important files or an app-data backup; browser storage can be cleared.</p>{documents.length > 0 && <div className="saved-documents-list">{documents.map((document) => <div className="saved-document-row" key={document.id}><div><strong>{document.name}</strong><small>{formatBytes(document.blob?.size || 0)} · {new Date(document.savedAt).toLocaleString()}</small></div><Link className="btn btn-secondary btn-sm" to={`/edit-pdf?document=${encodeURIComponent(document.id)}`}>Edit</Link><button className="icon-btn" title="Download PDF" onClick={() => downloadBlob(document.blob, document.name)}><Download size={16} /></button><button className="icon-btn" title="Save PDF to device" onClick={() => saveAs(document)}><FolderOpen size={16} /></button><button className="icon-btn" title="Rename PDF" onClick={() => rename(document)}><Pencil size={16} /></button><button className="icon-btn" title="Delete PDF" onClick={() => remove(document)}><Trash2 size={16} /></button></div>)}</div>}</section>
}
