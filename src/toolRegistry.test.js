import { describe, expect, it } from 'vitest'
import { IMPLEMENTED_TOOLS } from './App'
import { TOOLS } from './data/tools'

describe('tool registry', () => {
  it('contains exactly 59 unique tools and routes', () => {
    expect(TOOLS).toHaveLength(59)
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(59)
    expect(new Set(TOOLS.map((tool) => tool.route)).size).toBe(59)
  })

  it('maps every registered tool to a routed component', () => {
    expect(TOOLS.filter((tool) => !IMPLEMENTED_TOOLS[tool.id])).toEqual([])
    expect(Object.keys(IMPLEMENTED_TOOLS)).toHaveLength(59)
  })
})
