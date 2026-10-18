---
description: Capture an idea into Notion Planning without losing the current thread
argument-hint: <the idea, in one line>
---

Capture this idea: $ARGUMENTS

Steps:

1. Create a row in the **Planning** table with `Stage` = `Idea`.
2. Fill it minimally and honestly:
   - `Name`: the idea as a short, concrete phrase, not a slogan
   - `Purpose`: one line on why it matters, and one on why now (or "no urgency")
   - `Priority`: `P3` unless the user said otherwise
   - `Source`: `Claude` if this came out of work in progress, `Team` if the user
     said it
3. If the idea came from something concrete in the code, name the file and line
   in the page body so it can be found again.
4. Reply in one line: created, with the link.

Do not expand the idea into a design, do not propose an implementation, and do
not start it. This command parks a thought so the current work can continue.
If the idea is already in Planning, say so and link the existing row instead of
creating a duplicate.
