import { describe, expect, it } from 'vitest'
import { buildStream, liveIndex, type StreamEvent } from './stream'
import type { Entry } from './types'

const speech = (at: number, speaker: Entry['speaker'], text: string): Entry => ({ at, speaker, text })

describe('buildStream', () => {
  it('is empty for a round that has produced nothing', () => {
    expect(buildStream([], [])).toEqual([])
  })

  it('reads in the order things happened, whatever order they were collected in', () => {
    const entries = [speech(0, 'interviewer', 'first'), speech(9_000, 'andre', 'third')]
    const events: StreamEvent[] = [{ kind: 'hint', at: 4_000, rung: 1 }]
    expect(buildStream(entries, events).map((e) => e.at)).toEqual([0, 4_000, 9_000])
  })

  it('keeps both voices — the candidate\'s own words are half the record', () => {
    const entries = [speech(0, 'interviewer', 'q'), speech(1_000, 'andre', 'a')]
    expect(buildStream(entries, []).map((e) => e.kind === 'speech' && e.speaker)).toEqual([
      'interviewer',
      'andre',
    ])
  })

  it('carries the whole verdict, not a summary of it', () => {
    const events: StreamEvent[] = [
      { kind: 'verdict', at: 500, verdict: { kind: 'cost-red', failed: ['maxArea — scale > big'] } },
    ]
    const [entry] = buildStream([], events)
    expect(entry).toEqual({
      kind: 'verdict',
      at: 500,
      verdict: { kind: 'cost-red', failed: ['maxArea — scale > big'] },
    })
  })

  it('keeps the two verdict taxonomies apart', () => {
    const events: StreamEvent[] = [
      { kind: 'debug-verdict', at: 10, verdict: { kind: 'symptom-patch', failed: ['invariant'] } },
      { kind: 'verdict', at: 20, verdict: { kind: 'green' } },
    ]
    expect(buildStream([], events).map((e) => e.kind)).toEqual(['debug-verdict', 'verdict'])
  })

  // The tiebreak that matters. A test run and the interviewer's reaction to it
  // can land in the same millisecond; flipping their order on a re-render would
  // make the record disagree with itself between two paints of the same round.
  it('is stable when a turn and an event share a timestamp, and puts the turn first', () => {
    const entries = [speech(3_000, 'interviewer', 'what did that tell you?')]
    const events: StreamEvent[] = [{ kind: 'verdict', at: 3_000, verdict: { kind: 'green' } }]
    const once = buildStream(entries, events).map((e) => e.kind)
    const twice = buildStream(entries, events).map((e) => e.kind)
    expect(once).toEqual(['speech', 'verdict'])
    expect(twice).toEqual(once)
  })

  it('records when a rung was taken, which a counter cannot answer', () => {
    const events: StreamEvent[] = [
      { kind: 'hint', at: 400_000, rung: 1 },
      { kind: 'hint', at: 1_200_000, rung: 2 },
    ]
    expect(buildStream([], events)).toEqual([
      { kind: 'hint', at: 400_000, rung: 1 },
      { kind: 'hint', at: 1_200_000, rung: 2 },
    ])
  })

  it('appends rather than inserting — a longer round is the same round plus more', () => {
    const entries = [speech(0, 'interviewer', 'q')]
    const before = buildStream(entries, [])
    const after = buildStream([...entries, speech(1_000, 'andre', 'a')], [])
    expect(after.slice(0, before.length)).toEqual(before)
  })
})

describe('liveIndex', () => {
  it('is the most recent interviewer turn', () => {
    const stream = buildStream(
      [speech(0, 'interviewer', 'one'), speech(1_000, 'andre', 'two'), speech(2_000, 'interviewer', 'three')],
      []
    )
    expect(liveIndex(stream)).toBe(2)
  })

  // A verdict is a measurement that already happened. Giving it the loudest
  // treatment on screen would brighten the one thing the candidate least needs
  // to re-read, and push the question they are answering into the muted wall.
  it('is not a verdict, even when the verdict is last', () => {
    const stream = buildStream([speech(0, 'interviewer', 'q')], [
      { kind: 'verdict', at: 5_000, verdict: { kind: 'green' } },
    ])
    expect(stream[stream.length - 1]!.kind).toBe('verdict')
    expect(liveIndex(stream)).toBe(0)
  })

  it('is not the candidate — the live line is the question being answered', () => {
    const stream = buildStream(
      [speech(0, 'interviewer', 'q'), speech(1_000, 'andre', 'still thinking')],
      []
    )
    expect(liveIndex(stream)).toBe(0)
  })

  it('is -1 before the interviewer has said anything', () => {
    expect(liveIndex([])).toBe(-1)
    expect(liveIndex(buildStream([speech(0, 'andre', 'hello?')], []))).toBe(-1)
  })
})
