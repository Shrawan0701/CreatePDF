import { useEffect, useRef, useState } from 'react'
import { Download, Link2, RotateCcw, Send } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { DropZone, FileItem, FormGroup, ProgressBar, downloadBlob } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { ResumeComposer } from '../../components/ResumeComposer'


export function ResumeBuilder() { return <ResumeComposer /> }

export function P2PShare() {
  const { showToast } = useApp()
  const peerRef = useRef(null)
  const channelRef = useRef(null)
  const socketRef = useRef(null)
  const chunksRef = useRef([])
  const metaRef = useRef(null)
  const receivedBytesRef = useRef(0)
  const pendingCandidatesRef = useRef([])
  const roomRef = useRef('')
  const roleRef = useRef('')
  const [file, setFile] = useState(null)
  const [room, setRoom] = useState(() => crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase())
  const [status, setStatus] = useState('Not connected')
  const [connected, setConnected] = useState(false)
  const [received, setReceived] = useState(null)
  const [progress, setProgress] = useState(0)

  const signal = (payload) => socketRef.current?.readyState === WebSocket.OPEN && socketRef.current.send(JSON.stringify({ room: roomRef.current, payload }))
  const setupChannel = (channel) => {
    channelRef.current = channel
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => { setConnected(true); setProgress(0); setStatus('Direct connection ready') }
    channel.onclose = () => { setConnected(false); setStatus('Direct connection closed') }
    channel.onerror = () => { setConnected(false); setStatus('Connection error') }
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data)
        if (message.type === 'meta') {
          metaRef.current = message
          chunksRef.current = []
          receivedBytesRef.current = 0
          setReceived(null)
          setProgress(0)
          setStatus(`Receiving ${message.name}`)
        }
        if (message.type === 'done' && metaRef.current) {
          if (receivedBytesRef.current === metaRef.current.size) {
            setReceived({ blob: new Blob(chunksRef.current, { type: metaRef.current.mime }), name: metaRef.current.name })
            setProgress(100)
            setStatus('File received')
          } else setStatus('Transfer incomplete; ask sender to retry')
        }
      } else {
        chunksRef.current.push(event.data)
        receivedBytesRef.current += event.data.byteLength
        setProgress(Math.min(100, Math.round((receivedBytesRef.current / Math.max(1, metaRef.current?.size || 1)) * 100)))
      }
    }
  }
  const createPeer = () => {
    if (peerRef.current) return peerRef.current
    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    peerRef.current = connection
    connection.ondatachannel = (event) => setupChannel(event.channel)
    connection.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(connection.connectionState)) {
        setConnected(false)
        setStatus(`Connection ${connection.connectionState}`)
      }
    }
    connection.onicecandidate = (event) => {
      if (event.candidate) signal({ type: 'candidate', candidate: event.candidate })
    }
    return connection
  }
  const handleSignal = async (message) => {
    if (message.type === 'peer-ready' && roleRef.current === 'host') {
      const connection = createPeer()
      setupChannel(connection.createDataChannel('file'))
      await connection.setLocalDescription(await connection.createOffer())
      signal({ type: 'description', description: connection.localDescription })
      setStatus('Connecting to peer…')
    }
    if (message.type === 'description') {
      const connection = createPeer()
      await connection.setRemoteDescription(message.description)
      for (const candidate of pendingCandidatesRef.current) await connection.addIceCandidate(candidate)
      pendingCandidatesRef.current = []
      if (message.description.type === 'offer') {
        await connection.setLocalDescription(await connection.createAnswer())
        signal({ type: 'description', description: connection.localDescription })
      }
    }
    if (message.type === 'candidate') {
      const connection = createPeer()
      if (connection.remoteDescription) await connection.addIceCandidate(message.candidate)
      else pendingCandidatesRef.current.push(message.candidate)
    }
  }
  const reset = () => {
    channelRef.current?.close()
    peerRef.current?.close()
    socketRef.current?.close()
    channelRef.current = null
    peerRef.current = null
    socketRef.current = null
    chunksRef.current = []
    metaRef.current = null
    pendingCandidatesRef.current = []
    setConnected(false)
    setProgress(0)
    setReceived(null)
    setStatus('Not connected')
  }
  const connect = (role) => {
    if (!room.trim()) return showToast('Enter a room code.', 'warning')
    if (!window.WebSocket || !window.RTCPeerConnection) return showToast('This browser does not support peer-to-peer sharing.', 'error')
    reset()
    roomRef.current = room.trim().toUpperCase()
    roleRef.current = role
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${location.host}/signal`)
    socketRef.current = socket
    setStatus('Opening secure signaling…')
    socket.onopen = () => {
      signal({ type: role === 'host' ? 'host-ready' : 'peer-ready' })
      setStatus(role === 'host' ? 'Room ready—open it on the other device' : 'Joining room…')
    }
    socket.onmessage = (event) => handleSignal(JSON.parse(event.data)).catch(() => setStatus('Could not complete pairing'))
    socket.onerror = () => setStatus('Signaling unavailable—run the production server')
    socket.onclose = () => { if (channelRef.current?.readyState !== 'open') setStatus('Signaling closed') }
  }
  useEffect(() => () => {
    channelRef.current?.close()
    peerRef.current?.close()
    socketRef.current?.close()
  }, [])
  const send = async () => {
    const channel = channelRef.current
    if (!file || channel?.readyState !== 'open') return
    channel.send(JSON.stringify({ type: 'meta', name: file.name, mime: file.type, size: file.size }))
    setProgress(0)
    setStatus(`Sending ${file.name}`)
    for (let offset = 0; offset < file.size; offset += 16384) {
      while (channel.bufferedAmount > 4 * 1024 * 1024) await new Promise((resolve) => window.setTimeout(resolve, 20))
      if (channel.readyState !== 'open') { setStatus('Connection lost during transfer'); return }
      channel.send(await file.slice(offset, offset + 16384).arrayBuffer())
      setProgress(Math.round((Math.min(file.size, offset + 16384) / file.size) * 100))
    }
    channel.send(JSON.stringify({ type: 'done' }))
    setStatus('File sent')
  }
  return <ToolPage toolId="p2p-share"><div className="tool-panel"><p className="form-hint">Create a room on one device, enter the same code on the other, then join. The server exchanges connection details only; file bytes travel directly through WebRTC.</p><FormGroup label="Private room code"><input className="form-input signal-room" value={room} onChange={(event) => setRoom(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))} /></FormGroup><div className="action-row"><button className="btn btn-primary" onClick={() => connect('host')}><Link2 size={15} /> Create room</button><button className="btn btn-secondary" onClick={() => connect('join')}><Link2 size={15} /> Join room</button><button className="btn btn-secondary" onClick={reset}><RotateCcw size={15} /> Reset</button><span className="status-pill">{status}</span></div></div><div className="tool-panel"><DropZone onFiles={([selected]) => { setFile(selected); setProgress(0) }}><Send size={28} /><div className="drop-zone-title">Choose a file to send</div></DropZone>{file && <FileItem file={file} onRemove={() => setFile(null)} />}{progress > 0 && <ProgressBar value={progress} label={status} />}<div className="action-row"><button className="btn btn-primary" disabled={!file || !connected} onClick={send}>Send directly</button>{received && <button className="btn btn-primary" onClick={() => downloadBlob(received.blob, received.name)}><Download size={15} /> Download {received.name}</button>}</div></div></ToolPage>
}
