import type { Track } from './context'

/**
 * Vocabulary hints for whisper.cpp's `--prompt`, per track.
 *
 * whisper was already running the best local model available
 * (`ggml-large-v3-turbo`), so the model was not the lever — `--prompt` was, and
 * it was unused. It biases the decoder toward a vocabulary without rewriting
 * anything, costs nothing and adds no latency. That matters: an LLM cleanup pass
 * would also strip the filler and false starts that `speech.ts` keeps on purpose,
 * because `/mock` grades them.
 *
 * **Complexity notation is the whole point, and it is measured rather than
 * assumed.** A real drill transcript recorded "O of n" as "on" twice and "N" as
 * "M" — and the interviewer then marked him down for "reciting a shape" on the
 * basis of an M he may never have said. That is the drill scoring a transcription
 * bug, which is the one thing it must not do.
 *
 * **The coding vocabulary names no data structures, deliberately.** A coding
 * problem's pattern is its answer, and whisper is known to hallucinate prompt
 * content into output on short or silent audio — so a term list containing
 * "monotonic stack" could plant the answer in his own transcript. Since the
 * measured failure was complexity notation and not data-structure names, the
 * narrow list is also the effective one. `vocabulary.test.ts` enforces this
 * against the real `problems/` directory names, so adding a pattern cannot
 * silently make a term unsafe.
 *
 * The design track has no such constraint — its spoiler is `reference.md`, not a
 * vocabulary — so it gets the domain terms it actually needs.
 */

/**
 * Complexity notation, spelled how it is spoken.
 *
 * Written as the phrase rather than the symbol (`O of n`, not `O(n)`) because the
 * prompt biases *speech* decoding, and "oh of en" is what reaches the microphone.
 */
const COMPLEXITY = [
  'O of one',
  'O of n',
  'O of n squared',
  'O of n log n',
  'O of log n',
  'constant time',
  'linear time',
  'logarithmic',
  'quadratic',
  'amortised',
  'time complexity',
  'space complexity',
]

/** Terms any spoken interview here will use, none of which name a pattern. */
const SHARED = [
  'brute force',
  'edge case',
  'invariant',
  'index',
  'array',
  'iterate',
  'allocate',
  'in place',
  'null',
  'undefined',
  'TypeScript',
]

/** Design-track domain vocabulary. No pattern constraint applies here. */
const DESIGN = [
  'sharding',
  'partition key',
  'quorum',
  'replication lag',
  'write-ahead log',
  'idempotent',
  'backpressure',
  'throughput',
  'tail latency',
  'p99',
  'cache invalidation',
  'consistent hashing',
  'eventual consistency',
  'rate limiter',
  'fan-out',
]

/**
 * Terms offered to the decoder for `track`, in order.
 *
 * Exported for the guard test, which asserts the coding list against the real
 * pattern directories rather than against a copy of them.
 */
export function vocabularyFor(track: Track): string[] {
  if (track === 'design') return [...COMPLEXITY, ...SHARED, ...DESIGN]
  // `mock` is behavioural and needs none of the technical vocabulary, but
  // complexity terms cost nothing there and he does reach for them when
  // describing past work.
  return [...COMPLEXITY, ...SHARED]
}

/**
 * The `--prompt` value for `track`.
 *
 * A comma-separated run of terms rather than a sentence. whisper's initial prompt
 * is treated as preceding context, so a list biases the vocabulary without
 * suggesting a grammar for the decoder to continue — and if it does leak into the
 * output, a run of comma-separated jargon is visibly wrong rather than a
 * plausible thing he might have said.
 */
export function transcriptionPrompt(track: Track): string {
  return `${vocabularyFor(track).join(', ')}.`
}
