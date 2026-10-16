import { parentPort } from 'node:worker_threads'
import { LibreOfficeConverter } from '@matbee/libreoffice-converter/server'
import loader from '@matbee/libreoffice-converter/wasm/loader'
let converter
parentPort.on('message', async ({ id, type, payload }) => {
  try {
    let data
    if (type === 'init') {
      converter = new LibreOfficeConverter({
        wasmPath: payload.wasmPath,
        // Export through LibreOfficeKit; starting the desktop main loop can hang.
        wasmLoader: { createModule: config => loader.createModule({ ...config, noInitialRun: true }) },
      })
      await converter.initialize()
    } else if (type === 'convert') {
      const result = await converter.convert(payload.inputData, {
        inputFormat: payload.inputFormat, outputFormat: payload.outputFormat, filterOptions: payload.filterOptions,
      }, payload.filename)
      data = result.data
    } else if (type === 'destroy') {
      await converter?.destroy()
      converter = null
    } else throw new Error('Unsupported Office operation')
    parentPort.postMessage({ id, success: true, data })
  } catch (error) { parentPort.postMessage({ id, success: false, error: error.message }) }
})
parentPort.postMessage({ type: 'ready' })
