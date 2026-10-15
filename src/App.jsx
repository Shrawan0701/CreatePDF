import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Database, Download, FileArchive, HardDrive, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { AppProvider, useApp } from './context/AppContext'
import { Topbar, SearchModal } from './components/Layout'
import { ToastContainer } from './components/ui'
import Dashboard from './pages/Dashboard'
import { TOOLS } from './data/tools'
import { clearAllData, deleteDocument, exportAppData, getDocuments, getStorageEstimate, importAppData, isStoragePersistent, renameDocument, requestPersistentStorage } from './services/storage'

const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })))
const MergePdf = lazy(() => import('./pages/tools/MergePdf'))
const CompressPdf = lazy(() => import('./pages/tools/CompressPdf'))
const SplitPdf = lazy(() => import('./pages/tools/SplitPdf'))
const OrganizePages = lazy(() => import('./pages/tools/OrganizePages'))
const EditPdf = lazy(() => import('./pages/tools/EditPdf'))
const SignPdf = lazy(() => import('./pages/tools/SignPdf'))
const ImagesToPdf = lazy(() => import('./pages/tools/ImagesToPdf'))
const GstInvoice = lazy(() => import('./pages/tools/GstInvoice'))
const PosBilling = lazy(() => import('./pages/tools/PosBilling'))
const Whiteboard = lazy(() => import('./pages/tools/Whiteboard'))
const WorkflowBuilder = lazy(() => import('./pages/tools/WorkflowBuilder'))
const ScanDocument = lazy(() => import('./pages/tools/ScanDocument'))
const createTools = () => import('./pages/tools/CreateTools')
const advancedTools = () => import('./pages/tools/AdvancedPageTools')
const annotateTools = () => import('./pages/tools/AnnotateTools')
const officeTools = () => import('./pages/tools/OfficeTools')
const finalTools = () => import('./pages/tools/FinalTools')
const convertTools = () => import('./pages/tools/ConvertTools')
const editTools = () => import('./pages/tools/EditTools')
const securityTools = () => import('./pages/tools/SecurityTools')
const CreatePdf = lazyNamed(createTools, 'CreatePdf'), MarkdownToPdf = lazyNamed(createTools, 'MarkdownToPdf'), HtmlToPdf = lazyNamed(createTools, 'HtmlToPdf'), TextToHandwriting = lazyNamed(createTools, 'TextToHandwriting'), EbookToPdf = lazyNamed(createTools, 'EbookToPdf'), CsvToPdf = lazyNamed(createTools, 'CsvToPdf'), HandwritingToPdf = lazyNamed(createTools, 'HandwritingToPdf'), PdfToHandwriting = lazyNamed(createTools, 'PdfToHandwriting')
const AlternateMix = lazyNamed(advancedTools, 'AlternateMix'), SplitByText = lazyNamed(advancedTools, 'SplitByText'), SplitByBookmarks = lazyNamed(advancedTools, 'SplitByBookmarks'), SplitInHalf = lazyNamed(advancedTools, 'SplitInHalf'), SplitBySize = lazyNamed(advancedTools, 'SplitBySize'), FlipMirror = lazyNamed(advancedTools, 'FlipMirror'), NUp = lazyNamed(advancedTools, 'NUp'), CropResize = lazyNamed(advancedTools, 'CropResize')
const FillForm = lazyNamed(annotateTools, 'FillForm'), Thumbmark = lazyNamed(annotateTools, 'Thumbmark'), RedactPdf = lazyNamed(annotateTools, 'RedactPdf'), InvertColors = lazyNamed(annotateTools, 'InvertColors')
const WordToPdf = lazyNamed(officeTools, 'WordToPdf'), ExcelToPdf = lazyNamed(officeTools, 'ExcelToPdf'), PowerPointToPdf = lazyNamed(officeTools, 'PowerPointToPdf'), PdfToWord = lazyNamed(officeTools, 'PdfToWord'), PdfToExcel = lazyNamed(officeTools, 'PdfToExcel'), PdfToPowerPoint = lazyNamed(officeTools, 'PdfToPowerPoint'), PdfToHtml = lazyNamed(officeTools, 'PdfToHtml'), PdfToEpub = lazyNamed(officeTools, 'PdfToEpub'), ExtractImages = lazyNamed(officeTools, 'ExtractImages')
const ResumeBuilder = lazyNamed(finalTools, 'ResumeBuilder'), P2PShare = lazyNamed(finalTools, 'P2PShare')
const PdfToJpg = lazyNamed(convertTools, 'PdfToJpg'), PdfToZip = lazyNamed(convertTools, 'PdfToZip'), ExtractText = lazyNamed(convertTools, 'ExtractText'), EditMetadata = lazyNamed(convertTools, 'EditMetadata')
const AddWatermark = lazyNamed(editTools, 'AddWatermark'), PageNumbers = lazyNamed(editTools, 'PageNumbers'), RotatePdf = lazyNamed(editTools, 'RotatePdf'), FlattenPdf = lazyNamed(editTools, 'FlattenPdf'), BatesNumbering = lazyNamed(editTools, 'BatesNumbering'), HeadersFooters = lazyNamed(editTools, 'HeadersFooters')
const EncryptPdf = lazyNamed(securityTools, 'EncryptPdf'), RemovePassword = lazyNamed(securityTools, 'RemovePassword'), UnlockPdf = lazyNamed(securityTools, 'UnlockPdf'), PrivacyScanner = lazyNamed(securityTools, 'PrivacyScanner'), FingerprintGenerator = lazyNamed(securityTools, 'FingerprintGenerator'), AutoRedact = lazyNamed(securityTools, 'AutoRedact')

export const IMPLEMENTED_TOOLS = {
  'scan-document': ScanDocument,
  'pdf-workflow': WorkflowBuilder,
  'merge-pdf': MergePdf,
  'alternate-mix': AlternateMix,
  'compress-pdf': CompressPdf,
  'split-pdf': SplitPdf,
  'split-by-text': SplitByText,
  'split-by-bookmarks': SplitByBookmarks,
  'split-in-half': SplitInHalf,
  'split-by-size': SplitBySize,
  'organize-pages': OrganizePages,
  'rotate-pdf': RotatePdf,
  'flip-mirror': FlipMirror,
  'n-up': NUp,
  'crop-resize': CropResize,
  'edit-pdf': EditPdf,
  'sign-pdf': SignPdf,
  thumbmark: Thumbmark,
  'pdf-to-handwriting': PdfToHandwriting,
  'text-to-handwriting': TextToHandwriting,
  'handwriting-to-pdf': HandwritingToPdf,
  'fill-form': FillForm,
  'redact-pdf': RedactPdf,
  'images-to-pdf': ImagesToPdf,
  'word-to-pdf': WordToPdf,
  'excel-to-pdf': ExcelToPdf,
  'powerpoint-to-pdf': PowerPointToPdf,
  'html-to-pdf': HtmlToPdf,
  'create-pdf': CreatePdf,
  'markdown-to-pdf': MarkdownToPdf,
  'csv-to-pdf': CsvToPdf,
  'ebook-to-pdf': EbookToPdf,
  'resume-builder': ResumeBuilder,
  'pdf-to-jpg': PdfToJpg,
  'pdf-to-word': PdfToWord,
  'extract-images': ExtractImages,
  'pdf-to-excel': PdfToExcel,
  'pdf-to-ppt': PdfToPowerPoint,
  'pdf-to-html': PdfToHtml,
  'pdf-to-epub': PdfToEpub,
  'pdf-to-zip': PdfToZip,
  'extract-text': ExtractText,
  'edit-metadata': EditMetadata,
  'add-watermark': AddWatermark,
  'page-numbers': PageNumbers,
  'bates-numbering': BatesNumbering,
  'headers-footers': HeadersFooters,
  'flatten-pdf': FlattenPdf,
  'invert-colors': InvertColors,
  'encrypt-pdf': EncryptPdf,
  'remove-password': RemovePassword,
  'unlock-pdf': UnlockPdf,
  'auto-redact': AutoRedact,
  'privacy-scanner': PrivacyScanner,
  fingerprint: FingerprintGenerator,
  'gst-invoice': GstInvoice,
  'pos-billing': PosBilling,
  'p2p-share': P2PShare,
  whiteboard: Whiteboard,
}

function AppShell() {
  const { isOnline, toasts, dismissToast } = useApp()
  const location = useLocation()
  const currentTool = useMemo(() => TOOLS.find((tool) => tool.route === location.pathname), [location.pathname])

  useEffect(() => {
    if (location.hash) {
      const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  return (
    <div className="app-shell">
      <main className="main-content">
        <Topbar breadcrumbs={currentTool ? [currentTool.category, currentTool.name] : location.pathname === '/settings' ? ['Settings'] : []} />
        {!isOnline && <div className="offline-banner">You are offline. Local PDF tools remain available.</div>}
        <div className="page-content">
          <Suspense fallback={<div className="route-loading"><div className="spinner" /><span>Loading tool…</span></div>}><Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            {TOOLS.map((tool) => {
              const Component = IMPLEMENTED_TOOLS[tool.id]
              return <Route key={tool.id} path={tool.route} element={<Component />} />
            })}
            <Route path="*" element={<Dashboard />} />
          </Routes></Suspense>
        </div>
      </main>
      <SearchModal />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function Settings() {
  const { theme, setTheme, showToast } = useApp()
  const [storage, setStorage] = useState(null)
  const [persistent, setPersistent] = useState(false)
  const [documents, setDocuments] = useState([])

  const refreshStorage = async () => {
    setStorage(await getStorageEstimate())
    setPersistent(await isStoragePersistent())
    setDocuments(await getDocuments())
  }

  useEffect(() => { refreshStorage() }, [])

  const backup = async () => {
    const data = await exportAppData()
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `createpdf-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showToast('Local data backup downloaded.', 'success')
  }

  const restore = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm('Replace all current local CreatePDF.si data with this backup?')) return
    try {
      await importAppData(JSON.parse(await file.text()))
      showToast('Backup restored. Reloading application.', 'success')
      window.setTimeout(() => window.location.reload(), 500)
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  const persist = async () => {
    const granted = await requestPersistentStorage()
    setPersistent(granted)
    showToast(granted ? 'Persistent storage enabled.' : 'The browser did not grant persistent storage.', granted ? 'success' : 'warning')
  }

  const clearData = async () => {
    if (!window.confirm('Delete all locally stored CreatePDF.si data on this browser?')) return
    await clearAllData()
    showToast('Local application data cleared.', 'success')
    window.location.reload()
  }

  return (
    <div className="tool-page">
      <div className="tool-page-header">
        <div className="tool-page-icon"><Database size={26} /></div>
        <h1 className="tool-page-title">Settings</h1>
        <p className="tool-page-desc">Control appearance, storage, and local privacy preferences.</p>
      </div>
      <div className="tool-panel settings-grid">
        <div>
          <h2 className="tool-panel-title">Appearance</h2>
          <div className="segmented-control">
            <button className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTheme('light')}>Light</button>
            <button className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTheme('dark')}>Dark</button>
          </div>
        </div>
        <div className="privacy-card"><ShieldCheck size={22} color="var(--success)" /><div><strong>Local-first by default</strong><p>Ordinary document processing stays in this browser session.</p></div></div>
        <div className="privacy-card"><HardDrive size={22} color="var(--primary)" /><div><strong>Browser storage</strong><p>{storage ? `${Math.round((storage.usage || 0) / 1048576)} MB used of ${Math.round((storage.quota || 0) / 1048576)} MB available.` : 'Saved projects and preferences use IndexedDB.'}</p></div></div>
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={backup}><Download size={16} /> Export app data</button>
          <label className="btn btn-secondary"><Upload size={16} /> Import app data<input type="file" accept="application/json,.json" hidden onChange={restore} /></label>
          <button className="btn btn-secondary" disabled={persistent} onClick={persist}><FileArchive size={16} /> {persistent ? 'Storage is persistent' : 'Keep data on this device'}</button>
        </div>
        {documents.length > 0 && <div className="settings-documents"><h2 className="tool-panel-title">Saved documents</h2>{documents.map((document) => <div className="settings-document" key={document.id}><div><strong>{document.name}</strong><small>{new Date(document.savedAt).toLocaleString()} · {Math.max(1, Math.round((document.blob?.size || 0) / 1024))} KB</small></div><button className="icon-btn" aria-label="Rename document" onClick={async () => { const name = window.prompt('Document name', document.name); if (!name) return; await renameDocument(document.id, name); await refreshStorage() }}><Pencil size={15} /></button><button className="icon-btn" aria-label="Delete document" onClick={async () => { await deleteDocument(document.id); await refreshStorage() }}><Trash2 size={15} /></button></div>)}</div>}
        <button className="btn btn-danger" onClick={clearData}><Trash2 size={16} /> Clear all local data</button>
      </div>
    </div>
  )
}

export default function App() {
  return <BrowserRouter><AppProvider><AppShell /></AppProvider></BrowserRouter>
}
