---
description: Close out the task worked on in this session, with the commit link
argument-hint: [task name or Notion URL, if not the one in progress]
---

Close out the task worked on in this session: $ARGUMENTS

**The rules are not in this file.** Fetch the SOP first and follow it,
especially which status closing out is allowed to set:
https://app.notion.com/p/3fdf1e3e8ca2811f9b82f43286dc5626

Steps:

1. Identify the task. Default to the one this session moved to in-progress; if
   the argument names another, use that. If nothing is in progress and no
   argument is given, ask.
2. Confirm the work is committed and pushed: `git log --oneline -5` and
   `git status --short`. On a dirty tree, say so and stop. Nothing is closed
   out on uncommitted work.
3. Set the status the SOP allows, and no further.
4. Fill the commit or PR link.
5. Append to the log, short, in this shape:
   - what was done, one or two lines
   - what was **not** done or **not verified**: deploy pending, untested on a
     phone, needs a second device for multiplayer, and so on
   - anything found on the way that is now a separate item
6. If step 5 turned up a separate item, create it in Planning as an idea and
   link it, the same as `/capture` does.
7. Report the task, its new status and the commit, in two lines.

Report faithfully. A failed test or a skipped step goes in the log, not out of
it.
