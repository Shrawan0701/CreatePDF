import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { makeWorkflowStep, normalizeWorkflowStep, parseWorkflowConfiguration, planWorkflow, readWorkflowSource, runPdfWorkflow, workflowConfiguration, workflowPages } from './pdfWorkflow'

const step = (type, settings = {}) => ({ ...makeWorkflowStep(type), settings: { ...makeWorkflowStep(type).settings, ...settings } })
async function source(pages, width = 300, name = 'source.pdf') {
  const document = await PDFDocument.create()
  for (let index = 0; index < pages; index++) document.addPage([width + index, 500])
  return readWorkflowSource(new File([await document.save()], name, { type: 'application/pdf' }))
}

describe('workflow ranges and configurations', () => {
  it('preserves explicit order, reverse ranges and every open-ended range', () => {
    expect(workflowPages('5,3-1,4', 5, { ordered: true })).toEqual([5, 3, 2, 1, 4])
    expect(workflowPages('2-,1', 4, { ordered: true })).toEqual([2, 3, 4, 1])
    expect(workflowPages('3,1', 5, { ordered: true, keepRemaining: true })).toEqual([3, 1, 2, 4, 5])
    expect(workflowPages('3-1,2', 5)).toEqual([1, 2, 3])
  })
  it('rejects malformed, missing, repeated or out-of-range order entries', () => {
    for (const input of ['0', '6', '1,,2', '1x', '-1', '1-8', '2.5']) expect(() => workflowPages(input, 5)).toThrow()
    expect(() => workflowPages('1,1', 5, { ordered: true })).toThrow('appears more than once')
    expect(() => workflowPages('', 5, { ordered: true })).toThrow('Enter a page order')
  })
  it('migrates old operation values including a custom page-number prefix', () => {
    const config = parseWorkflowConfiguration(JSON.stringify({ name: 'Old workflow', steps: [{ type: 'rotate', value: '180' }, { type: 'numbers', value: 'Chapter ' }] }))
    expect(config.steps[0].settings.angle).toBe(180)
    expect(config.steps[1].settings).toMatchObject({ format: 'custom', template: 'Chapter {number}' })
    expect(workflowConfiguration(config.name, config.steps).steps[1].settings.template).toBe('Chapter {number}')
  })
  it('validates imported operations/settings and rejects future versions', () => {
    for (const value of [{ version: 99, steps: [] }, { steps: [{ type: 'unknown' }] }, { steps: [{ type: 'rotate', settings: [] }] }, { steps: [step('rotate', { angle: { toString: null } })] }, { steps: [step('rotate', { angle: 23 })] }, { steps: [step('split', { every: 0 })] }, { steps: [step('watermark', { text: '' })] }, { steps: [step('compress', { mode: 'random' })] }]) expect(() => parseWorkflowConfiguration(JSON.stringify(value))).toThrow()
    expect(() => parseWorkflowConfiguration('not json')).toThrow('valid workflow JSON')
  })
})

describe('workflow planning', () => {
  it('propagates merge, extraction, split and remerge page counts', async () => {
    const sources = [await source(3), await source(4)]
    const plan = planWorkflow(sources, [step('merge'), step('reorder', { order: '7, 1-3', keepRemaining: false }), step('split', { every: 3 }), step('merge')])
    expect(plan.ready).toBe(true)
    expect(plan.rows.map(row => [row.output.files, row.output.pages])).toEqual([[1, 7], [1, 4], [2, 4], [1, 4]])
    expect(sources.map(item => item.pageCount)).toEqual([3, 4])
  })
  it('uses every source, converts images once and rejects repeated conversion', async () => {
    const sources = [await source(2), { kind: 'image', pageCount: 1, file: { name: 'photo.png' } }]
    expect(planWorkflow(sources, [step('merge')]).errors[0]).toContain('Images to PDF')
    const converted = planWorkflow(sources, [step('images'), step('merge')])
    expect(converted.ready).toBe(true)
    expect(converted.output).toEqual({ files: 1, pages: 3, images: 0 })
    expect(planWorkflow(sources, [step('images'), step('images')]).errors[0]).toContain('No images remain')
  })
  it('checks ranges against each step output, including after splitting', async () => {
    const plan = planWorkflow([await source(5)], [step('split', { every: 2 }), step('rotate', { pages: '2' })])
    expect(plan.ready).toBe(false)
    expect(plan.errors[0]).toContain('between 1 and 1')
  })
  it('skips disabled steps without consuming sources or changing counts', async () => {
    const skipped = { ...step('reorder', { order: '200' }), enabled: false }
    expect(planWorkflow([await source(2)], [skipped, step('rotate')]).ready).toBe(true)
    expect(planWorkflow([await source(2)], [skipped]).ready).toBe(false)
    expect(planWorkflow([], [step('compress')]).ready).toBe(false)
  })
})

describe('actual workflow execution', () => {
  it('passes each output into the next operation and preserves exact page order/rotations', async () => {
    const sources = [await source(2, 300, 'a.pdf'), await source(3, 500, 'b.pdf')]
    const steps = [step('merge'), step('reorder', { order: '5,1,3-4,2', keepRemaining: false }), step('rotate', { pages: '2-4', angle: 90 }), step('split', { every: 2 }), step('merge')]
    const records = [], progress = []
    const result = await runPdfWorkflow(sources, steps, { name: 'Ordered output', onStep: record => records.push(record), onProgress: value => progress.push(value) })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe('Ordered output.pdf')
    const pdf = await PDFDocument.load(await result.entries[0].file.arrayBuffer())
    expect(pdf.getPages().map(page => page.getWidth())).toEqual([502, 300, 500, 501, 301])
    expect(pdf.getPages().map(page => page.getRotation().angle)).toEqual([0, 90, 90, 90, 0])
    expect(records.filter(record => record.status === 'done')).toHaveLength(steps.length)
    expect(progress.at(-1)).toBe(100)
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true)
    expect(await PDFDocument.load(await sources[0].file.arrayBuffer()).then(pdf => pdf.getPage(0).getRotation().angle)).toBe(0)
  })
  it('processes multiple PDFs individually and gives same-named files unique output names', async () => {
    const result = await runPdfWorkflow([await source(2), await source(3)], [step('rotate')])
    expect(result.entries).toHaveLength(2)
    expect(new Set(result.entries.map(entry => entry.name)).size).toBe(2)
    expect(result.entries.map(entry => entry.pageCount)).toEqual([2, 3])
  })
  it('can cancel before starting and at a step boundary without returning partial files', async () => {
    const sources = [await source(2)], controller = new AbortController()
    controller.abort()
    await expect(runPdfWorkflow(sources, [step('rotate')], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const during = new AbortController()
    await expect(runPdfWorkflow(sources, [step('split')], { signal: during.signal, onStep: () => during.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects broken PDFs and invalid plans before processing', async () => {
    await expect(readWorkflowSource(new File(['broken'], 'broken.pdf', { type: 'application/pdf' }))).rejects.toThrow('valid, undamaged')
    await expect(runPdfWorkflow([await source(2)], [step('rotate', { pages: '8' })])).rejects.toThrow('between 1 and 2')
    expect(normalizeWorkflowStep({ type: 'reorder', value: '1-' }).settings.keepRemaining).toBe(true)
  })
})
