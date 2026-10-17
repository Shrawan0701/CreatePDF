export async function styledHtmlToPdf(html, options = {}, { signal } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch('/api/html-to-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html, options }), signal: controller.signal })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || 'HTML rendering is temporarily unavailable. Please try again.')
    }
    if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The renderer did not return a PDF.')
    const blob = await response.blob()
    if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The renderer returned an invalid PDF.')
    return blob
  } catch (error) {
    if (signal?.aborted) throw error
    if (error.name === 'AbortError') throw new Error('HTML rendering took too long. Try a smaller document.')
    if (error instanceof TypeError) throw new Error('Could not reach the HTML renderer. Check your connection and try again.')
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
