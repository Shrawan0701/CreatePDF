import { afterEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({ initialize: vi.fn(), convert: vi.fn(), destroy: vi.fn() }))
vi.mock('@matbee/libreoffice-converter/server', () => ({ WorkerConverter: class {
  initialize = engine.initialize
  convert = engine.convert
  destroy = engine.destroy
} }))
import { exportWasmPdf } from './wordWasm.js'

afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })
describe('bundled Office engine', () => {
  it('exports the original document and releases the worker', async () => {
    const bytes = Buffer.from('original DOCX')
    engine.convert.mockResolvedValue({ data: Buffer.from('%PDF-1.7\nfixture') })
    expect((await exportWasmPdf(bytes)).toString()).toContain('%PDF-')
    expect(engine.convert).toHaveBeenCalledWith(bytes, { outputFormat: 'pdf' }, 'document.docx')
    expect(engine.destroy).toHaveBeenCalledOnce()
  })
  it('releases resources when initialization fails', async () => {
    engine.initialize.mockRejectedValue(new Error('Engine failed'))
    await expect(exportWasmPdf(Buffer.from('docx'))).rejects.toThrow('Engine failed')
    expect(engine.destroy).toHaveBeenCalledOnce()
  })
  it('stops stalled initialization before the hosting timeout', async () => {
    vi.useFakeTimers()
    engine.initialize.mockReturnValue(new Promise(() => {}))
    const pending = expect(exportWasmPdf(Buffer.from('docx'))).rejects.toMatchObject({ status: 504 })
    await vi.advanceTimersByTimeAsync(110000)
    await pending
    expect(engine.destroy).toHaveBeenCalledOnce()
  })
})
