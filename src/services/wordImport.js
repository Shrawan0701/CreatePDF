export async function wordToPdf(file, progress = () => {}) {
  progress(20)
  const response = await fetch('/api/word-to-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    body: file,
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.error || 'The Office conversion service is unavailable. Start the app with npm run dev or npm start and configure an Office engine.')
  }
  if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The conversion service did not return a PDF.')
  const blob = await response.blob()
  if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The conversion service returned an invalid PDF.')
  progress(100)
  return blob
}
