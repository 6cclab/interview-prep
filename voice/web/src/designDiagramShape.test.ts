import { describe, expect, it } from 'vitest'
import { defaultLabel, fromDiagram, toDiagram, type CanvasEdge, type CanvasNode } from './designDiagramShape'
import type { DesignDiagram } from '../../design-diagram'

// The only thing worth unit-testing in this file: the shape conversion. The
// canvas component itself is a thin wrapper around React Flow and is not
// exercised here — see DesignCanvas.tsx's own comment on why.

function node(id: string, nodeType: CanvasNode['data']['nodeType'], label: string): CanvasNode {
  return { id, type: 'default', position: { x: 0, y: 0 }, data: { nodeType, label } }
}

function edge(id: string, source: string, target: string, label?: string): CanvasEdge {
  return label === undefined ? { id, source, target } : { id, source, target, label }
}

describe('toDiagram', () => {
  it('carries id, type and label straight through for a well-formed node', () => {
    const diagram = toDiagram([node('a', 'client', 'Mobile app')], [])
    expect(diagram.nodes).toEqual([{ id: 'a', type: 'client', label: 'Mobile app' }])
  })

  // parseDiagram refuses a node whose label is empty or all whitespace — see
  // design-diagram.ts. The palette gives every new node a default label, but a
  // candidate can still clear the text field down to nothing, so the converter
  // has to make the same call parseDiagram would rather than hand it a diagram
  // guaranteed to come back null.
  it('falls back to the type default when a label has been cleared to empty', () => {
    const diagram = toDiagram([node('a', 'cache', '')], [])
    expect(diagram.nodes).toEqual([{ id: 'a', type: 'cache', label: defaultLabel('cache') }])
  })

  it('falls back to the type default when a label is whitespace only', () => {
    const diagram = toDiagram([node('a', 'queue', '   ')], [])
    expect(diagram.nodes).toEqual([{ id: 'a', type: 'queue', label: defaultLabel('queue') }])
  })

  it('keeps an edge label, trimmed', () => {
    const diagram = toDiagram(
      [node('a', 'service', 'API'), node('b', 'cache', 'Redis')],
      [edge('e1', 'a', 'b', 'reads')],
    )
    expect(diagram.edges).toEqual([{ from: 'a', to: 'b', label: 'reads' }])
  })

  it('omits an edge label rather than sending an empty string', () => {
    const diagram = toDiagram([node('a', 'service', 'API'), node('b', 'cache', 'Redis')], [edge('e1', 'a', 'b', '  ')])
    expect(diagram.edges).toEqual([{ from: 'a', to: 'b' }])
    expect(diagram.edges[0]).not.toHaveProperty('label')
  })

  // React Flow deletes an edge's own record when you delete one of its
  // endpoints, but nothing guarantees this function is only ever called with
  // state that went through that path — it is the boundary the rest of the
  // app trusts to keep a dangling edge out of what reaches parseDiagram.
  // parseDiagram would refuse the whole diagram over one stale edge, which is
  // worse than dropping the one edge that no longer points anywhere.
  it('drops an edge whose endpoint node no longer exists', () => {
    const diagram = toDiagram([node('a', 'service', 'API')], [edge('e1', 'a', 'ghost')])
    expect(diagram.edges).toEqual([])
  })

  it('drops an edge whose source node no longer exists', () => {
    const diagram = toDiagram([node('b', 'cache', 'Redis')], [edge('e1', 'ghost', 'b')])
    expect(diagram.edges).toEqual([])
  })
})

describe('fromDiagram', () => {
  it('gives every node a position, since the contract carries none', () => {
    const { nodes } = fromDiagram({ nodes: [{ id: 'a', type: 'client', label: 'App' }], edges: [] })
    expect(nodes[0]?.position).toEqual({ x: expect.any(Number), y: expect.any(Number) })
  })

  it('carries the type and label into node data', () => {
    const { nodes } = fromDiagram({ nodes: [{ id: 'a', type: 'cdn', label: 'Edge cache' }], edges: [] })
    expect(nodes[0]?.data).toEqual({ nodeType: 'cdn', label: 'Edge cache' })
  })

  it('rebuilds an edge from -> to, with its label', () => {
    const { edges } = fromDiagram({
      nodes: [
        { id: 'a', type: 'client', label: 'App' },
        { id: 'b', type: 'service', label: 'API' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'calls' }],
    })
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'a', target: 'b', label: 'calls' })
  })
})

describe('round trip', () => {
  const DIAGRAM: DesignDiagram = {
    nodes: [
      { id: 'c', type: 'client', label: 'Mobile app' },
      { id: 'lb', type: 'load-balancer', label: 'LB' },
      { id: 'db', type: 'relational-db', label: 'Postgres' },
    ],
    edges: [
      { from: 'c', to: 'lb' },
      { from: 'lb', to: 'db', label: 'reads' },
    ],
  }

  // Positions are not part of the contract, so the round trip that matters is
  // diagram -> canvas -> diagram, not the canvas shape surviving unchanged —
  // fromDiagram is free to lay nodes out however it likes.
  it('survives a trip through the canvas shape and back unchanged', () => {
    const { nodes, edges } = fromDiagram(DIAGRAM)
    expect(toDiagram(nodes, edges)).toEqual(DIAGRAM)
  })

  it('survives an empty diagram', () => {
    const empty: DesignDiagram = { nodes: [], edges: [] }
    const { nodes, edges } = fromDiagram(empty)
    expect(toDiagram(nodes, edges)).toEqual(empty)
  })
})
