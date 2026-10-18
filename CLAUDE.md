# Sol City — working agreements

The Solana City: a multiplayer 2D city where every interaction is a real Solana
transaction. Architecture and stack: `README.md`.

This file holds the agreements the **team** needs to see. It is read by every
Claude Code session opened on this repo.

---

## Team board (Notion)

The team's organisation lives in Notion, not in this repo:

**Solana City HQ** — https://www.notion.so/36ef1e3e8ca280ee9963d27bc5d6f44d

Three task tables. One priority scale. Read and written through the Notion
connector (each person connects their own, in `Settings → Connectors → Notion`).

| Table | What goes in it |
|---|---|
| **Product** | product additions and changes: features, art, UX/UI, bugs, content |
| **Planning** | ideas, purpose, the plan, and the tasks that come out of it |
| **Operations** | everything not product: socials, business, partnerships, hiring, tools, process |

Supporting tables: **SOPs** (how we do things), **Docs** (plain-language
summaries of the `.md` specs in this repo), **Culture**, **Meeting notes**.

### Priority is urgency, not impact

| | Means |
|---|---|
| **P0** | urgent: under 24h, ASAP |
| **P1** | by the end of the week |
| **P2** | not urgent right now |
| **P3** | nice to have, when there is time |

Effort is a rough size: **S** under a day, **M** a few days, **L** more.

### Closed value lists

Never write a value outside these, and never add an option to a select:

- `Status` (Product, Operations): `Inbox`, `Next`, `Doing`, `Blocked`, `Review`, `Done`
- `Priority`: `P0`, `P1`, `P2`, `P3`
- `Effort`: `S`, `M`, `L`
- `Type` (Product): `Feature`, `Art`, `UX/UI`, `Bug`, `Content`, `Infra`
- `Area` (Operations): `Social`, `Business`, `Partnerships`, `Hiring`, `Tools/Subscriptions`, `Finance`, `Process`
- `Stage` (Planning): `Idea`, `Discussing`, `Planned`, `Executing`, `Shipped`, `Dropped`
- `Source`: `Playtest`, `Mentor`, `Team`, `Player`, `Claude`

Creating a new table or property is a decision for the owner, not for a session.

---

## Direction of flow: Notion is organisation, the repo is truth

**Notion never triggers a change in this repo. Repo changes are reflected into
Notion, as reference.**

- A task in Notion is an agreement between humans. A session reads it,
  restates it, and works. Nothing in Notion authorises a commit by itself.
- When something lands in the repo (commit, PR, deploy), the session records the
  reference inside the right task: one line on what changed, plus the link. That
  is what gives accountability without making anyone open git.
- No automation runs on its own. Every sync is on demand, through a command.

## Task lifecycle for a session

1. The user names a task. Find its row in Notion (`/task`), read it, and restate
   the understanding before touching code.
2. Set `Status` → `Doing`.
3. Do the work. One concern per commit, staged file by file, pushed immediately.
4. Set `Status` → `Review`, never `Done`. The owner closes tasks.
5. Write `Log`: what was done, and what was **not** verified. Fill `Shipped in`
   with the commit or PR link.
6. Anything found out of scope goes to **Planning** as `Stage` = `Idea`
   (`/capture`). It does not disappear, and it does not ride along in the commit.

Commands: `/board`, `/task`, `/done`, `/capture`, `/ref`. They live in
`.claude/commands/`.
