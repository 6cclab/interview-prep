import ts from 'typescript'

/**
 * A test suite with its comments removed, for shipping to a browser.
 *
 * Running the suite client-side means sending `solution.test.ts` over the wire,
 * where anyone can read it in the network tab. `AGENTS.md` already withholds
 * that file from the interviewer, and not out of caution: *"its comments explain
 * fixture construction, and they have leaked an approach once already"* — a
 * recorded incident, not a hypothetical.
 *
 * Locally this is moot, because the candidate has the file on disk anyway. On a
 * deployed instance it is new exposure to people who are not the trusted owner,
 * and it is measurable rather than theoretical: four of the forty-two suites
 * currently name their own pattern directory in a comment, e.g.
 * `solutions/sliding-window/max-sum-window.md`. That is rung 2 of the hint
 * ladder, sitting in plain text.
 *
 * ---
 *
 * **Parsed, not pattern-matched.** A regex over `//` and `/* *\/` cannot tell a
 * comment from the same characters inside a string, a template literal or a
 * regex — and these suites contain all three. The earlier attempt at this
 * rejected a regex as corruption-prone and was right to.
 *
 * The printer is used rather than `transpileModule`, which would also strip the
 * types. Keeping the output TypeScript means the browser runner keeps receiving
 * exactly the kind of source it already receives, so this change cannot
 * interact with how `sucrase` handles it.
 *
 * Formatting changes — the printer reindents and normalises quotes. That is
 * acceptable because nothing displays this text; the only consumer is the
 * worker that executes it. What must not change is what the suite *does*, and
 * `real-suites.test.ts` asserts exactly that against all forty-two.
 */
export function stripSuiteComments(source: string): string {
  const file = ts.createSourceFile(
    // The name reaches nothing — no file is read and none is written — but a
    // `.ts` extension is what tells the parser to parse TypeScript.
    'suite.ts',
    source,
    ts.ScriptTarget.ESNext,
    // `setParentNodes: false`. The printer does not need them and building them
    // costs time on every request that serves an exercise.
    false,
    ts.ScriptKind.TS,
  )
  return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(file)
}
