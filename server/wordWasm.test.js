import { afterEach, describe, expect, it, vi } from 'vitest'
const engine = vi.hoisted(() => ({ initialize: vi.fn(), convert: vi.fn(), destroy: vi.fn() }))
vi.mock('@matbee/libreoffice-converter/server', () => ({ WorkerConverter: class {
  initialize = engine.initialize
  convert = engine.convert
  destroy = engine.destroy
} }))
import { createWasmExporter } from './wordWasm.js'
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })
describe('bundled Office engine', () => {
  it('reuses an initialized engine and passes original bytes for consecutive documents', async () => {
    const exportPdf = createWasmExporter()
    const bytes = Buffer.from('original DOCX')
    engine.convert.mockResolvedValue({ data: Buffer.from('%PDF-1.7\nfixture') })
    const progress = vi.fn()
    expect((await exportPdf(bytes, progress)).toString()).toContain('%PDF-')
    await exportPdf(bytes, progress)
    expect(engine.initialize).toHaveBeenCalledOnce()
    expect(engine.convert).toHaveBeenCalledWith(bytes, { outputFormat: 'pdf' }, 'document.docx')
    expect(engine.destroy).not.toHaveBeenCalled()
    expect(progress.mock.calls.map(([label]) => label)).toEqual(['Starting conversion engine', 'Converting document', 'Converting document'])
    await exportPdf.destroy()
    expect(engine.destroy).toHaveBeenCalledOnce()
  })
  it('discards a broken engine so a later job can recover', async () => {
    const exportPdf = createWasmExporter()
    engine.initialize.mockRejectedValueOnce(new Error('Engine failed'))
    await expect(exportPdf(Buffer.from('docx'))).rejects.toThrow('Engine failed')
    expect(engine.destroy).toHaveBeenCalledOnce()
    engine.convert.mockResolvedValue({ data: Buffer.from('%PDF-1.7\nfixture') })
    await exportPdf(Buffer.from('docx'))
    expect(engine.initialize).toHaveBeenCalledTimes(2)
    await exportPdf.destroy()
  })
  it('stops stalled initialization before the hosting timeout', async () => {
    vi.useFakeTimers()
    const exportPdf = createWasmExporter()
    engine.initialize.mockReturnValue(new Promise(() => {}))
    const pending = expect(exportPdf(Buffer.from('docx'))).rejects.toMatchObject({ status: 504 })
    await vi.advanceTimersByTimeAsync(110000)
    await pending
    expect(engine.destroy).toHaveBeenCalledOnce()
  })
  it('serializes documents so one conversion cannot overwrite another', async () => {
    const exportPdf = createWasmExporter()
    let finish
    engine.convert.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    engine.convert.mockResolvedValue({ data: Buffer.from('%PDF-1.7\nsecond') })
    const first = exportPdf(Buffer.from('first'))
    const second = exportPdf(Buffer.from('second'))
    await vi.waitFor(() => expect(engine.convert).toHaveBeenCalledOnce())
    finish({ data: Buffer.from('%PDF-1.7\nfirst') })
    await Promise.all([first, second])
    expect(engine.convert).toHaveBeenCalledTimes(2)
    await exportPdf.destroy()
  })
})
