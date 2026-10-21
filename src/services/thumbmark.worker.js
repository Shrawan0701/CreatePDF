import { processThumbmarkPixels } from './thumbmarkPixels'

self.onmessage = event => {
  try {
    const result = processThumbmarkPixels(event.data)
    self.postMessage(result, [result.data.buffer])
  } catch (error) { self.postMessage({ error: error.message || 'Could not process this image.' }) }
}
