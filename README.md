# Swadlincote Lasers — Committee Portal

A private, committee-only governance app for Swadlincote Lasers Basketball Club.
Vanilla JavaScript PWA, no build step, backed by Supabase (database, auth,
storage, and a server-side Edge Function). Deliberately separate from the
club's coaching app — different repo, different Netlify site, different
Supabase project, different login.

**Live:** https://swadlaserscommittee.netlify.app

---

## What it does

### Dashboard
Open and overdue actions, a safe compliance-alert count, open risks, the next
scheduled meeting, and anything in the Club Year due within 60 days.

### Club Year
A planner pre-seeded with the recurring milestones of a season — Basketball
England affiliation and insurance renewal, league registration, the AGM, an
annual access review, grant windows. Each milestone carries a prep checklist
that can be pushed straight into Actions with a sensible due date.

### Meetings
Create a meeting and its agenda arrives pre-loaded with the club's standing
items. Minutes are typed inline per item. Actions and decisions logged during
the meeting link to it automatically. A formatted set of minutes can be
copied straight into an email once the meeting's done.

### Registers — Actions, Decisions & Risks
- **Actions** — owner, due date, meeting reference; overdue items flag automatically.
- **Decisions** — a permanent log. Once logged, only an admin can edit or void
  one — never deleted, only marked void with a reason.
- **Risks** — likelihood × impact scoring, colour-banded.

### Compliance Tracker
Club-level affiliation/insurance dates, plus per-person DBS, safeguarding,
first aid and coaching licence dates, and policy review dates.
**Named detail is visible only to the Safeguarding Lead and Chair** — every
other committee member sees an aggregate count only (expired / expiring soon
/ up to date / not set), never who or their specific dates.

### Incident Log
Injuries, near-misses and safeguarding concerns. Anyone can log a new entry;
editing or voiding an existing one is admin/Safeguarding-Lead only.
Safeguarding-type entries are visible only to the Safeguarding Lead and Chair.

### Membership
Teams, player counts, subs paid vs expected.

### Finance — Budget & Grants
Income/expenditure by category with over-budget flags, and a grant pipeline.
Everyone can view; only the **Treasurer** and admins can edit.

### Key Contacts, Role Handover, Season Review
Venue/league/BE contacts; a "what my replacement needs to know" page per
role (editable only by that role's holder, or admin); a structured end-of-season
review (open to contribute, admin-only to finalise).

### Documents
A searchable library with real file upload to Supabase Storage, organised by
category (Governance, Policies, Meetings & minutes, Finance, Safeguarding,
Events & tournaments, Templates & forms, Other).

### Committee Members (admin only)
Invite, edit, and deactivate committee accounts. **Inviting someone sends a
real email immediately** via a server-side Edge Function — no manual step.

### Recent Activity
A permanent, append-only audit trail — every add/edit/void stamped with who
and when.

---

## Access model

Open by default; restricted only where it protects something that matters.

| Area | All committee members | Restricted to | Admin only |
|---|---|---|---|
| Actions, Risks, Milestones, Meetings (while current), Membership, Contacts, Handover (others'), Docs | Full view & edit | — | — |
| Decisions | View & add | — | Editing/voiding once logged |
| Meetings (past) | View | — | Editing after the date has passed |
| Compliance (DBS etc.) | Sees counts only | Named detail — Safeguarding Lead & Chair | — |
| Incidents | Can log a new one | Safeguarding detail — Safeguarding Lead & Chair | Editing/voiding any entry |
| Finance (budget & grants) | View only | Editing — Treasurer | Editing (also allowed) |
| Handover (own role) | — | Editing own role's notes | Editing any |
| Season Review | View & start | — | Editing/finalising |
| Documents | View, add, upload | — | Deleting |
| Committee Members | View list | — | Invite / edit / deactivate |

Enforced by PostgreSQL row-level security on every table — not just hidden in
the UI. A member with the right permissions sees full detail; everyone else's
queries simply never return the restricted rows.

## Governance principles

- **Void, not delete.** Decisions and incidents can only be marked void, with
  a reason recorded — the club's history is never erased.
- **Records lock.** Once a meeting's date has passed, or a decision is
  logged, only an admin can still amend it.
- **Accountability over restriction.** Most data stays open to the whole
  committee; the audit trail (who changed what, when) provides the
  accountability rather than locking everything down.
- **Continuity.** An annual "access & accounts review" milestone (seeded into
  the Club Year, timed just after the AGM) prompts removing anyone who's left
  the committee and confirming at least two people still hold admin access.
- **Personal logins only.** Magic-link email sign-in, no passwords, no shared
  accounts.

## Backend

- **Supabase** (project `SwadLasers-Committee`, London region) — Postgres
  database, Auth (magic-link email, custom SMTP via Gmail), Storage
  (`documents` bucket, private).
- **Row-level security** on every table, built around three helper functions
  (`is_committee()`, `is_admin()`, `can_safeguarding()`, `can_finance()`)
  checked against the `members` table for the signed-in user's email.
- **Edge Function `invite-member`** — the only place the privileged
  service-role key is ever used. Independently re-verifies the caller is an
  active admin, then creates/reactivates the member row and triggers
  Supabase's invite email. Never exposed to the client.
- The client uses only the **publishable (anon) key** — safe by design to
  ship in front-end code, since it carries no privilege on its own; all
  protection comes from the RLS policies above.

## Repo contents

```
index.html      — shell, loads styles.css + app.js + the Supabase JS CDN
app.js          — the entire app: auth, data layer, every screen, all logic
styles.css      — design system (brand colours, layout, components)
manifest.json   — PWA manifest (installable, themed, icons)
sw.js           — service worker (offline cache)
netlify.toml    — Netlify config (security headers)
logo.jpg, icon-192.png, icon-512.png — club crest assets
```

The Edge Function itself lives in Supabase, not in this repo.

## Deploy

Push to a **private** GitHub repo, connect as a Netlify site (publish
directory `.`). Every push redeploys automatically.

## Known limitations / roadmap

- **No automated notifications yet.** A meeting-linked digest email (fired a
  few days before each scheduled meeting, summarising anything overdue or
  expiring) is planned but not built. A `notifications_enabled` column
  already exists on `members`, ready for it.
- **MFA is not enforced** for committee sign-in (magic-link email only).
  Reasonable given there are no passwords to phish, but a stricter option if
  ever wanted.
- **Push notifications** were considered and deliberately parked — more
  fragile (especially iOS) for the marginal gain over an email digest, for a
  club this size.
- The **Supabase project owner's own login** (GitHub-authenticated) is the
  single highest-leverage thing to protect, since it can override every rule
  above. Keep 2FA on that GitHub account.
