import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type EdgeProps,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
// React Flow's own stylesheet. Imported here, not from `styles.css`, so a
// screen that never mounts this component never pays for it and can never be
// affected by it — see the handoff's note on why this file owns it alone.
import '@xyflow/react/dist/style.css'
import { Button } from 'brutalkit/button'
import type { DesignDiagram, NodeType } from '../../../design-diagram'
import {
  NODE_TYPES,
  defaultLabel,
  fromDiagram,
  toDiagram,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
} from '../designDiagramShape'

/** `CanvasNodeData` plus the per-node callbacks stitched in for rendering —
 *  see `renderedNodes` below for why they cannot live in `CanvasNodeData`
 *  itself (that is the shape the pure conversion module and its tests know
 *  about, and it has no business knowing about React callbacks). */
type RenderedNode = Node<CanvasNodeData & { onLabelChange(label: string): void; onDelete(): void }, 'component'>
/** Same reasoning, for edges. */
type RenderedEdge = Edge<{ onLabelChange(label: string): void }, 'labeled'>

/**
 * The system design track's whiteboard.
 *
 * Before this, `#/design/<problem>` was voice-only: the interviewer could
 * reason about whatever the candidate said out loud and nothing else. This is
 * the other half of a real whiteboard interview — a surface to draw the
 * design on — wired to the interviewer through `DesignDiagram`
 * (`voice/design-diagram.ts`), which is the one shape both sides agree on.
 *
 * This component owns only the drawing. It has no idea how the diagram
 * reaches the interviewer — that is `onChange`'s job, called on every
 * settled change to nodes or edges — and no idea what a `DesignDiagram`
 * means once it leaves here. Converting between React Flow's own state and
 * that contract is `../designDiagramShape.ts`'s job, tested on its own
 * because it is the only part of this file with logic worth a unit test; the
 * rest is React Flow rendering its own state.
 */

interface Props {
  /** Called with the current diagram after every settled change — a drag, an
   *  edit, a delete, a new connection. Not on every intermediate frame of a
   *  drag: see the debounce below for why. */
  onChange(diagram: DesignDiagram): void
  /** The diagram to open the canvas with — a reload, or resuming a session
   *  whose canvas already had something on it. Omitted for a blank canvas. */
  initialDiagram?: DesignDiagram
}

/**
 * The one node renderer every node on this canvas uses, regardless of its
 * `nodeType` — see `designDiagramShape.ts`'s `fromDiagram` comment on why
 * that is a data field and not a React Flow node type. Two handles a side
 * (top/left as targets, right/bottom as sources) rather than one of each, so
 * a design that branches or loops back does not have to fight the canvas to
 * draw it.
 */
function ComponentNode({ data, selected }: NodeProps<RenderedNode>) {
  return (
    <div className={`design-canvas__node${selected ? ' design-canvas__node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Top} id="target-top" />
      <span className="design-canvas__node-kind">{data.nodeType}</span>
      <input
        className="design-canvas__node-label"
        value={data.label}
        placeholder={defaultLabel(data.nodeType)}
        // Without this, React Flow's own pointer handling on the node wrapper
        // sees the same pointerdown and starts a drag before the input gets
        // to claim focus — a click into the field moves the box instead of
        // placing the cursor. Stopping propagation here is React Flow's own
        // documented escape hatch for exactly this (the `nodrag` class does
        // the same thing via CSS; this does it directly since the class
        // would have to be threaded onto a plain `<input>` anyway).
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => data.onLabelChange(e.target.value)}
      />
      {/* A visible delete, not just Backspace: a candidate mid-interview is
          unlikely to know a canvas has a keyboard shortcut, and the palette
          gives no other way to remove a node once it is placed. */}
      <button type="button" className="design-canvas__node-delete" aria-label="Delete component" onClick={data.onDelete}>
        ×
      </button>
      <Handle type="source" position={Position.Right} id="source-right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
    </div>
  )
}

/**
 * The one edge renderer this canvas uses. A plain labelled edge would show
 * the label as static text; this one is an `<input>` sitting on the path,
 * because an edge is exactly as likely to need a name ("reads", "async") as
 * a node is, and there is no separate side panel here to edit it from.
 */
function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
}: EdgeProps<RenderedEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <input
          className="design-canvas__edge-label"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          value={typeof label === 'string' ? label : ''}
          placeholder="label"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => data?.onLabelChange(e.target.value)}
        />
      </EdgeLabelRenderer>
    </>
  )
}

// Cast at the boundary: React Flow's own `NodeTypes`/`EdgeTypes` maps are
// typed generically (any registered node/edge shape), so the specific props
// `ComponentNode`/`LabeledEdge` expect have to be widened here once, rather
// than losing the specific types inside the components themselves.
const nodeTypes: NodeTypes = { component: ComponentNode as NodeTypes[string] }
const edgeTypes: EdgeTypes = { labeled: LabeledEdge as unknown as EdgeTypes[string] }

/** How far apart two palette-dropped nodes land, so ten quick clicks do not
 *  pile up into one unreadable stack. Wraps rather than growing forever —
 *  `MAX_NODES` (design-diagram.ts) caps a real diagram at 60, well inside a
 *  grid this size. */
const PALETTE_GRID_COLUMNS = 5
const PALETTE_SPACING = 200

/** `onChange`'s debounce. A drag fires dozens of node-position updates a
 *  second; the interviewer only cares about the diagram settling, not the
 *  path a box took to get there, and pushing every intermediate frame would
 *  turn one drag into dozens of PUTs. */
const CHANGE_DEBOUNCE_MS = 300

export function DesignCanvas({ onChange, initialDiagram }: Props) {
  const initial = useMemo(() => fromDiagram(initialDiagram ?? { nodes: [], edges: [] }), [initialDiagram])
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initial.edges.map((e) => ({ ...e, type: 'labeled' })))

  // One counter for the whole session rather than `nodes.length` — a session
  // that adds and deletes nodes must still hand out ids that were never used,
  // or a rebuilt node can collide with an edge that still names the old one.
  const nextId = useRef(0)
  const placedCount = useRef(0)

  const addComponent = useCallback(
    (type: NodeType) => {
      const id = `n${nextId.current++}`
      const index = placedCount.current++
      const position = {
        x: (index % PALETTE_GRID_COLUMNS) * PALETTE_SPACING,
        y: Math.floor(index / PALETTE_GRID_COLUMNS) * PALETTE_SPACING,
      }
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: 'component',
          position,
          data: { nodeType: type, label: defaultLabel(type) },
        },
      ])
    },
    [setNodes],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: `e${nextId.current++}`, type: 'labeled' }, eds))
    },
    [setEdges],
  )

  const setNodeLabel = useCallback(
    (id: string, label: string) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)))
    },
    [setNodes],
  )

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id))
      // React Flow's own Backspace handling cascades this; a click on the ×
      // does not go through that path, so it is done explicitly here.
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    },
    [setNodes, setEdges],
  )

  const setEdgeLabel = useCallback(
    (id: string, label: string) => {
      setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, label } : e)))
    },
    [setEdges],
  )

  // The callbacks every node/edge needs are stitched into their data here,
  // once per render, rather than read from a ref inside `ComponentNode` —
  // `nodeTypes`/`edgeTypes` above must stay the same object identity across
  // renders (React Flow remounts every node's DOM otherwise), which rules out
  // building the renderer itself from `setNodes`/`setEdges` closures.
  const renderedNodes: RenderedNode[] = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        type: 'component',
        data: { ...n.data, onLabelChange: (label: string) => setNodeLabel(n.id, label), onDelete: () => deleteNode(n.id) },
      })),
    [nodes, setNodeLabel, deleteNode],
  )
  const renderedEdges: RenderedEdge[] = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: 'labeled',
        data: { onLabelChange: (label: string) => setEdgeLabel(e.id, label) },
      })),
    [edges, setEdgeLabel],
  )

  // Pushed out debounced, and from the *plain* nodes/edges state rather than
  // the `rendered*` copies above — those carry closures in `data`, which is
  // not something `toDiagram` reads and not something worth re-triggering
  // this effect over.
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (changeTimer.current !== null) clearTimeout(changeTimer.current)
    changeTimer.current = setTimeout(() => onChange(toDiagram(nodes, edges)), CHANGE_DEBOUNCE_MS)
    return () => {
      if (changeTimer.current !== null) clearTimeout(changeTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onChange` is
    // expected to be a fresh function per render (see App.tsx); depending on
    // it would defeat the debounce by re-arming the timer on every render.
  }, [nodes, edges])

  return (
    <div className="design-canvas">
      <div className="design-canvas__palette" role="toolbar" aria-label="Add a component">
        {NODE_TYPES.map((type) => (
          <Button key={type} variant="outline" size="sm" onClick={() => addComponent(type)}>
            + {defaultLabel(type)}
          </Button>
        ))}
      </div>
      <div className="design-canvas__surface">
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          deleteKeyCode={['Backspace', 'Delete']}
          // Fixed origin scaled to fit rather than remembered pan/zoom — a
          // candidate reopening this after scrolling the transcript should
          // find the whole diagram, not wherever the viewport last was.
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
