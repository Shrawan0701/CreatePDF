import { describe, expect, it } from 'vitest'
import { SCAN_DEFAULTS, scanDimensions, scanLayout } from './scanDocument'

const defaults = { paper: 'a4', orientation: 'auto', margin: 18, fit: 'fit' }

describe('scanned PDF image fitting', () => {
  it('keeps every image entirely inside the margins without stretching', () => {
    for (const [width, height] of [[800, 1200], [1200, 800], [900, 900], [10, 10000], [10000, 10]]) {
      for (const paper of ['a4', 'letter']) {
        const layout = scanLayout(width, height, { ...defaults, paper })
        expect(layout.x).toBeGreaterThanOrEqual(layout.margin - .001)
        expect(layout.y).toBeGreaterThanOrEqual(layout.margin - .001)
        expect(layout.x + layout.width).toBeLessThanOrEqual(layout.pageWidth - layout.margin + .001)
        expect(layout.y + layout.height).toBeLessThanOrEqual(layout.pageHeight - layout.margin + .001)
        expect(layout.width / layout.height).toBeCloseTo(width / height, 8)
        expect(layout.pageWidth > layout.pageHeight).toBe(width > height)
      }
    }
  })

  it('fills the printable area while preserving proportions and centering overflow', () => {
    const layout = scanLayout(1200, 800, { ...defaults, orientation: 'portrait', fit: 'fill', margin: 36 })
    expect(layout.width).toBeGreaterThanOrEqual(layout.availableWidth)
    expect(layout.height).toBeGreaterThanOrEqual(layout.availableHeight)
    expect(layout.x + layout.width / 2).toBeCloseTo(layout.pageWidth / 2)
    expect(layout.y + layout.height / 2).toBeCloseTo(layout.pageHeight / 2)
    expect(layout.width / layout.height).toBeCloseTo(1.5)
  })

  it('removes actual edge pixels before changing orientation', () => {
    const cropped = scanDimensions(1200, 800, { ...SCAN_DEFAULTS, rotation: 90, crop: 10 })
    expect(cropped).toEqual({ cropX: 120, cropY: 80, sourceWidth: 960, sourceHeight: 640, width: 640, height: 960 })
    expect(scanLayout(cropped.width, cropped.height, defaults).pageWidth).toBe(595.28)
  })

  it('matches image proportions with no borders, even if paper controls were previously set', () => {
    const layout = scanLayout(1200, 800, { ...defaults, paper: 'image', orientation: 'portrait', margin: 36, fit: 'fill' })
    expect(layout).toMatchObject({ pageWidth: 900, pageHeight: 600, x: 0, y: 0, margin: 0, width: 900, height: 600 })
    const large = scanLayout(40000, 20000, { ...defaults, paper: 'image' })
    expect(large.pageWidth).toBe(14400)
    expect(large.pageWidth / large.pageHeight).toBe(2)
  })
})
