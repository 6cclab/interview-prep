# Word Dictionary — Worked Solution

## The insight

Words that share a prefix should share the work of storing that prefix. If
`"bad"`, `"dad"`, and `"mad"` are all stored independently (in an array, a
hash set, whatever), then every search has to re-derive "does anything match
this?" from scratch against every stored word.

Instead, build a **trie** (prefix tree): each node represents "we've matched
some prefix so far," and it has up to 26 children, one per possible next
letter. Adding a word walks/creates a chain of nodes, one per character.
Searching an exact string does the same walk, one character at a time — no
scanning of unrelated words required, because words that don't share your
query's prefix were never on your path to begin with.

The `.` wildcard is the one wrinkle: an ordinary character narrows the search
to exactly one child (a single step), but `.` can't narrow anything — it has
to try *every* existing child at that position and recurse into each,
succeeding if any of them eventually leads to a match. So the search is a
depth-first walk that forks at every `.` and takes a single deterministic
step everywhere else.

## Reference implementation

```ts
class TrieNode {
  children: (TrieNode | undefined)[] = new Array(26)
  isWord = false
}

export class WordDictionary {
  private root: TrieNode = new TrieNode()

  addWord(word: string): void {
    let cur = this.root
    for (let i = 0; i < word.length; i++) {
      const idx = word.charCodeAt(i) - 97
      let next = cur.children[idx]
      if (!next) {
        next = new TrieNode()
        cur.children[idx] = next
      }
      cur = next
    }
    cur.isWord = true
  }

  search(word: string): boolean {
    return this.matchFrom(this.root, word, 0)
  }

  private matchFrom(node: TrieNode, word: string, pos: number): boolean {
    if (pos === word.length) return node.isWord

    const ch = word[pos]
    if (ch === '.') {
      for (const child of node.children) {
        if (child && this.matchFrom(child, word, pos + 1)) return true
      }
      return false
    }

    const idx = ch.charCodeAt(0) - 97
    const child = node.children[idx]
    if (!child) return false
    return this.matchFrom(child, word, pos + 1)
  }
}
```

`children` is a fixed-size array of 26 slots rather than a `Map` — the
alphabet is bounded and small, so direct index arithmetic (`charCode - 97`)
beats hashing. A `Map<string, TrieNode>` is a perfectly reasonable
alternative and is arguably more idiomatic if the alphabet weren't fixed or
were much larger.

## Complexity

Let `L` be the query length and `N` be the number of stored words.

- **Exact query (no dots):** `O(L)`. Each character deterministically selects
  at most one child; there's no branching, so the walk is a single path down
  the tree, independent of how many words are stored.
- **Query with `k` dots:** worst case is exponential in `k` — up to `26^k`
  paths could need exploring, bounded above by the number of *distinct*
  nodes actually present in the tree at that depth (which is itself bounded
  by `N`, since the tree can't have more nodes than the total characters
  ever inserted). So a tighter bound is `O(min(26^k, N) * (L - k))`.
- **All-dots query (`k = L`):** this is the worst case, discussed below.

Either way, cost scales with the *query's* shape and the tree's actual
branching — never with a full linear scan of every stored word — which is
why this beats any approach that re-examines every stored word per query.

## Why a terminal marker is required

Consider inserting `"bad"` and then `"badger"`. After both inserts, the node
reached by walking `b -> a -> d` has children (the path continues on to
`g -> e -> r`), so "does this node have children?" is *not* a valid stand-in
for "is this node's prefix itself a complete word?" Both statements can be
true at once. `"bad"`'s node needs its own `isWord = true` flag, set exactly
when a word ends there, regardless of whether longer words also pass through
it. Without that flag, `search("bad")` couldn't be told apart from
`search("bad")` as *just* a prefix of `"badger"` — both walks land on the
same node.

## The worst case: all dots

A query of all dots (e.g., `"....."`) forces the search to fork at every
single position, because a dot never narrows anything. In the theoretical
worst case this can mean visiting a number of nodes proportional to the
entire tree — there's no way around exploring broadly when the query gives
you zero information to prune with. This is inherent to the problem, not an
artifact of this implementation: any correct approach has to be prepared to
examine every word of the matching length when the query is maximally
ambiguous. It's why the scale test in this drill deliberately keeps all-dots
queries rare — they're the one case where "the fast approach" and "scan
everything" converge in cost, so a fixture dominated by them wouldn't
actually distinguish the two.

## Sibling / related problems

- Implement Trie (Prefix Tree) — the undecorated version of this data
  structure: `insert`, `search` (exact only), `startsWith`.
- Longest Word in Dictionary — build a trie, then walk it looking for the
  longest chain where every prefix along the way is itself a complete word.
- Replace Words — use a trie of "roots" to find the shortest root that
  prefixes each word in a sentence.
- Design Add and Search Words Data Structure — this is that problem; LeetCode
  211.
- Word Search II — trie + backtracking over a grid, to find multiple target
  words simultaneously instead of one query at a time.

## The tell

The giveaway is the combination of two things: (1) you're asked to support
*repeated* insertions followed by *repeated* queries against the same
growing collection (not a single one-shot computation), and (2) the query
has a wildcard that matches "any character, but exactly one" — never "any
number of characters." That second detail matters: a wildcard that could
also mean "skip any number of characters" would point toward a different
technique (more like general string matching / regex evaluation). "Exactly
one arbitrary character" is what makes per-character branching the natural
fit, because the tree's depth still corresponds exactly to the query's
length.

## Interview notes

**What to say out loud:** name the repeated-insert/repeated-query shape
first, then the exactly-one-wildcard detail, and connect that to "each
character should be a decision point, and stored words that share a prefix
should share that decision point." That's the setup for a trie without
needing to say the word early — useful for talking through the *reasoning*
rather than pattern-matching to a memorized structure.

**Common mistakes:**
- Forgetting the terminal marker, or conflating "no children" with "not a
  word" (see above) — breaks on prefix/superstring pairs like `bad`/`badger`.
- Off-by-one on when to check `isWord` — it must be checked when
  `pos === word.length`, not one step earlier or later, or exact-length
  queries silently accept/reject the wrong thing.
- Not handling a `.` at the very first or very last character specially —
  it doesn't need special-casing if the recursion is written generally, but
  it's a common spot to introduce an index bug.
- Treating `search` as "does this prefix exist" instead of "does this exact
  string, dots included, match a complete word" — a prefix hit is not a
  match.

**Follow-ups an interviewer might ask:**
- "What if `.` could also match zero-or-more characters?" — this changes the
  problem into something closer to wildcard/regex matching and usually needs
  a different recursive structure (or DP) since a single wildcard's outcome
  now depends on how much it consumes.
- "How would you support removing a word?" — need to unset `isWord` and
  potentially prune now-dead branches (nodes with no children and
  `isWord === false`) back up the tree.
- "What if the alphabet were much larger (e.g. full Unicode)?" — a
  fixed-size 26-array stops being a good fit; switch the `children` field to
  a `Map`.
- "Can you bound the memory usage?" — total nodes is bounded by the sum of
  all inserted words' lengths, since nodes are only created for prefixes not
  already present.
