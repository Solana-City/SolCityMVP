---
description: Read the Notion board and report what is open, by priority and by contributor
---

Report the state of the team board. Read only, write nothing.

**The rules are not in this file.** Fetch the SOP first and follow it:
https://app.notion.com/p/3fdf1e3e8ca2811f9b82f43286dc5626

Addresses (Notion data sources):

- Product `a1698b7d-cb08-48c7-a645-c587362d1bbe`
- Operations `24f053e7-eee1-4ff0-8721-e17d37319c53`
- Planning `4f59ace5-262b-4b7a-8db7-d987af198e47`

Steps:

1. Query the three data sources for rows whose status is not Done.
2. Report, in this order and nothing more:
   - **Doing / Blocked / Review** across all three, with the owner, and for
     anything blocked, what it is waiting on.
   - **P0** open rows, grouped by table.
   - **P1** open rows, grouped by table.
   - **By contributor**: one line per person, their open P0 and P1 count.
   - How many rows still sit in Inbox with no priority or no owner.
3. End with the single thing that most deserves attention right now, and why,
   in one sentence. If the board is empty, say so plainly instead of padding.

Do not change any row, and do not start any work from this command.
