---
description: Close out the task in progress: Status Review, Log, and the commit link
argument-hint: [task name or Notion URL, if not the one in progress]
---

Close out the task worked on in this session: $ARGUMENTS

Steps:

1. Identify the task. Default to the one set to `Doing` in this session; if the
   argument names another, use that. If nothing is in progress and no argument is
   given, ask.
2. Confirm the work is actually committed and pushed. Run `git log --oneline -5`
   and take the commit hash. If there are uncommitted changes, say so and stop:
   nothing is closed out on a dirty tree.
3. Set `Status` → `Review`. **Never** `Done`: the owner closes tasks.
4. Fill `Shipped in` with the commit or PR URL.
5. Write `Log`, in this shape and kept short:
   - what was done, in one or two lines
   - what was **not** done or **not verified** (deploy pending, untested on a
     phone, needs a second device for multiplayer, and so on)
   - anything found on the way that is now a separate item
6. If step 5 turned up a separate item, create it in **Planning** with `Stage` =
   `Idea` and link it, the same as `/capture` does.
7. Report the task name, its new status and the commit, in two lines.

Report faithfully. If a test failed or a step was skipped, that belongs in `Log`,
not left out of it.
