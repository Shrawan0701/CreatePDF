async function readConversion(response, progress) {
  const reader = response.body.getReader()
  let buffer = new Uint8Array()
  let length = null
  let received = 0
  const parts = []
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      let remaining = value
      if (length === null) {
        const combined = new Uint8Array(buffer.length + value.length)
        combined.set(buffer); combined.set(value, buffer.length)
        buffer = combined
        let end
        while (length === null && (end = buffer.indexOf(10)) !== -1) {
          const event = JSON.parse(decoder.decode(buffer.subarray(0, end)))
          buffer = buffer.slice(end + 1)
          if (event.type === 'error') throw new Error(event.error)
          if (event.type === 'progress') progress(null, event.label)
          if (event.type === 'pdf') {
            if (!Number.isSafeInteger(event.length) || event.length <= 0) throw new Error('The conversion service returned an invalid PDF size.')
            length = event.length
          }
        }
        if (length === null) {
          if (buffer.length > 65536) throw new Error('Invalid conversion status response.')
          continue
        }
        remaining = buffer
        buffer = new Uint8Array()
      }
      if (remaining.length) {
        parts.push(remaining)
        received += remaining.length
      }
      if (received > length) throw new Error('The conversion service returned an invalid PDF size.')
      progress(Math.min(99, Math.floor(received / length * 100)), 'Downloading PDF')
    }
    if (length === null || received !== length) throw new Error('The download was interrupted. Please try again.')
    return new Blob(parts, { type: 'application/pdf' })
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function wordToPdf(file, progress = () => {}) {
  progress(null, 'Uploading document')
  // Older iOS Safari versions support AbortController but not
  // AbortSignal.timeout. Keep the same endpoint and conversion engine.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)
  try {
    const response = await fetch('/api/word-to-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Accept': 'application/vnd.createpdf.word-stream, application/pdf',
      },
      body: file,
      signal: controller.signal,
    })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || (response.status === 413 ? 'This document exceeds the upload limit. Please choose a smaller DOCX.' : 'The conversion service is temporarily unavailable. Please try again.'))
    }
    const contentType = response.headers.get('content-type') || ''
    let blob
    if (contentType.includes('application/vnd.createpdf.word-stream')) blob = await readConversion(response, progress)
    else if (contentType.includes('application/pdf')) {
      progress(null, 'Downloading PDF')
      blob = await response.blob()
    } else throw new Error('The conversion service did not return a PDF.')
    if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The conversion service returned an invalid PDF.')
    progress(100, 'PDF ready')
    return blob
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Conversion took too long. Please try again.')
    if (error instanceof TypeError) throw new Error('Could not reach the conversion service. Check your connection and try again.')
    throw error
  } finally { clearTimeout(timeout) }
}
