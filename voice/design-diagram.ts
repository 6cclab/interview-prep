/**
 * The system design track's diagram, and how the interviewer is told about it.
 *
 * The track was voice-only: the interviewer could not see anything the
 * candidate would have drawn on a whiteboard, so it could ask about the design
 * described out loud and nothing else. A diagram closes that, through the
 * mechanism this repo already uses twice — `coach.ts`'s `codeCue` and the
 * coding track's test verdict — an aside in the turn slot, told and never
 * spoken.
 *
 * Free of `node:*` so the client can share the types and the serializer.
 */

/** The palette. Fixed, because an interviewer can only ask about what it can name. */
export type NodeType =
  | 'client'
  | 'load-balancer'
  | 'service'
  | 'queue'
  | 'cache'
  | 'relational-db'
  | 'document-db'
  | 'blob-store'
  | 'cdn'

export interface DiagramNode {
  id: string
  type: NodeType
  label: string
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface DesignDiagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

const NODE_TYPES = new Set<string>([
  'client',
  'load-balancer',
  'service',
  'queue',
  'cache',
  'relational-db',
  'document-db',
  'blob-store',
  'cdn',
])

/**
 * A ceiling, not a guess at how big a design gets.
 *
 * The cue is re-sent every turn, so an unbounded diagram is an unbounded prompt
 * on every turn of a 45-minute interview. No real answer to these exercises has
 * sixty components; something with three hundred is a stuck key.
 */
const MAX_NODES = 60
const MAX_EDGES = 200

/**
 * A `DesignDiagram` from the browser, or null.
 *
 * Validated because this is interpolated into the interviewer's prompt: an
 * unchecked shape is prompt content nobody wrote, arriving from the client.
 */
export function parseDiagram(value: unknown): DesignDiagram | null {
  if (typeof value !== 'object' || value === null) return null
  const { nodes, edges } = value as Record<string, unknown>
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) return null

  const parsedNodes: DiagramNode[] = []
  for (const raw of nodes) {
    if (typeof raw !== 'object' || raw === null) return null
    const { id, type, label } = raw as Record<string, unknown>
    if (typeof id !== 'string' || id === '') return null
    if (typeof type !== 'string' || !NODE_TYPES.has(type)) return null
    // A node the interviewer cannot name is a node it cannot ask about, which
    // is worse than one that was never drawn.
    if (typeof label !== 'string' || label.trim() === '') return null
    parsedNodes.push({ id, type: type as NodeType, label })
  }

  const ids = new Set(parsedNodes.map((n) => n.id))
  const parsedEdges: DiagramEdge[] = []
  for (const raw of edges) {
    if (typeof raw !== 'object' || raw === null) return null
    const { from, to, label } = raw as Record<string, unknown>
    // A dangling edge would serialize to an arrow pointing at nothing, and the
    // interviewer would ask about a component that is not on the screen.
    if (typeof from !== 'string' || !ids.has(from)) return null
    if (typeof to !== 'string' || !ids.has(to)) return null
    if (label !== undefined && typeof label !== 'string') return null
    parsedEdges.push(label === undefined ? { from, to } : { from, to, label })
  }

  return { nodes: parsedNodes, edges: parsedEdges }
}

/**
 * The diagram as text the interviewer can reason about.
 *
 * By label rather than by id: ids belong to the canvas, and an interviewer told
 * "n3 -> n7" cannot ask about it in words the candidate would recognise.
 */
export function serializeDiagram(diagram: DesignDiagram): string {
  const label = (id: string): string => diagram.nodes.find((n) => n.id === id)?.label ?? id

  const components = diagram.nodes.map((n) => `- ${n.label} (${n.type})`)
  const connections = diagram.edges.map(
    (e) => `- ${label(e.from)} -> ${label(e.to)}${e.label === undefined ? '' : ` (${e.label})`}`,
  )

  return [
    'Components:',
    ...components,
    'Connections:',
    // Stated rather than left as an empty heading: a set of boxes with nothing
    // joining them is a real state of the canvas, and usually the thing worth
    // asking about next.
    ...(connections.length > 0 ? connections : ['- none yet; nothing connected to anything']),
  ].join('\n')
}

/**
 * The diagram as a cue, framed exactly the way `coach.ts` frames the working
 * file: told to the interviewer, never spoken, and never mistaken for
 * something the candidate said.
 *
 * The empty and missing cases are stated rather than omitted, for the reason
 * `codeCue` gives about the same failure — a model that silently receives
 * nothing starts describing a design that is not on the screen.
 */
export function diagramCue(diagram: DesignDiagram | null): string {
  if (diagram === null) {
    return (
      '[For you only, not spoken: his diagram could not be read. Do not guess at what he ' +
      'has drawn and do not describe components you have not seen — ask him to talk you ' +
      'through it.]'
    )
  }
  if (diagram.nodes.length === 0) {
    return (
      '[For you only, not spoken: his canvas is empty — he has not drawn anything yet. ' +
      'Do not describe a design he has not put there.]'
    )
  }
  return [
    '[For you only, not spoken: this is the diagram on his canvas as it stands right now.',
    'It is the current state, not a message from him — do not read it aloud and do not',
    'list it back at him. Use it to ask better questions about what he has actually',
    'drawn.',
    '',
    serializeDiagram(diagram),
    ']',
  ].join('\n')
}
