import { splitLoadedPdf } from './pdfSplit'

const check = signal => { if (signal?.aborted) throw new DOMException('Splitting cancelled.', 'AbortError') }
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index)

export function sizeLimitBytes(value, unit) {
  const text = String(value).trim(), multiplier = { KB: 1000, MB: 1000000 }[unit]
  if (!multiplier || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Enter a positive size, such as 500 KB or 1.5 MB.')
  // Convert decimal text directly so floating-point rounding cannot move an
  // exact byte limit down by one (or round a very large limit upward).
  const [whole, fraction = ''] = text.split('.'), precision = unit === 'MB' ? 6 : 3
  const bytes = BigInt(whole || '0') * BigInt(multiplier) + BigInt((fraction + '0'.repeat(precision)).slice(0, precision))
  if (bytes < 1n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Enter a size of at least 1 byte within the supported numeric range.')
  return Number(bytes)
}

// Decimal units match upload limits; the exact byte count is shown in the UI.
export function formatSizeBytes(bytes) {
  if (bytes < 1000) return `${bytes.toLocaleString()} B`
  const divisor = bytes < 1000000 ? 1000 : 1000000
  return `${(bytes / divisor).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${divisor === 1000 ? 'KB' : 'MB'}`
}

/** Partition whole pages. Every accepted Blob is the actual downloadable PDF,
 * including retained metadata, fields, annotations and bookmarks. Probes are
 * discarded, never regenerated for download. Exponential growth bounds the
 * work for documents that need many small parts; binary refinement finds a
 * larger fitting group without serializing every single-page increment.
 * Size need not be perfectly monotone (links/resources can change on export),
 * so only measured, fitting candidates are accepted; no minimum-part claim.
 */
export async function createSizePdfs(source, { limitBytes, oversized = 'keep', keepBookmarks = true }, { signal, onProgress = () => {} } = {}) {
  check(signal)
  if (!source?.pageCount || !Number.isSafeInteger(limitBytes) || limitBytes < 1) throw new Error('Choose a PDF and a valid maximum file size.')
  if (!['keep', 'stop'].includes(oversized)) throw new Error('Choose how to handle oversized pages.')
  const finish = (outputs, unchanged = false) => ({
    outputs: outputs.map(output => ({ ...output, oversized: output.blob.size > limitBytes })),
    unchanged, limitBytes, pageCount: source.pageCount,
  })
  // Preserve the original bytes, including any valid signatures, when no split
  // is necessary. No rewrite can make this particular download more faithful.
  if (source.file.size <= limitBytes) {
    onProgress(100, 'Already within the limit — original PDF retained')
    return finish([{ blob: source.file, pages: range(1, source.pageCount), skippedLinks: 0, signaturesCleared: 0, bookmarksRetained: null }], true)
  }
  let completed = 0, probes = 0
  const measure = async (first, last) => {
    check(signal)
    const label = `Measuring pages ${first}${last === first ? '' : `–${last}`}`
    const attempt = ++probes
    onProgress(null, `${label} · size check ${attempt}`)
    const [output] = await splitLoadedPdf(source, [range(first, last)], {
      signal, bookmarks: keepBookmarks ? source.bookmarks : null,
      onProgress: (value) => {
        check(signal)
        onProgress(null, value < 88 ? `${label} · size check ${attempt}` : `${label} · calculating file size`)
      },
    })
    check(signal)
    return output
  }
  // Rewriting can remove unused objects, so even a larger original may fit
  // intact. Use this same measured output if it does.
  let whole = await measure(1, source.pageCount)
  if (whole.blob.size <= limitBytes) { onProgress(100, 'One PDF fits the limit'); return finish([whole]) }
  const initialCount = Math.max(1, Math.min(source.pageCount, Math.floor(source.pageCount * limitBytes / whole.blob.size * .85)))
  const outputs = []
  for (let first = 1; first <= source.pageCount;) {
    check(signal)
    const remaining = source.pageCount - first + 1
    let count = Math.min(initialCount, remaining), best = null, bestCount = 0, failedCount = null
    // Reuse the full-document probe instead of serializing it twice.
    let candidate = first === 1 && count === source.pageCount ? whole : null
    if (first === 1 && source.pageCount === 1) candidate = whole
    whole = null
    while (true) {
      candidate ||= await measure(first, first + count - 1)
      if (candidate.blob.size > limitBytes) { failedCount = count; break }
      best = candidate; bestCount = count; candidate = null
      if (count === remaining) break
      count = Math.min(remaining, count * 2)
    }
    if (failedCount !== null) {
      // The only failing Blob we may keep is a single indivisible page.
      let single = failedCount === 1 ? candidate : null
      candidate = null
      let low = bestCount + 1, high = failedCount - 1
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const probe = await measure(first, first + middle - 1)
        if (middle === 1) single = probe
        if (probe.blob.size <= limitBytes) { best = probe; bestCount = middle; low = middle + 1 }
        else high = middle - 1
      }
      if (!best) {
        single ||= await measure(first, first)
        if (single.blob.size <= limitBytes) { best = single; bestCount = 1 }
        else {
          if (oversized === 'stop') {
            const error = new Error(`Page ${first} alone is ${formatSizeBytes(single.blob.size)} (${single.blob.size.toLocaleString()} bytes), above the ${limitBytes.toLocaleString()}-byte limit. Increase the limit, compress the source, or choose to keep oversized pages separately. No pages have been dropped.`)
            error.code = 'OVERSIZED_PAGE'; error.page = first
            throw error
          }
          best = single; bestCount = 1
        }
      }
    }
    if (!best || !bestCount) throw new Error('Could not create a complete size split. Try another limit.')
    outputs.push(best); first += bestCount; completed += bestCount
    onProgress(completed / source.pageCount * 95, `${outputs.length} part${outputs.length === 1 ? '' : 's'} prepared · ${completed} of ${source.pageCount} pages`)
  }
  check(signal)
  onProgress(100, `${outputs.length} PDFs measured and ready`)
  return finish(outputs)
}
