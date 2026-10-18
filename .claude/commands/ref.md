---
description: Record in a Notion task what changed in the repo, with the link
argument-hint: <task name or Notion URL>
---

Record the repo work in this task: $ARGUMENTS

For work that did not start from `/task`: a fix made in passing, a change asked
for directly, a deploy. Repo into Notion is the only direction this project
reflects automatically, and the SOP says why:
https://app.notion.com/p/3fdf1e3e8ca2811f9b82f43286dc5626

Addresses (Notion data sources):

- Product `a1698b7d-cb08-48c7-a645-c587362d1bbe`
- Operations `24f053e7-eee1-4ff0-8721-e17d37319c53`
- Docs `73b3892d-7c8b-48b4-bbc5-a6880efe4257`

Steps:

1. Find the row across Product and Operations. If no task fits the work, say so
   and offer to create one, or to `/capture` it instead. Do not force a
   reference into an unrelated task.
2. Look at what actually changed: `git log --oneline -10` and, when useful,
   `git show --stat <hash>`.
3. **Append** to the log, never overwrite: the date, one line on what changed,
   and what is still unverified.
4. Fill the commit or PR link if it is empty; if it already has one, put the
   new link in the log instead.
5. Leave the status alone unless the user asks. Recording a reference is not
   finishing a task.
6. Reply in one line: which task, which commit.

If the change was to a `.md` doc in this repo's root, also refresh that doc's
row in Docs: its summary if the purpose changed, its synced date, and its
status.
