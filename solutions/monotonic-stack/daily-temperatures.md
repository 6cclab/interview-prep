# Daily Temperatures — worked answer

**Spoilers.** Solve the drill first: `problems/monotonic-stack/daily-temperatures/`.

## The observation

Day `i`'s answer isn't determined by day `i` in isolation — it's determined
by the *first later day that beats it*. A forward scan re-derives that from
scratch for every day, throwing away everything it learned scanning from
`i-1`.

Instead, walk left to right once and keep a stack of day indices whose
answer is still unresolved, ordered so the temperature at the top of the
stack is always the coldest of the pending days (a "monotonic" stack,
decreasing bottom to top). When a new day arrives:

- While it's warmer than the day on top of the stack, that top day's
  question is finally answered — pop it and record `today - poppedDay`.
- Keep popping until the stack is empty or the top is no longer beaten.
- Push today onto the stack; its own answer is still unknown.

Anything left on the stack when the input ends never got a warmer day, so
those default answers (`0`) are correct as initialized.

## Reference solution

```ts
export function dailyTemperatures(temperatures: number[]): number[] {
  const n = temperatures.length
  const result = new Array<number>(n).fill(0)
  const pending: number[] = []
  for (let i = 0; i < n; i++) {
    while (pending.length > 0 && temperatures[i]! > temperatures[pending[pending.length - 1]!]!) {
      const j = pending.pop()!
      result[j] = i - j
    }
    pending.push(i)
  }
  return result
}
```

## Complexity

O(n) time, O(n) space.

The amortised argument: the outer loop runs n times, and the inner `while`
loop looks like it could be O(n) per iteration — but every index is pushed
onto `pending` exactly once (in the outer loop) and popped at most once (in
the inner loop). Across the whole run, total pushes = n and total pops <=
n, so total work across *all* inner-loop iterations is bounded by 2n, not
n^2. Any single day's inner loop can pop many days at once (e.g. every
prior day if today is the hottest so far), but that cost is paid for by
those days never being touched again — it's charged to their one-time pop,
not to today's iteration.

## Why equal temperatures must not pop

The pop condition is strict: `temperatures[i] > temperatures[top]`, not
`>=`. A tie is not "warmer," so a day equal to the pending day above it must
not resolve it — both stay unresolved, still waiting for something strictly
hotter. Using `>=` would wrongly report a same-temperature day as the
answer, which the all-equal test fixture (`[50,50,50,50] -> [0,0,0,0]`)
exists specifically to catch.

## Sibling problems sharing the pattern

- **Next Greater Element I/II** — same next-greater-to-the-right shape,
  sometimes over a circular array (walk the array twice, mod the index).
- **Largest Rectangle in Histogram** — the stack holds bar indices in
  increasing height order; popping computes a rectangle's width from the
  gap between the new stack top and the bar that triggered the pop.
- **Trapping Rain Water** (stack variant) — pops resolve a trapped layer
  bounded by the two walls on either side of the popped index.
- **Remove K Digits / Next Greater Node in Linked List** — same
  keep-a-decreasing-stack, pop-when-beaten shape applied to a different
  domain.

## The tell

"Next greater/smaller element," "for each element, how far until X," or a
histogram/span problem where each answer depends on the nearest
qualifying neighbor in one direction. Whenever a brute force would rescan
from every position and repeatedly rediscover work a stack could have
remembered, that's the tell.

## Interview notes

- State the invariant out loud before coding: the stack holds indices whose
  answer isn't resolved yet, kept in decreasing temperature order from
  bottom to top. That invariant is what makes the popping condition
  obviously correct instead of something to pattern-match from memory.
- Push indices, not temperatures — you need `i - poppedIndex` to compute the
  wait, and you need the index to write into `result`.
- Say the amortised argument explicitly if asked about complexity; "it looks
  like O(n^2) because of the nested loop" is the natural objection and
  you want to head it off rather than let the interviewer wonder if you
  noticed.
- Don't reach for a stack reflexively — if the problem only ever needs the
  running maximum so far (not the nearest qualifying neighbor), a single
  pass with a running variable is simpler and a stack is overkill.
