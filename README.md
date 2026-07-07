# Swadlincote Lasers — Committee Portal

Private committee app for Swadlincote Lasers Basketball Club. Vanilla JS,
no build step, installable PWA, deploys straight to Netlify. Deliberately
separate from the coaching app — separate repo, separate Netlify site,
and (next step) its own Supabase project so committee data is isolated.

## Modules

- **Dashboard** — open/overdue actions, compliance alerts, open risks,
  next meeting, club-year milestones due in 60 days
- **Club Year** — pre-seeded 2026–27 milestones (affiliation, league
  registration, AGM, access review…); each pushes prep tasks into Actions
- **Meetings** — standing-item agendas, inline minutes, open-action review,
  quick-log of actions/decisions linked to the meeting, copy-ready minutes
- **Registers** — actions (overdue flagging), decisions, risks (L×I scoring)
- **Compliance & Policies** — club affiliation/insurance, per-person DBS /
  safeguarding / first aid / licence expiry, policy review dates
- **Incident Log** — injuries, safeguarding concerns, near-misses
- **Membership** — teams, players, subs expected vs paid
- **Budget & Grants** — budget lines with over-spend flags, grant pipeline
- **Key Contacts, Role Handover, Season Review**
- **Recent Activity** — audit trail: every change stamped with who and when
- **Export** — one-tap JSON backup of everything

## Governance rules built into the app

- Decisions and incidents are **never deleted** — only marked void, with
  the reason recorded and the entry kept visible
- Safeguarding-type incidents are flagged for restriction (enforced once
  sign-in exists — see access model below)
- Annual **access & accounts review** is a seeded Club Year milestone

## Access model (to be enforced by Supabase)

1. Open by default: all committee members see and edit everything else
2. Safeguarding incident detail: Safeguarding Lead + Chair only
3. Admin (invite/remove members): Chair + Secretary — two people minimum
4. Personal logins only (magic link), no shared passwords

## Deploy

Push this folder to a **private** GitHub repo, connect it to a new Netlify
site (publish directory: `.`). Suggested name: `lasers-committee`.

## Current limitation

Data is localStorage — per-device, no sharing, no real security yet.
**Do not enter real names, DBS dates or safeguarding detail until the
Supabase upgrade is live.** Use the Export button as your interim backup.

## Next: Supabase upgrade

1. Create Supabase project (`lasers-committee`, London region)
2. Tables + row-level security implementing the access model above
3. Magic-link auth restricted to invited committee emails
4. Swap the data layer (`loadState`/`saveState` in app.js) for Supabase calls
5. Migrate any existing data via the Export JSON
