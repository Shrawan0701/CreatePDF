import { describe, expect, it } from 'vitest'
import { emptyResume, normalizeResume, resumeDesign, safeResumeUrl } from './resumeModel'

describe('resume data compatibility', () => {
  it('keeps old saved text, identity and template when upgrading to structured entries', () => {
    const resume = normalizeResume({ id: 'saved-1', name: 'Alex Engineer', template: 'classic', experience: 'Role one\nRole two', education: 'University\nDegree', projects: 'A project', skills: 'Java, SQL' })
    expect(resume.id).toBe('saved-1')
    expect(resume.experience[0].details).toBe('Role one\nRole two')
    expect(resume.education[0].details).toBe('University\nDegree')
    expect(resume.projects[0].details).toBe('A project')
    expect(resume.skills).toBe('Java, SQL')
    expect(resumeDesign(resume).fontFamily).toBe('serif')
  })
  it('preserves structured entries, photos, links and section order after save/load', () => {
    const value = { ...emptyResume(), photo: 'data:image/png;base64,test', links: [{ id: 'link', label: 'Portfolio', url: 'example.com' }], custom: [{ id: 'certs', title: 'Certifications', details: 'Certificate' }], sectionOrder: ['skills', 'certs', 'summary', 'skills', 'removed'], hiddenSections: ['summary', 'removed'], design: { fontFamily: 'serif', nameSize: 31 } }
    const resume = normalizeResume(value)
    expect(resume.photo).toBe(value.photo)
    expect(resume.links).toEqual(value.links)
    expect(resume.sectionOrder.slice(0, 3)).toEqual(['skills', 'certs', 'summary'])
    expect(resume.sectionOrder).not.toContain('removed')
    expect(resume.hiddenSections).toEqual(['summary'])
    expect(resumeDesign(resume).nameSize).toBe(31)
  })
  it('constrains layout values and rejects unsupported template/font values', () => {
    const resume = normalizeResume({ template: 'missing', design: { fontSize: 900, margin: -30, lineHeight: 0, accent: 'invalid', fontFamily: 'invalid' } })
    expect(resume.template).toBe('modern')
    expect(resumeDesign(resume)).toMatchObject({ fontSize: 16, margin: 24, lineHeight: 1.3, accent: '#0d7865', fontFamily: 'sans-serif' })
  })
  it('keeps valid colors and divider choices, and provides safe defaults for old or invalid values', () => {
    const saved = normalizeResume({ design: { bodyColor: '#334455', linkColor: '#2563eb', dividerColor: '#99aabb', sectionDividers: 'above', dividerWidth: 1.2 } })
    expect(resumeDesign(saved)).toMatchObject({ bodyColor: '#334455', linkColor: '#2563eb', dividerColor: '#99aabb', sectionDividers: 'above', dividerWidth: 1.2 })
    const invalid = resumeDesign({ design: { bodyColor: 'red; background:url(test)', linkColor: 'invalid', dividerColor: 'invalid', sectionDividers: 'invalid', dividerWidth: 100 } })
    expect(invalid).toMatchObject({ bodyColor: '#1f2937', linkColor: '#175cd3', dividerColor: '#94a3b8', sectionDividers: 'below', dividerWidth: 2 })
  })
})

describe('resume links', () => {
  it('accepts public web links with or without a scheme', () => {
    expect(safeResumeUrl('github.com/alex/project')).toBe('https://github.com/alex/project')
    expect(safeResumeUrl(' https://example.com/path?q=1 ')).toBe('https://example.com/path?q=1')
  })
  it('does not turn unsafe schemes, credentials or whitespace into active links', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'https://user:pass@example.com', 'bad link', '']) expect(safeResumeUrl(value)).toBe('')
  })
})
