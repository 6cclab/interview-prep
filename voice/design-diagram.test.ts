import { describe, expect, it } from 'vitest'
import { diagramCue, parseDiagram, serializeDiagram, type DesignDiagram } from './design-diagram'

const SIMPLE: DesignDiagram = {
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

describe('serializeDiagram', () => {
  it('names every component with its kind, so the interviewer knows what it is', () => {
    const text = serializeDiagram(SIMPLE)
    expect(text).toContain('Mobile app (client)')
    expect(text).toContain('Postgres (relational-db)')
  })

  it('states the connections by label, not by id', () => {
    // Ids are an implementation detail of the canvas. An interviewer told
    // "c -> lb" cannot ask about it in words the candidate would recognise.
    const text = serializeDiagram(SIMPLE)
    expect(text).toContain('Mobile app -> LB')
    expect(text).not.toContain('c -> lb')
  })

  it('keeps an edge label, which is usually the interesting part', () => {
    expect(serializeDiagram(SIMPLE)).toContain('LB -> Postgres (reads)')
  })

  it('says a component is unconnected rather than omitting it', () => {
    // A box dragged out and never wired up is a real state, and often the
    // thing worth asking about. Dropping it would hide the question.
    const text = serializeDiagram({
      nodes: [{ id: 'q', type: 'queue', label: 'Orders' }],
      edges: [],
    })
    expect(text).toContain('Orders (queue)')
    expect(text.toLowerCase()).toContain('nothing connected')
  })
})

describe('diagramCue', () => {
  // Mirrors `coach.ts`'s codeCue: an aside the model is told and never speaks,
  // in the slot where everything else is the candidate talking.
  it('frames the diagram as an aside, never as something he said', () => {
    const cue = diagramCue(SIMPLE)
    expect(cue).toContain('[For you only, not spoken:')
    expect(cue).toContain('Mobile app (client)')
  })

  it('states an empty canvas explicitly rather than sending nothing', () => {
    // codeCue's reasoning, for the same failure: a model that silently
    // receives nothing starts describing a design that is not on the screen.
    const cue = diagramCue({ nodes: [], edges: [] })
    expect(cue).toContain('[For you only, not spoken:')
    expect(cue.toLowerCase()).toContain('has not drawn anything')
  })

  it('says so when there is no diagram at all', () => {
    expect(diagramCue(null).toLowerCase()).toContain('do not guess')
  })
})

describe('parseDiagram', () => {
  it('accepts a well-formed diagram', () => {
    expect(parseDiagram(JSON.parse(JSON.stringify(SIMPLE)))).toEqual(SIMPLE)
  })

  // The diagram arrives from the browser and is interpolated into the
  // interviewer's prompt, so an unchecked shape is prompt content nobody wrote.
  it.each([null, 'a string', 42, {}, { nodes: 'no' }, { nodes: [], edges: 'no' }])(
    'refuses something that is not a diagram: %s',
    (bad) => {
      expect(parseDiagram(bad)).toBeNull()
    },
  )

  it('refuses a node without a usable label', () => {
    expect(parseDiagram({ nodes: [{ id: 'a', type: 'client' }], edges: [] })).toBeNull()
  })

  it('refuses an edge pointing at a node that does not exist', () => {
    expect(
      parseDiagram({
        nodes: [{ id: 'a', type: 'client', label: 'App' }],
        edges: [{ from: 'a', to: 'ghost' }],
      }),
    ).toBeNull()
  })

  // A canvas is cheap to fill and the cue is re-sent every turn, so an
  // unbounded diagram is an unbounded prompt on every single turn.
  it('refuses a diagram far larger than any real design', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, type: 'service', label: `S${i}` }))
    expect(parseDiagram({ nodes, edges: [] })).toBeNull()
  })
})
