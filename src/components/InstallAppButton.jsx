import { useId, useRef } from 'react'
import { Download, Share, Smartphone, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import createPdfLogo from '../assets/createpdf.png'

function installInstructions() {
  const agent = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) return {
    platform: 'iPhone & iPad',
    steps: ['Open this page in Safari and tap Share. You may find Share in the browser’s page menu.', 'Choose Add to Home Screen.', 'Turn on Open as Web App if shown, then tap Add.'],
  }
  if (/Android/i.test(agent)) return {
    platform: 'Android',
    steps: ['Open your browser’s menu (⋮).', 'Choose Install app or Add to Home screen.', 'Tap Install or Add to confirm.'],
  }
  if (/Macintosh/.test(agent) && /Safari/.test(agent) && !/Chrome|Chromium|Edg|OPR/.test(agent)) return {
    platform: 'Safari on Mac',
    steps: ['Open File in Safari’s menu bar.', 'Choose Add to Dock.', 'Confirm the name and select Add.'],
  }
  return {
    platform: 'Your browser',
    steps: ['Open your browser’s menu.', 'Look for Install app or Install this site as an app, then confirm.', 'If you cannot find an install option, try opening this site in Chrome, Edge or Safari.'],
  }
}

export function InstallAppButton() {
  const { deferredInstallPrompt, installPwa, isAppInstalled, isInstalling } = useApp()
  const dialog = useRef(null)
  const titleId = useId()
  const instructions = installInstructions()
  const install = async () => {
    if (deferredInstallPrompt) {
      const outcome = await installPwa()
      if (outcome !== 'unavailable') return
    }
    if (!dialog.current?.open) dialog.current?.showModal()
  }
  if (isAppInstalled) return null
  return <>
    <button className="header-install" onClick={install} title="Install CreatePDF.tech" aria-label="Install CreatePDF.tech" disabled={isInstalling}><Download size={16} /><span>{isInstalling ? 'Installing…' : 'Install app'}</span></button>
    <dialog ref={dialog} className="install-app-dialog" aria-labelledby={titleId} onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current.close()
    }}>
      <div className="install-app-heading"><img src={createPdfLogo} alt="" width="42" height="42" /><div><h2 id={titleId}>Install CreatePDF.tech</h2><p>{instructions.platform}</p></div><button className="icon-btn" autoFocus aria-label="Close install instructions" onClick={() => dialog.current.close()}><X size={19} /></button></div>
      <p className="install-app-intro"><Smartphone size={18} />Keep your PDF tools one tap away. Add CreatePDF.tech to your device and open it like an app.</p>
      <ol className="install-app-steps">{instructions.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p>{index === 0 && instructions.platform === 'iPhone & iPad' && <Share size={18} aria-hidden="true" />}</li>)}</ol>
      {deferredInstallPrompt && <button className="btn btn-primary install-app-now" disabled={isInstalling} onClick={async () => { const outcome = await installPwa(); if (outcome === 'accepted') dialog.current?.close() }}><Download size={16} /> Install now</button>}
      <button className="btn btn-secondary install-app-done" onClick={() => dialog.current.close()}>Got it</button>
    </dialog>
  </>
}
