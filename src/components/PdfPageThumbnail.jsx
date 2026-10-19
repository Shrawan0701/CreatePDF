import { useEffect, useRef, useState } from 'react'
import { FileText, LoaderCircle } from 'lucide-react'
import './PdfPageThumbnail.css'

export function PdfPageThumbnail({ pdf, page, large = false }) {
  const wrapper = useRef(null), canvas = useRef(null)
  const [visible, setVisible] = useState(large), [state, setState] = useState('loading')
  useEffect(() => {
    if (visible) return
    if (!window.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '300px' })
    observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [visible])
  useEffect(() => {
    if (!pdf || !visible) return
    let disposed = false, task
    setState('loading')
    const draw = async () => {
      const original = await pdf.getPage(page.num)
      if (disposed) return
      const rotation = (original.rotate + page.rotation + 360) % 360
      const native = original.getViewport({ scale: 1, rotation })
      const scale = Math.min((large ? 700 : 175) / native.width, (large ? 850 : 210) / native.height)
      const density = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = original.getViewport({ scale: scale * density, rotation })
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height)
      canvas.current.style.width = `${native.width * scale}px`; canvas.current.style.height = `${native.height * scale}px`
      task = original.render({ canvasContext: canvas.current.getContext('2d'), viewport })
      await task.promise
      if (!disposed) setState('ready')
    }
    draw().catch(() => { if (!disposed) setState('error') })
    return () => { disposed = true; task?.cancel() }
  }, [pdf, visible, page.num, page.rotation, large])
  return <div ref={wrapper} className={`pdf-page-thumbnail${large ? ' large' : ''}`}>
    <canvas ref={canvas} hidden={state !== 'ready'} style={{ transform: page.flipX || page.flipY ? `scale(${page.flipX ? -1 : 1}, ${page.flipY ? -1 : 1})` : undefined }} role="img" aria-label={`Source page ${page.num}${page.rotation ? `, rotated ${page.rotation} degrees` : ''}${page.flipX ? ', flipped horizontally' : ''}${page.flipY ? ', flipped vertically' : ''}`} />
    {state !== 'ready' && <span className="pdf-thumbnail-status">{state === 'error' ? <><FileText size={24} /> Preview unavailable</> : <LoaderCircle size={18} className="pdf-thumbnail-spin" />}</span>}
  </div>
}
