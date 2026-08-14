import type { Edge, Node } from '@xyflow/react'
import type { DesignDiagram, DiagramEdge, DiagramNode, NodeType } from '../../design-diagram'

/**
 * The bridge between React Flow's own node/edge shape and the contract this
 * track was built on — `voice/design-diagram.ts`'s `DesignDiagram`.
 *
 * Kept in its own pure module, apart from `DesignCanvas.tsx`, because this is
 * the only part of the canvas with logic worth a unit test: everything else
 * is React Flow rendering its own state, which no test in this repo would be
 * exercising anything but the library itself.
 */

/** What every canvas node carries, beyond React Flow's own id/position. */
export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: NodeType
  label: string
}

export type CanvasNode = Node<CanvasNodeData>
export type CanvasEdge = Edge<Record<string, unknown>>

/**
 * The label a freshly dropped node gets, and the one a cleared label falls
 * back to. Every entry names what the box is for, not "New node" — a design
 * interview is about the components, and a canvas full of "New node 1..7"
 * would be less useful to the interviewer than the type name alone.
 */
const DEFAULT_LABEL: Record<NodeType, string> = {
  client: 'Client',
  'load-balancer': 'Load balancer',
  service: 'Service',
  queue: 'Queue',
  cache: 'Cache',
  'relational-db': 'Relational DB',
  'document-db': 'Document DB',
  'blob-store': 'Blob store',
  cdn: 'CDN',
}

export function defaultLabel(type: NodeType): string {
  return DEFAULT_LABEL[type]
}

/** Every node type, in palette order. Derived from `DEFAULT_LABEL` so the palette and the type union cannot drift apart. */
export const NODE_TYPES = Object.keys(DEFAULT_LABEL) as NodeType[]

/**
 * React Flow's state -> the contract's `DesignDiagram`.
 *
 * Two defensive calls here, both because `parseDiagram` (design-diagram.ts)
 * would refuse the *entire* diagram over a single bad node or edge, which is
 * a worse outcome than this function quietly making the one bad piece valid
 * or dropping it:
 *
 * - A label editable down to empty text is refused by `parseDiagram` outright
 *   — falling back to the type's default label keeps every node nameable,
 *   which is the same reason the palette gives new nodes a default to begin
 *   with (see `defaultLabel`).
 * - An edge pointing at a node id that is no longer in `nodes` (stale state,
 *   not something the UI should ever produce on its own, but the boundary
 *   this function is) is dropped rather than passed through — `parseDiagram`
 *   would otherwise fail the whole canvas over one dangling arrow.
 */
export function toDiagram(nodes: CanvasNode[], edges: CanvasEdge[]): DesignDiagram {
  const diagramNodes: DiagramNode[] = nodes.map((n) => ({
    id: n.id,
    type: n.data.nodeType,
    label: n.data.label.trim() === '' ? defaultLabel(n.data.nodeType) : n.data.label,
  }))

  const ids = new Set(diagramNodes.map((n) => n.id))
  const diagramEdges: DiagramEdge[] = []
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    const label = typeof e.label === 'string' && e.label.trim() !== '' ? e.label : undefined
    diagramEdges.push(label === undefined ? { from: e.source, to: e.target } : { from: e.source, to: e.target, label })
  }

  return { nodes: diagramNodes, edges: diagramEdges }
}

/** Columns in the grid `fromDiagram` lays a freshly loaded diagram out on. */
const GRID_COLUMNS = 4
const COLUMN_SPACING = 220
const ROW_SPACING = 120

/**
 * `DesignDiagram` -> React Flow's state, for loading a saved diagram back
 * onto the canvas.
 *
 * The contract carries no position — it is server-side state the interviewer
 * reasons about in words, never rendered — so this lays nodes out on a grid
 * rather than trying to recover one. That is why the round trip this module
 * guarantees is diagram -> canvas -> diagram, not canvas -> diagram -> canvas:
 * positions are free to change every time this runs.
 */
export function fromDiagram(diagram: DesignDiagram): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = diagram.nodes.map((n, i) => ({
    id: n.id,
    // 'component': the one custom renderer DesignCanvas.tsx registers — see its
    // `nodeTypes`. Every node on this canvas is drawn the same way regardless
    // of `data.nodeType`, which is what makes the type a data field rather
    // than a React Flow node "type".
    type: 'component',
    position: { x: (i % GRID_COLUMNS) * COLUMN_SPACING, y: Math.floor(i / GRID_COLUMNS) * ROW_SPACING },
    data: { nodeType: n.type, label: n.label },
  }))

  // Indexed rather than `${from}->${to}`: two edges between the same pair
  // (different labels, or drawn twice) are a real, if odd, thing to draw, and
  // an id collision would make React Flow silently drop the second one.
  const edges: CanvasEdge[] = diagram.edges.map((e, i) => ({
    id: `e${i}-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    ...(e.label === undefined ? {} : { label: e.label }),
  }))

  return { nodes, edges }
}
