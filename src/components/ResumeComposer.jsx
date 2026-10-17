import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Save, Trash2 } from 'lucide-react'
import { ToolPage } from './ToolPage'
import { DocumentPdfPreview } from './DocumentPdfPreview'
import { ResumeTextEditor } from './ResumeTextEditor'
import { FormGroup, downloadBlob } from './ui'
import { useApp } from '../context/AppContext'
import { getResumes, saveResume } from '../services/storage'
import { emptyResume, newResumeEntry, normalizeResume, resumeDesign, resumeId, resumeSections, resumeTemplates, safeResumeUrl } from '../services/resumeModel'
import { resumeToPdf } from '../services/resumePdf'

function ResumeInput({ label, value, onChange, placeholder, type }) {
  return <FormGroup label={label}><input className="form-input" type={type} value={value || ''} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></FormGroup>
}

export function ResumeComposer() {
  const { showToast } = useApp()
  const [data, setData] = useState(emptyResume)
  const [saved, setSaved] = useState([])
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const requestRef = useRef(null)
  const change = updater => { setDirty(true); setData(current => typeof updater === 'function' ? updater(current) : { ...current, ...updater }) }
  const field = (key, value) => change(current => ({ ...current, [key]: value }))
  const design = resumeDesign(data)
  const setDesign = (key, value) => change(current => ({ ...current, design: { ...current.design, [key]: value } }))
  useEffect(() => {
    let cancelled = false
    getResumes().then(items => { if (!cancelled) { setSaved(items); if (items[0] && !dirty) setData(normalizeResume(items[0])) } }).catch(error => showToast(error.message, 'error'))
    return () => { cancelled = true }
  }, [showToast, dirty])
  const getPdf = useCallback(() => {
    if (requestRef.current?.data === data) return requestRef.current.promise
    const request = { data }
    request.promise = resumeToPdf(data).catch(error => { if (requestRef.current === request) requestRef.current = null; throw error })
    requestRef.current = request
    return request.promise
  }, [data])
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      getPdf().then(blob => { if (!cancelled) setPreview({ data, blob }) }).catch(error => { if (!cancelled) setPreview({ data, error: error.message }) })
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [data, getPdf])
  const updateEntry = (type, id, key, value) => change(current => ({ ...current, [type]: current[type].map(entry => entry.id === id ? { ...entry, [key]: value } : entry) }))
  const reorderEntry = (type, index, direction) => change(current => {
    const entries = [...current[type]]
    const other = index + direction
    if (other < 0 || other >= entries.length) return current
    ;[entries[index], entries[other]] = [entries[other], entries[index]]
    return { ...current, [type]: entries }
  })
  const reorderSection = (index, direction) => change(current => {
    const order = [...current.sectionOrder]
    const other = index + direction
    if (other < 0 || other >= order.length) return current
    ;[order[index], order[other]] = [order[other], order[index]]
    return { ...current, sectionOrder: order }
  })
  const addEntry = type => change(current => ({ ...current, [type]: [...current[type], newResumeEntry(type)] }))
  const addCustom = () => {
    const section = newResumeEntry('custom')
    change(current => ({ ...current, custom: [...current.custom, section], sectionOrder: [...current.sectionOrder, section.id] }))
  }
  const chooseTemplate = value => change(current => ({ ...current, template: value, design: { ...current.design, accent: resumeTemplates[value].accent, fontSize: resumeTemplates[value].fontSize } }))
  const uploadPhoto = async file => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return showToast('Choose a PNG or JPG photo.', 'warning')
    const resume = data.id
    setPhotoBusy(true)
    try {
      const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read your photo.')); reader.readAsDataURL(file) })
      const image = new Image(); image.src = source; await image.decode()
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      const photo = canvas.toDataURL(file.type, .9)
      change(current => current.id === resume ? { ...current, photo } : current)
    } catch (error) { showToast(error.message || 'Could not load your photo.', 'error') } finally { setPhotoBusy(false) }
  }
  const save = async () => {
    try { await saveResume({ ...data, updatedAt: Date.now() }); setSaved(await getResumes()); showToast('Resume saved locally.', 'success') } catch (error) { showToast(error.message, 'error') }
  }
  const download = async () => {
    if (!data.name.trim()) return
    setBusy(true)
    try {
      const blob = await getPdf()
      setPreview({ data, blob })
      downloadBlob(blob, `${data.name.trim().replace(/[<>:"/\\|?*]/g, '') || 'Resume'}_Resume.pdf`)
      showToast('Resume PDF created.', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { setBusy(false) }
  }
  const input = (label, value, onChange, placeholder = '', type = 'text') => <ResumeInput label={label} value={value} onChange={onChange} placeholder={placeholder} type={type} />
  const entryInput = (type, item, key, label, placeholder) => input(label, item[key], value => updateEntry(type, item.id, key, value), placeholder)
  const entryFields = (type, item, index) => <div className="resume-entry" key={item.id} role="group" aria-label={`${resumeSections[type]} entry ${index + 1}`}>
    <div className="resume-entry-heading"><strong>{type === 'experience' ? item.role || `Role ${index + 1}` : type === 'education' ? item.degree || `Education ${index + 1}` : item.name || `Project ${index + 1}`}</strong><div className="resume-icon-actions">
      <button type="button" aria-label={`Move ${type} entry ${index + 1} up`} disabled={index === 0} onClick={() => reorderEntry(type, index, -1)}><ArrowUp size={15} /></button><button type="button" aria-label={`Move ${type} entry ${index + 1} down`} disabled={index === data[type].length - 1} onClick={() => reorderEntry(type, index, 1)}><ArrowDown size={15} /></button><button type="button" aria-label={`Remove ${type} entry ${index + 1}`} onClick={() => change(current => ({ ...current, [type]: current[type].filter(entry => entry.id !== item.id) }))}><Trash2 size={15} /></button>
    </div></div>
    <div className="form-grid">{type === 'experience' ? <>{entryInput(type, item, 'role', 'Job title', 'Backend Engineer')}{entryInput(type, item, 'organization', 'Company', 'Company name')}</> : type === 'education' ? <>{entryInput(type, item, 'degree', 'Degree or qualification', 'B.E. Computer Engineering')}{entryInput(type, item, 'institution', 'Institution', 'University or school')}</> : <>{entryInput(type, item, 'name', 'Project name', 'Project name')}{entryInput(type, item, 'role', 'Project role or technologies', 'Java, React, PostgreSQL')}</>}
      {type !== 'projects' ? <>{entryInput(type, item, 'location', 'Location', 'Pune, India')}{entryInput(type, item, 'start', 'Start date', 'Jun 2024')}{entryInput(type, item, 'end', 'End date', 'Present')}</> : entryInput(type, item, 'url', 'Project link', 'https://github.com/you/project')}
    </div>
    {type === 'projects' && item.url && !safeResumeUrl(item.url) && <p className="resume-field-error">Enter a valid HTTP or HTTPS project link.</p>}
    <ResumeTextEditor bodyColor={design.bodyColor} linkColor={design.linkColor} label={type === 'experience' ? 'Experience bullets' : type === 'education' ? 'Education details' : 'Project bullets'} value={item.details} onChange={value => updateEntry(type, item.id, 'details', value)} bullets />
  </div>
  const current = preview?.data === data
  const sectionTitles = useMemo(() => ({ ...resumeSections, ...Object.fromEntries(data.custom.map(section => [section.id, section.title || 'Custom section'])) }), [data.custom])
  return <ToolPage toolId="resume-builder"><div className="composer-layout resume-composer-layout">
    <div className="tool-panel resume-builder-panel">
      <div className="resume-panel-heading"><h2 className="tool-panel-title">Build your resume</h2><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDirty(true); setData(emptyResume()) }}>New resume</button></div>
      {saved.length > 0 && <FormGroup label="Saved resume"><select className="form-select" value={saved.some(item => item.id === data.id) ? data.id : ''} onChange={event => { const selected = saved.find(item => item.id === event.target.value); if (selected) { setDirty(true); setData(normalizeResume(selected)) } }}><option value="">Choose a saved resume</option>{saved.map(item => <option key={item.id} value={item.id}>{item.name || 'Untitled resume'}</option>)}</select></FormGroup>}
      <FormGroup label="Template"><select className="form-select" value={data.template} onChange={event => chooseTemplate(event.target.value)}>{Object.entries(resumeTemplates).map(([key, template]) => <option key={key} value={key}>{template.label}</option>)}</select></FormGroup>
      <div className="resume-template-grid">{Object.entries(resumeTemplates).map(([key, template]) => <button type="button" key={key} className={`resume-template-card resume-template-${key}`} aria-label={`${template.label} template`} aria-pressed={data.template === key} onClick={() => chooseTemplate(key)}><span className="resume-template-sketch" aria-hidden="true"><i /><i /><i /><i /></span><strong>{template.label}</strong><span>{template.description}</span></button>)}</div>
      <details className="resume-builder-section" open><summary>Typography &amp; page</summary><div className="form-grid resume-section-content">
        <FormGroup label="Resume font"><select className="form-select" value={data.design.fontFamily} onChange={event => setDesign('fontFamily', event.target.value)}><option value="template">Template default</option><option value="sans-serif">Arial / sans serif</option><option value="serif">Times / serif</option><option value="monospace">Courier / monospace</option></select></FormGroup>
        {['fontSize', 'nameSize', 'headingSize', 'margin', 'lineHeight'].map((key, index) => <FormGroup key={key} label={['Body size (pt)', 'Name size (pt)', 'Section heading size (pt)', 'Page margins (pt)', 'Line spacing'][index]}><input className="form-input" type="number" min={[8, 18, 9, 24, 1.1][index]} max={[16, 42, 20, 72, 1.8][index]} step={key === 'lineHeight' ? '.05' : '.5'} value={data.design[key]} onChange={event => setDesign(key, event.target.value)} onBlur={() => setDesign(key, design[key])} /></FormGroup>)}
        <FormGroup label="Paper size"><select className="form-select" value={data.design.pageSize} onChange={event => setDesign('pageSize', event.target.value)}><option>A4</option><option>Letter</option></select></FormGroup>
      </div></details>
      <details className="resume-builder-section" open><summary>Colors &amp; section lines</summary><div className="form-grid resume-section-content">
        {[["accent", "Heading / accent color"], ["bodyColor", "Body text color"], ["linkColor", "Link color"], ["dividerColor", "Section line color"]].map(([key, label]) => <FormGroup key={key} label={label}><input className="form-input" type="color" value={design[key]} onChange={event => setDesign(key, event.target.value)} /></FormGroup>)}
        <FormGroup label="Section divider lines"><select className="form-select" value={design.sectionDividers} onChange={event => setDesign('sectionDividers', event.target.value)}><option value="below">Under each section heading</option><option value="above">Above each section heading</option><option value="none">No section lines</option></select></FormGroup>
        {design.sectionDividers !== 'none' && <FormGroup label="Section line thickness (pt)"><input className="form-input" type="number" min=".3" max="2" step=".1" value={data.design.dividerWidth} onChange={event => setDesign('dividerWidth', event.target.value)} onBlur={() => setDesign('dividerWidth', design.dividerWidth)} /></FormGroup>}
      </div></details>
      <details className="resume-builder-section" open><summary>Personal details</summary><div className="resume-section-content">
        <div className="form-grid">{input('Full name', data.name, value => field('name', value), 'Your full name')}{input('Professional title', data.title, value => field('title', value), 'Backend Engineer')}{input('Email', data.email, value => field('email', value), 'you@example.com', 'email')}{input('Phone', data.phone, value => field('phone', value), '+91 …', 'tel')}{input('City / location', data.location, value => field('location', value), 'Pune, India')}</div>
        <div className="resume-subheading"><h3>Links</h3><button type="button" className="btn btn-secondary btn-sm" onClick={() => change(current => ({ ...current, links: [...current.links, { id: resumeId(), label: '', url: '' }] }))}><Plus size={14} />Add link</button></div>
        <p className="form-hint">Add LinkedIn, GitHub, a portfolio, or another website. Links remain clickable in your PDF.</p>
        {data.links.map((link, index) => <div className="resume-link-row" key={link.id} role="group" aria-label={`Profile link ${index + 1}`}>{input('Link label', link.label, value => updateEntry('links', link.id, 'label', value), 'LinkedIn')}{input('Link URL', link.url, value => updateEntry('links', link.id, 'url', value), 'https://linkedin.com/in/you')}<button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove link ${index + 1}`} onClick={() => change(current => ({ ...current, links: current.links.filter(item => item.id !== link.id) }))}><Trash2 size={14} /></button>{link.url && !safeResumeUrl(link.url) && <p className="resume-field-error">Enter a valid HTTP or HTTPS link.</p>}</div>)}
      </div></details>
      <details className="resume-builder-section"><summary>Photo <span>Optional</span></summary><div className="resume-section-content">
        <div className="resume-photo-row">{data.photo && <img src={data.photo} alt="Resume photo" />}<label className="btn btn-secondary btn-sm">{photoBusy ? 'Loading photo…' : data.photo ? 'Replace photo' : 'Add photo'}<input type="file" hidden accept="image/png,image/jpeg" aria-label="Resume photo file" disabled={photoBusy} onChange={event => { uploadPhoto(event.target.files?.[0]); event.target.value = '' }} /></label>{data.photo && <button type="button" className="btn btn-secondary btn-sm" onClick={() => field('photo', '')}>Remove photo</button>}</div>
        {data.photo && <div className="form-grid"><FormGroup label="Photo size (pt)"><input className="form-input" type="number" min="40" max="100" value={data.design.photoSize} onChange={event => setDesign('photoSize', event.target.value)} /></FormGroup><FormGroup label="Photo shape"><select className="form-select" value={data.design.photoShape} onChange={event => setDesign('photoShape', event.target.value)}><option value="circle">Circle</option><option value="square">Square</option></select></FormGroup><FormGroup label="Photo position"><select className="form-select" value={data.design.photoPosition} onChange={event => setDesign('photoPosition', event.target.value)}><option value="right">Right of name</option><option value="left">Left of name</option></select></FormGroup></div>}
        <p className="form-hint">PNG or JPG. Your photo is fitted to a centered square or circle.</p>
      </div></details>
      <p className="form-hint resume-order-help">Use the arrows to reorder sections or entries. Uncheck a section to hide it from the PDF.</p>
      {data.sectionOrder.map((key, index) => {
        const custom = data.custom.find(section => section.id === key)
        return <details className="resume-builder-section" key={key} open={['summary', 'experience'].includes(key) || Boolean(custom)}><summary><span>{sectionTitles[key]}</span><div className="resume-icon-actions" onClick={event => event.stopPropagation()}><label className="resume-show-section" onClick={event => event.preventDefault()}><input type="checkbox" aria-label={`Show ${sectionTitles[key]} section`} checked={!data.hiddenSections.includes(key)} onClick={event => event.stopPropagation()} onChange={event => change(current => ({ ...current, hiddenSections: event.target.checked ? current.hiddenSections.filter(item => item !== key) : [...current.hiddenSections, key] }))} /></label><button type="button" aria-label={`Move ${sectionTitles[key]} section up`} disabled={index === 0} onClick={event => { event.preventDefault(); reorderSection(index, -1) }}><ArrowUp size={15} /></button><button type="button" aria-label={`Move ${sectionTitles[key]} section down`} disabled={index === data.sectionOrder.length - 1} onClick={event => { event.preventDefault(); reorderSection(index, 1) }}><ArrowDown size={15} /></button></div></summary>
          <div className="resume-section-content">{key === 'summary' ? <ResumeTextEditor bodyColor={design.bodyColor} linkColor={design.linkColor} label="Profile" value={data.summary} onChange={value => field('summary', value)} /> : key === 'skills' ? <FormGroup label="Skills" hint="Separate skills with commas or new lines."><textarea className="form-textarea" value={data.skills} onChange={event => field('skills', event.target.value)} placeholder="Java, Spring Boot, React, PostgreSQL" /></FormGroup> : custom ? <>{input('Section title', custom.title, value => updateEntry('custom', custom.id, 'title', value), 'Certifications, awards, languages…')}<ResumeTextEditor bodyColor={design.bodyColor} linkColor={design.linkColor} label="Section bullets" value={custom.details} onChange={value => updateEntry('custom', custom.id, 'details', value)} bullets /><button type="button" className="btn btn-secondary btn-sm" onClick={() => change(current => ({ ...current, custom: current.custom.filter(item => item.id !== key), sectionOrder: current.sectionOrder.filter(item => item !== key), hiddenSections: current.hiddenSections.filter(item => item !== key) }))}>Remove section</button></> : <>{data[key].map((item, entryIndex) => entryFields(key, item, entryIndex))}<button type="button" className="btn btn-secondary btn-sm" onClick={() => addEntry(key)}><Plus size={14} />{key === 'experience' ? 'Add experience' : key === 'education' ? 'Add education' : 'Add project'}</button></>}</div>
        </details>
      })}
      <button type="button" className="btn btn-secondary resume-add-section" onClick={addCustom}><Plus size={15} />Add custom section</button>
      <div className="resume-save-actions"><button type="button" className="btn btn-secondary" onClick={save}><Save size={16} />Save locally</button><button type="button" className="btn btn-primary" disabled={busy || photoBusy || !data.name.trim()} onClick={download}><Download size={16} />{busy ? 'Creating…' : 'Download PDF'}</button></div>
      <p className="form-hint">{!data.name.trim() ? 'Enter your name to download. ' : ''}Save locally keeps an editable copy in this browser.</p>
    </div>
    <DocumentPdfPreview blob={preview?.blob} updating={!current || photoBusy} error={current ? preview?.error : ''} empty={false} />
  </div></ToolPage>
}
