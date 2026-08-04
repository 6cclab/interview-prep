import { describe, expect, it } from 'vitest'
import { assertWithinBudget, countCalls } from './oracle'

describe('countCalls', () => {
  it('passes arguments through and returns the underlying result', () => {
    const counted = countCalls((a: number, b: number) => a + b)
    expect(counted.fn(2, 3)).toBe(5)
  })

  it('starts at zero calls', () => {
    const counted = countCalls(() => null)
    expect(counted.calls).toBe(0)
  })

  it('counts every invocation', () => {
    const counted = countCalls((x: number) => x)
    counted.fn(1)
    counted.fn(2)
    counted.fn(3)
    expect(counted.calls).toBe(3)
  })

  it('counts invocations that throw', () => {
    const counted = countCalls(() => {
      throw new Error('boom')
    })
    expect(() => counted.fn()).toThrow('boom')
    expect(counted.calls).toBe(1)
  })
})

describe('assertWithinBudget', () => {
  it('does nothing when under budget', () => {
    expect(() => assertWithinBudget(5, 10, 'knows()')).not.toThrow()
  })

  it('does nothing when exactly at budget', () => {
    expect(() => assertWithinBudget(10, 10, 'knows()')).not.toThrow()
  })

  it('throws when over budget', () => {
    expect(() => assertWithinBudget(11, 10, 'knows()')).toThrow()
  })

  it('reports the label, the count, and the budget', () => {
    expect(() => assertWithinBudget(250_000, 1500, 'knows()')).toThrow(
      /knows\(\).*250000.*1500/s,
    )
  })

  it('tells the reader a brute-force answer is not enough', () => {
    expect(() => assertWithinBudget(11, 10, 'knows()')).toThrow(/brute force/i)
  })
})
