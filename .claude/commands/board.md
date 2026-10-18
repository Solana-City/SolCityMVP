---
description: Read the Notion board and report what is open, by priority and by contributor
---

Read the three task tables in the Solana City HQ Notion space (**Product**,
**Planning**, **Operations**) and report the state of the board. Read only, write
nothing.

Steps:

1. Find the three tables with the Notion connector's `search`, then query each.
   Their names and the closed value lists are in `CLAUDE.md`.
2. Report, in this order and nothing more:
   - **Doing / Blocked** across all three tables, with the owner and, for
     anything `Blocked`, what it is waiting on.
   - **P0** open items (`Status` is not `Done`), grouped by table.
   - **P1** open items, grouped by table.
   - **By contributor**: one line per person with their open P0 and P1 count.
   - **Inbox**: how many items still have no priority or no owner.
3. End with the single thing that most deserves attention right now, and why, in
   one sentence. If the board is empty, say so plainly instead of padding.

Do not change any task, and do not start any work from this command. It reports.
