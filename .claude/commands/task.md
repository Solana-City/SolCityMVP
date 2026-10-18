---
description: Open a Notion task, restate it, mark it Doing and plan the work
argument-hint: <task name or Notion URL>
---

Start work on this task: $ARGUMENTS

**The rules are not in this file.** Fetch the SOP first and follow it,
including the closed value lists and what must never be done:
https://app.notion.com/p/3fdf1e3e8ca2811f9b82f43286dc5626

Addresses (Notion data sources):

- Product `a1698b7d-cb08-48c7-a645-c587362d1bbe`
- Operations `24f053e7-eee1-4ff0-8721-e17d37319c53`
- Planning `4f59ace5-262b-4b7a-8db7-d987af198e47`

Steps:

1. Find the row. If the argument is a Notion URL, fetch it. Otherwise search
   the three data sources by name. If two rows match, ask which one.
2. Read the **full page**, not just the properties: the requirement is usually
   in the body. Follow its `Doc` relation and open the matching `.md` in this
   repo if one is linked.
3. **Restate the task** in two or three sentences: what done looks like, and
   what is out of scope. If two readings of it lead to different work, ask
   before step 4.
4. Move it to the in-progress status named in the SOP.
5. Propose the plan for the code change before writing any code, naming the
   files involved. Wait for a go-ahead if it is more than a handful of lines.

The row existing is not permission to work on it. This command runs because a
person asked for it.
