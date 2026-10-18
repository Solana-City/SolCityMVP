---
description: Record in a Notion task what changed in the repo, with the link
argument-hint: <task name or Notion URL>
---

Record the repo work in this task: $ARGUMENTS

For work that did not start from `/task`: a fix made in passing, a change the
user asked for directly, a deploy. It carries the repo into Notion, which is the
only direction that is automatic in this project (see `CLAUDE.md`).

Steps:

1. Find the row across the three task tables. If no task fits the work, say so
   and offer to create one, or to `/capture` it instead. Do not force a reference
   into an unrelated task.
2. Look at what actually changed: `git log --oneline -10` and, when useful,
   `git show --stat <hash>`.
3. Append to `Log` (do not overwrite what is there): the date, one line on what
   changed, and what is still unverified.
4. Fill `Shipped in` with the commit or PR URL if it is empty. If it already has
   one, add the new link in `Log` instead.
5. Leave `Status` alone unless the user asks for it. Recording a reference is not
   the same as finishing a task.
6. Reply in one line: which task, which commit.

If the change is a doc in this repo's root, also update that doc's row in the
**Docs** table: refresh `Summary` if the purpose changed, set `Last synced` to
today and `Status` to `Current`.
