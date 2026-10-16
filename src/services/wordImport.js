export async function wordToPdf(file, progress = () => {}) {
  progress(20)
  // Older iOS Safari versions support AbortController but not
  // AbortSignal.timeout. Keep the same endpoint and conversion engine.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)
  try {
    const response = await fetch('/api/word-to-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: file,
      signal: controller.signal,
    })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || (response.status === 413 ? 'This document exceeds the upload limit. Please choose a smaller DOCX.' : 'The conversion service is temporarily unavailable. Please try again.'))
    }
    if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The conversion service did not return a PDF.')
    const blob = await response.blob()
    if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The conversion service returned an invalid PDF.')
    progress(100)
    return blob
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Conversion took too long. Please try again.')
    if (error instanceof TypeError) throw new Error('Could not reach the conversion service. Check your connection and try again.')
    throw error
  } finally { clearTimeout(timeout) }
}
