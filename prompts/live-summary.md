---
name: live-summary
description: Summarise a real interview from a one-sided transcript — what was asked, where he stalled, what he narrated, what he is now on the hook for
---

# Summarising a real round

You are reading a transcript of a real interview that {{candidate}} sat. It was
captured this hour, not remembered tomorrow.

## The one fact that governs everything below

**You are reading one microphone: his.** The interviewer is not in this
transcript. Every question you can see is one he repeated, answered, or reacted
to — you are reconstructing one side of a conversation from the other.

That is a real limit and it is not a reason to hedge every sentence. It is a
reason to be exact about which of the two you are doing:

- **heard** — the words are in the transcript. He said "so you want the median
  of two sorted arrays" and that is a question you can quote.
- **inferred** — the words are not in the transcript and you are reconstructing
  the question from his answer. He said "yeah, so I'd shard on user id" and no
  question appears; the question is inferred.

Label every question one or the other. An inferred question presented as heard
turns a guess into a record, and this file is the record.

## What to write

Four parts, in this order, each a short section. Prose, not a table.

### Questions asked

Every question you can identify, flagged `heard` or `inferred`. Quote the heard
ones. For the inferred ones, say what he said that the question was reconstructed
from, so the reconstruction can be checked rather than trusted.

### Where he stalled

Long silences are marked `_(silence)_` in the transcript and each line is
stamped with where it began. A stall is not just silence: it is also circling,
restating the problem back three times, or narrating the same approach twice
without advancing it. Say what he was working on when it happened.

### Narrated versus only did

The distinction the whole practice regime is built on. Did he say the complexity
out loud, or only write code that has one? Did he name the trade-off, or make it
silently? An interviewer grades what they heard. Report what was said, not what
you infer he must have been thinking — you cannot see the code he wrote, only
the words he said about it.

### What he is now on the hook for

Anything he committed to that will be checked: a complexity he claimed, a
follow-up he said he would send, a number he asserted, a "I'd probably use X
here" that he will be asked to defend in the next round. Be specific and short.
These are the lines to re-read before the next conversation with this company.

## Open questions

End with a section headed exactly `## Open questions`.

List what you could not determine from one side of the conversation. This is a
required section, not a courtesy — a summary without it reads as a complete
account of a round when it is half of one. Concretely: questions you suspect were
asked but cannot see, whether a hint was given before he changed approach,
whether an interruption was a correction or a clarification, whether a silence
was thinking or the other person talking.

If you genuinely could not determine anything beyond the obvious, say that
plainly in one line. Do not pad it.

## How to write it

- No preamble. Start with the first section heading.
- Do not open with a verdict you walk back. Decide, then write one line.
- Do not score the round or predict the outcome. You have one side of it.
- Quote sparingly and exactly. A misquote in a record is worse than a gap.
- Transcription errors are expected — this is whisper on a live call. Where a
  word is obviously mangled, read through it rather than quoting the garble, and
  do not build a finding on a single unclear word.
