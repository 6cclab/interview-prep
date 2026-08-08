import { useEffect, useState } from 'react'
import { Button } from 'brutalkit/button'
import type { Drill } from '../types'

/**
 * The Idle-only choice of what to drill.
 *
 * Not in the design handoff, which specifies the behavioural screen only. It
 * lives above the dock and disappears the moment a session starts, so the
 * single-screen layout the handoff does specify is untouched for the whole of a
 * live session — the pane that replaces it (`ProblemPane`) occupies the same
 * slot.
 *
 * Behavioural is the default and needs no selection: a design drill is a
 * deliberate act, not a mode to end up in by accident.
 */

interface Props {
  onStart(drill: Drill): void
  /** Disabled while a session is starting, so a double-press cannot race a 409. */
  busy: boolean
}

export function DrillPicker({ onStart, busy }: Props) {
  const [problems, setProblems] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/problems')
        if (!res.ok) throw new Error(String(res.status))
        const { problems: names } = (await res.json()) as { problems: string[] }
        if (!live) return
        setProblems(names)
        setSelected(names[0] ?? '')
      } catch {
        // A failed list is not a broken app: the behavioural drill needs nothing
        // from this route, so say so and leave that path working.
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="drill-picker" aria-label="Choose a drill">
      <div className="drill-picker__row">
        <label htmlFor="drill-picker-problem">System design problem</label>
        <select
          id="drill-picker-problem"
          value={selected}
          disabled={problems.length === 0}
          onChange={(event) => setSelected(event.target.value)}
        >
          {problems.length === 0 && <option value="">{failed ? 'Unavailable' : 'None found'}</option>}
          {problems.map((problem) => (
            <option key={problem} value={problem}>
              {problem}
            </option>
          ))}
        </select>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || selected === ''}
        onClick={() => onStart({ track: 'design', problem: selected })}
      >
        Start timed design drill
      </Button>
      <p className="drill-picker__hint">
        Forty-five minutes, spoken. The prompt stays on screen; the interviewer keeps the clock and scores you against
        the rubric at time. The main button below starts a behavioral drill instead.
      </p>
    </section>
  )
}
