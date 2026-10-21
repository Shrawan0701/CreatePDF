import { describe, expect, it } from 'vitest'
import { IMPLEMENTED_TOOLS } from './App'
import { TOOLS } from './data/tools'

describe('tool registry', () => {
  it('contains all 65 unique tools and routes', () => {
    expect(TOOLS).toHaveLength(65)
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length)
    expect(new Set(TOOLS.map((tool) => tool.route)).size).toBe(TOOLS.length)
  })

  it('maps every registered tool to a routed component', () => {
    expect(TOOLS.filter((tool) => !IMPLEMENTED_TOOLS[tool.id])).toEqual([])
    expect(Object.keys(IMPLEMENTED_TOOLS)).toHaveLength(TOOLS.length)
  })
})
