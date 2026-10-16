import { useEffect, useRef, useState } from 'react'
import { MM_TO_PT, paintPhoto, passportCutGuides } from '../../services/passportSheet'

export function PassportSheetPreview({ layout, photos, guides, spacing }) {
  const canvas = useRef(null)
  const [requestedPage, setPage] = useState(0)
  const page = Math.min(requestedPage, layout.pageCount - 1)
  useEffect(() => {
    const sheet = canvas.current
    if (!sheet) return
    const scale = 840 / layout.pageWidth
    sheet.width = 840
    sheet.height = Math.round(layout.pageHeight * scale)
    const context = sheet.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, sheet.width, sheet.height)
    const thumbnails = new Map()
    for (const placement of layout.placements.filter(placement => placement.page === page)) {
      let thumbnail = thumbnails.get(placement.photoIndex)
      if (!thumbnail) {
        thumbnail = paintPhoto(document.createElement('canvas'), photos[placement.photoIndex], placement.width, placement.height, {
          width: Math.ceil(placement.width * scale), height: Math.ceil(placement.height * scale),
        })
        thumbnails.set(placement.photoIndex, thumbnail)
      }
      const x = placement.x * scale, y = placement.y * scale
      const width = placement.width * scale, height = placement.height * scale
      context.drawImage(thumbnail, x, y, width, height)
      if (guides) {
        context.strokeStyle = '#777'
        context.lineWidth = .3 / MM_TO_PT * scale
        context.beginPath()
        for (const [x1, y1, x2, y2] of passportCutGuides(placement, layout, spacing)) {
          context.moveTo(x1 * scale, y1 * scale)
          context.lineTo(x2 * scale, y2 * scale)
        }
        context.stroke()
      }
    }
    thumbnails.forEach(thumbnail => { thumbnail.width = thumbnail.height = 0 })
  }, [layout, photos, guides, spacing, page])
  return <section className="passport-sheet-preview" aria-label="Live passport sheet preview">
    <div className="document-actions"><h3>Sheet preview</h3><span>{layout.pageWidth.toFixed(1)} × {layout.pageHeight.toFixed(1)} mm</span></div>
    <canvas ref={canvas} aria-label={`Sheet ${page + 1} of ${layout.pageCount}, showing the current photo crops and spacing`} />
    <div className="document-actions">
      <button type="button" className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous sheet</button>
      <span aria-live="polite">Sheet {page + 1} of {layout.pageCount}</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page + 1 >= layout.pageCount} onClick={() => setPage(page + 1)}>Next sheet</button>
    </div>
  </section>
}
