# Patterns

Read this between sessions, not during them. Recall is keyed on the **tell** —
what about a problem statement should make you reach for a pattern — not on the
problem name.

| Pattern | The tell | The insight | Problem |
|---|---|---|---|
| elimination | An expensive comparison; one result disqualifies somebody for good | Linear pass to a candidate, then a separate verification pass | `celebrity` |
| two-pointers | Sorted input, or a pair/triple summing to a target | Moving the wrong end can only make things worse, so move the other | — |
| fast-slow-pointers | Linked structure, cycles, or "the middle" | Two speeds meet inside a cycle and split a list in one pass | — |
| sliding-window | Contiguous subarray or substring, with a constraint | Grow right, shrink left only while the constraint is violated | — |
| hashmap-counting | Anagrams, frequencies, "seen before" | Trade space for a lookup that removes an inner loop | — |
| prefix-sums | Repeated range sums or subarrays summing to k | Precompute cumulative totals; a range is one subtraction | — |
| in-place-array | "Without extra space", or removing/rotating elements | A write pointer trailing a read pointer | — |
| binary-search-answer | "Minimum capacity/speed such that…", monotone feasibility | Binary search the answer space, not the array | — |
| intervals | Meetings, merges, overlaps, calendars | Sort by start; then only the previous end matters | — |
| monotonic-stack | Next greater/smaller element, spans, histograms | Keep the stack sorted; popping resolves an earlier element's answer | — |
| heap-top-k | Top/bottom k, streaming median, merging sorted inputs | A size-k heap beats a full sort when k is small | — |
| binary-tree-recursion | Depth, path sums, validation, LCA | Define what the call returns for a subtree, then trust recursion | — |
| bfs-dfs-grid | Islands, regions, shortest path in a maze | BFS for fewest steps, DFS for reachability; mark visited on enqueue | — |
| graph-shortest-path | Weighted edges and a minimum cost | Dijkstra when weights are non-negative; plain BFS when they're uniform | — |
| topological-sort | Prerequisites, build order, dependency cycles | Kahn's algorithm; leftover nodes prove a cycle | — |
| union-find | Connectivity, accounts merging, redundant edges | Union by rank plus path compression, near-constant per operation | — |
| trie | Prefix search, autocomplete, word dictionaries | Share prefixes so lookup costs the length of the word, not the corpus | — |
| backtracking | Permutations, combinations, N-queens, sudoku | Choose, recurse, un-choose; prune as early as the constraint allows | — |
| dp-1d | "How many ways", min cost to reach the end, overlapping subproblems | Define the state, then the recurrence, then collapse the table to a row | — |
| string-stack-parsing | Nesting, brackets, decode/evaluate an expression | A stack is the only structure that matches nesting naturally | — |
