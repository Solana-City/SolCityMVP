---
description: Open a Notion task, restate it, mark it Doing and plan the work
argument-hint: <task name or Notion URL>
---

Start work on this task: $ARGUMENTS

Steps:

1. Find the row. If the argument is a Notion URL, `fetch` it. Otherwise `search`
   the three task tables (**Product**, **Planning**, **Operations**) by name. If
   two rows match, ask which one instead of guessing.
2. Read the full page, not just the properties: the body often holds the real
   requirement. Follow its `Doc` relation and open the `.md` in this repo if one
   is linked.
3. **Restate the task** in two or three sentences: what done looks like, and what
   is explicitly out of scope. If the task is ambiguous enough that two readings
   lead to different work, ask before step 4.
4. Set `Status` → `Doing`.
5. Propose the plan for the code change before writing any code, naming the files
   involved. Wait for a go-ahead if the change is more than a handful of lines.

Do not set `Done`. Do not invent property values outside the lists in
`CLAUDE.md`.
