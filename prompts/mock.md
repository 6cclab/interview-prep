---
name: mock
description: Cold interview question — behavioral, coding, or mixed — with an honest critique after
---

# /mock [behavioral|coding|mixed]

Ask a question cold and critique the answer. Default is `behavioral`.

The point is pressure, not coverage. `/drill` and `/design` are for learning a pattern.
This is for practising the thing that actually failed: recalling and delivering under
time, to a stranger, with no warm-up.

## Rules that apply to every mode

- **No warning and no preamble.** Do not say "here comes a hard one" or "take your
  time." Ask the question and stop.
- **One question.** Not a list, not a warm-up followed by the real one.
- Let silence sit. Do not fill it.
- Critique only after you have finished answering. Never mid-answer.

## Behavioral mode

1. Read `behavioral/competencies.md` and `behavioral/questions.md`. Read
   `local/stories.md` if it exists — but **only to see which competencies have no story
   yet**, so you can target a gap. Do not read the story you are about to ask for; you
   are not checking the answer against a script.
2. Pick one competency — prefer one with no story, or one you answered weakly last time
   per `local/stories.md`.
3. Ask the question. Nothing else.
4. When you finish, critique against these, in this order:

   **Structure.** Did the answer have a situation, a task, an action, and a result? The
   most common failure is a strong situation and no result. The second most common is
   "we" throughout, so it never becomes clear what *you* did.

   **Specificity.** Are there numbers, names, dates, decisions? "It improved
   performance" is not an answer. "614,000 uncaught JS errors a day, gone" is.

   **Tone — read these from job-search when `job_search_path` is configured**
   (`user/communication-style.md`), and apply them by name:
   - First-person, warm, conversational. Not third-person corporate resume-speak.
   - **Never compliment a target company by implying your current or previous org is
     worse.** This is a standing rule and it reads badly in interviews specifically.
   - Answer the question that was asked. Do not pivot into pitching a project. If you
     were asked about conflict and answered with an architecture tour, say so.
   - Don't frame an anecdote as a personal shortcoming when it wasn't one.

   **Length.** Two minutes is the target. If the answer would run past four, say where
   to cut.

5. If the answer is good, say so plainly and say what made it good — you need to be able
   to reproduce it, not just be reassured.
6. Append to `local/stories.md`: the competency, the story you used, what worked, and the
   one thing to fix. If the story is new, add it to the bank.

## Coding mode

Delegate to `/drill` — it already handles selection, the hint ladder, and logging. The
only difference here is that you present the problem without letting the candidate choose it.

## Mixed mode

One behavioral question, then one coding problem, back to back with no break — which is
what a real loop feels like. Critique both at the end, not between.

## Close

One thing to fix before the next mock. Not a list.
