export const resumeTemplates = {
  modern: { label: 'Modern', description: 'Accent header and clear section rules.', fontFamily: 'sans-serif', accent: '#0d7865', fontSize: 11 },
  classic: { label: 'Classic', description: 'Centered heading and traditional typography.', fontFamily: 'serif', accent: '#273244', fontSize: 11 },
  sidebar: { label: 'Sidebar', description: 'Skills and education in a shaded side column.', fontFamily: 'sans-serif', accent: '#224e78', fontSize: 10.5 },
  compact: { label: 'Compact', description: 'A clean, space-saving single column.', fontFamily: 'sans-serif', accent: '#374151', fontSize: 10 },
}

export const resumeSections = { summary: 'Profile', experience: 'Experience', projects: 'Projects', education: 'Education', skills: 'Skills' }
export const resumeId = () => crypto.randomUUID()
export const isResumeColor = value => /^#[0-9a-f]{6}$/i.test(value || '')
export const newResumeEntry = type => ({ id: resumeId(), ...(type === 'experience' ? { role: '', organization: '', location: '', start: '', end: '', details: '' } : type === 'education' ? { degree: '', institution: '', location: '', start: '', end: '', details: '' } : type === 'projects' ? { name: '', role: '', url: '', details: '' } : { title: '', details: '' }) })

export function emptyResume() {
  return { version: 2, id: resumeId(), template: 'modern', name: '', title: '', email: '', phone: '', location: '', summary: '', skills: '', photo: '', links: [], experience: [], education: [], projects: [], custom: [], sectionOrder: Object.keys(resumeSections), hiddenSections: [], design: { fontFamily: 'template', fontSize: 11, nameSize: 28, headingSize: 12, margin: 42, lineHeight: 1.3, pageSize: 'A4', accent: '#0d7865', bodyColor: '#1f2937', linkColor: '#175cd3', dividerColor: '#94a3b8', sectionDividers: 'below', dividerWidth: .6, photoSize: 64, photoShape: 'circle', photoPosition: 'right' } }
}

export function normalizeResume(value = {}) {
  const base = emptyResume()
  const template = resumeTemplates[value.template] ? value.template : 'modern'
  const result = { ...base, ...value, version: 2, template, design: { ...base.design, fontSize: resumeTemplates[template].fontSize, accent: resumeTemplates[template].accent, ...value.design } }
  for (const type of ['experience', 'education', 'projects', 'custom']) {
    result[type] = Array.isArray(value[type]) ? value[type].map(entry => ({ ...newResumeEntry(type), ...entry })) : typeof value[type] === 'string' && value[type].trim() ? [{ ...newResumeEntry(type), details: value[type] }] : []
  }
  result.links = Array.isArray(value.links) ? value.links.map(link => ({ id: resumeId(), label: '', url: '', ...link })) : []
  const keys = [...Object.keys(resumeSections), ...result.custom.map(section => section.id)]
  result.sectionOrder = [...new Set([...(Array.isArray(value.sectionOrder) ? value.sectionOrder.filter(key => keys.includes(key)) : []), ...keys])]
  result.hiddenSections = Array.isArray(value.hiddenSections) ? value.hiddenSections.filter(key => keys.includes(key)) : []
  return result
}

export function safeResumeUrl(value) {
  const source = String(value || '').trim()
  if (!source || /\s/.test(source) || (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^https?:\/\//i.test(source))) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(source) ? source : `https://${source}`)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

const clamp = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback))
export function resumeDesign(data) {
  const template = resumeTemplates[data.template] || resumeTemplates.modern
  const design = data.design || {}
  return { ...design, fontFamily: ['sans-serif', 'serif', 'monospace'].includes(design.fontFamily) ? design.fontFamily : template.fontFamily,
    fontSize: clamp(design.fontSize, template.fontSize, 8, 16), nameSize: clamp(design.nameSize, 28, 18, 42), headingSize: clamp(design.headingSize, 12, 9, 20),
    margin: clamp(design.margin, 42, 24, 72), lineHeight: clamp(design.lineHeight, 1.3, 1.1, 1.8), photoSize: clamp(design.photoSize, 64, 40, 100),
    pageSize: design.pageSize === 'Letter' ? 'Letter' : 'A4', accent: /^#[0-9a-f]{6}$/i.test(design.accent || '') ? design.accent : template.accent,
    bodyColor: isResumeColor(design.bodyColor) ? design.bodyColor : '#1f2937', linkColor: isResumeColor(design.linkColor) ? design.linkColor : '#175cd3', dividerColor: isResumeColor(design.dividerColor) ? design.dividerColor : '#94a3b8',
    sectionDividers: ['above', 'below', 'none'].includes(design.sectionDividers) ? design.sectionDividers : 'below', dividerWidth: clamp(design.dividerWidth, .6, .3, 2),
  }
}
