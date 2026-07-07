const LOGO = 'assets/logo.jpg';

// ============================================================
// Swadlincote Lasers — Committee Portal (preview build v2)
// Vanilla JS, zero dependencies.
// Adds: Club Year planner, Compliance tracker, Meeting packs,
// Finance view, Season Review.
// ============================================================

const DB_KEY = 'lasers-portal-v2';
let mem = null;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const daysUntil = (iso) => Math.ceil((new Date(iso + 'T00:00') - new Date(today() + 'T00:00')) / 86400000);
const isOverdue = (a) => a.status === 'open' && a.due && a.due < today();
const ROLES = ['Chair', 'Vice Chair', 'Secretary', 'Treasurer', 'Safeguarding Lead', 'Head Coach', 'Committee Member'];

// ---------- Seeds: the club year, pre-loaded ----------
function seedMilestones() {
  const M = (title, date, cat, prep) => ({ id: uid(), title, date, cat, prep, done: false, notes: '' });
  return [
    M('League registration deadline', '2026-08-15', 'Season', ['Confirm which teams are entering', 'Collect team entry fees', 'Submit league registration forms']),
    M('Venue hire confirmed for new season', '2026-08-20', 'Season', ['Confirm training slots with venue', 'Sign venue hire agreement', 'Check venue costs against budget']),
    M('Basketball England affiliation & insurance renewal', '2026-09-01', 'Compliance', ['Check membership numbers for affiliation tier', 'Confirm insurance cover level', 'Submit affiliation renewal', 'Update compliance tracker with new expiry dates']),
    M('Season start', '2026-09-14', 'Season', ['Publish training schedule', 'Collect first subs payments', 'Check all coaches\u2019 DBS are in date', 'Send welcome comms to parents and players']),
    M('Christmas break comms', '2026-12-08', 'Season', ['Confirm last sessions of term', 'Announce restart date to members']),
    M('Grant window: Sport England Small Grants', '2027-01-31', 'Finance', ['Identify what the funding is for', 'Gather quotes', 'Draft the application', 'Committee sign-off on application']),
    M('February half-term camp', '2027-02-15', 'Events', ['Book venue for camp', 'Confirm coaches available', 'Open bookings', 'Complete risk assessment for camp']),
    M('AGM', '2027-05-20', 'Governance', ['Book AGM venue', 'Issue AGM notice to members (check constitution notice period)', 'Collect officer reports', 'Prepare accounts for presentation', 'Call for committee nominations']),
    M('Access & accounts review', '2027-05-27', 'Governance', ['Remove portal access for anyone who left the committee at the AGM', 'Confirm at least two people hold admin access', 'Check handover notes are written for every role', 'Check compliance tracker owners are still correct']),
    M('End-of-season presentation', '2027-06-26', 'Events', ['Book venue', 'Order trophies', 'Confirm award winners with coaches', 'Confirm numbers and tickets']),
    M('Season review meeting', '2027-06-30', 'Governance', ['Complete the season review in this portal', 'Gather coach feedback', 'Draft next season priorities']),
  ];
}
function seedBudget() {
  const B = (name, type) => ({ id: uid(), name, type, budget: 0, actual: 0 });
  return [
    B('Membership subs', 'income'), B('Grants', 'income'), B('Fundraising & events', 'income'),
    B('Venue hire', 'expense'), B('Affiliation & insurance', 'expense'), B('League & referee fees', 'expense'),
    B('Kit & equipment', 'expense'), B('Coach courses & DBS', 'expense'),
  ];
}
function seedClubComp() {
  return { affiliation: '', insurance: '' };
}
function seedPolicies() {
  return ['Constitution', 'Safeguarding Policy', 'Financial Regulations', 'Code of Conduct', 'Complaints & Discipline', 'Committee Handbook']
    .map((name) => ({ id: uid(), name, lastReviewed: '', nextReview: '' }));
}

// ---------- State ----------
function loadState() {
  const base = {
    member: null, actions: [], decisions: [], risks: [],
    milestones: seedMilestones(), people: [], clubComp: seedClubComp(),
    meetings: [], budget: seedBudget(), grants: [], reviews: [],
    incidents: [], policies: seedPolicies(), contacts: [], handover: {}, teams: [], audit: [],
  };
  try {
    const stored = JSON.parse(localStorage.getItem(DB_KEY));
    return stored ? { ...base, ...stored } : base;
  } catch { return mem ? { ...base, ...mem } : base; }
}
const S = Object.assign(loadState(), { page: 'home', filter: 'open', reg: 'actions', modal: null, meetingId: null, prefill: null });

function saveState() {
  mem = {
    member: S.member, actions: S.actions, decisions: S.decisions, risks: S.risks,
    milestones: S.milestones, people: S.people, clubComp: S.clubComp,
    meetings: S.meetings, budget: S.budget, grants: S.grants, reviews: S.reviews,
    incidents: S.incidents, policies: S.policies, contacts: S.contacts, handover: S.handover, teams: S.teams, audit: S.audit,
  };
  try { localStorage.setItem(DB_KEY, JSON.stringify(mem)); } catch {}
}

// Audit trail — every change stamped with who and when.
// Local-only for now; becomes tamper-proof when moved to Firestore.
function log(what) {
  S.audit.unshift({ t: new Date().toISOString(), who: S.member ? S.member.name : '—', what });
  if (S.audit.length > 200) S.audit.length = 200;
}

// ---------- SVG ----------
const star = (cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0l2.2 5.1 5.1-2.4-2.4 5.1L22 10l-5.1 2.2 2.4 5.1-5.1-2.4L12 20l-2.2-5.1-5.1 2.4 2.4-5.1L2 10l5.1-2.2L4.7 2.7l5.1 2.4z"/></svg>`;
const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>`,
  year: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
  meetings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 8h2a2 2 0 0 1 2 2v9l-4-3H9a2 2 0 0 1-2-2v-1"/><path d="M14 3H5a2 2 0 0 0-2 2v9l4-3h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>`,
  registers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>`,
  more: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>`,
  coins: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.4-2.5 1.7-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/></svg>`,
  review: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>`,
  docs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13H7zM14 3v5h5"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2 21h20L12 3zm0 8v4m0 3v.5"/></svg>`,
};

const TAB_OF = { home: 'home', year: 'year', meetings: 'meetings', meeting: 'meetings', registers: 'registers', more: 'more', compliance: 'more', finance: 'more', review: 'more', docs: 'more', incidents: 'more', contacts: 'more', handover: 'more', membership: 'more', activity: 'more' };

// ============================================================
// Page: Dashboard
// ============================================================
function pageHead(eyebrow, title, sub, actionHtml) {
  return `<div class="pagehead"><div>
    <div class="eyebrow">${star('star')} ${eyebrow}</div>
    <h1 class="display">${title}</h1>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </div>${actionHtml || ''}</div>`;
}

function complianceAlerts() {
  let n = 0;
  const check = (d) => { if (!d) return; const u = daysUntil(d); if (u < 60) n++; };
  check(S.clubComp.affiliation); check(S.clubComp.insurance);
  S.people.forEach((p) => ['dbs', 'safeguarding', 'firstAid', 'licence'].forEach((k) => check(p[k])));
  return n;
}

function dashboardPage() {
  const open = S.actions.filter((a) => a.status === 'open');
  const overdue = open.filter(isOverdue);
  const compAlerts = complianceAlerts();
  const openRisks = S.risks.filter((r) => r.status !== 'closed');
  const highRisks = openRisks.filter((r) => r.likelihood * r.impact >= 15);

  const stats = [
    { n: open.length, l: 'Open actions', page: 'registers' },
    { n: overdue.length, l: 'Overdue actions', page: 'registers', alert: overdue.length > 0 },
    { n: compAlerts, l: 'Compliance alerts', page: 'compliance', alert: compAlerts > 0 },
    { n: openRisks.length, l: 'Open risks' + (highRisks.length ? ` (${highRisks.length} high)` : ''), page: 'registers', alert: highRisks.length > 0 },
  ];

  let out = pageHead('Swadlincote Lasers', 'Committee Dashboard',
    new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));

  out += `<div class="statgrid">` + stats.map((s) =>
    `<button class="card stat${s.alert ? ' alert' : ''}" style="text-align:left;border:none" data-go="${s.page}">
      ${star('starmark')}<div class="n display">${s.n}</div><div class="l">${esc(s.l)}</div></button>`).join('') + `</div>`;

  const next = S.meetings.filter((m) => m.date >= today()).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  if (next) {
    out += `<div class="card row" data-open-meeting="${next.id}" style="cursor:pointer;border-left:4px solid var(--gold)">
      <div class="body"><div class="t">Next meeting: ${esc(next.title)}</div>
      <div class="m">${fmtDate(next.date)} · ${daysUntil(next.date)} days away · tap to build the agenda</div></div></div>`;
  }

  const upcoming = S.milestones.filter((m) => !m.done && daysUntil(m.date) >= 0 && daysUntil(m.date) <= 60)
    .sort((a, b) => a.date < b.date ? -1 : 1);
  if (upcoming.length) {
    out += `<h2 class="sectiontitle display">${star('star')} Club year — next 60 days</h2><div class="rowlist">` +
      upcoming.map((m) => `
        <div class="card row" data-modal="milestone:${m.id}" style="cursor:pointer">
          <div class="body"><div class="t">${esc(m.title)}</div>
          <div class="m">${fmtDate(m.date)} · ${esc(m.cat)}</div></div>
          <span class="tag ${daysUntil(m.date) <= 14 ? 'tag-amber' : 'tag-open'}">${daysUntil(m.date)}d</span>
        </div>`).join('') + `</div>`;
  }

  const openInc = S.incidents.filter((i) => i.status !== 'closed' && !i.void);
  const duePol = S.policies.filter((p) => p.nextReview && p.nextReview < today());
  if (overdue.length || openInc.length || duePol.length) {
    out += `<h2 class="sectiontitle display">${star('star')} Needs attention</h2><div class="rowlist">`;
    if (openInc.length) {
      out += `<div class="card row" data-go="incidents" style="cursor:pointer">
        <div class="body"><div class="t">${openInc.length} open incident${openInc.length > 1 ? 's' : ''}</div>
        <div class="m">Review and close at the next meeting</div></div>
        <span class="tag tag-amber">Open</span></div>`;
    }
    duePol.forEach((p) => {
      out += `<div class="card row" data-go="compliance" style="cursor:pointer">
        <div class="body"><div class="t">${esc(p.name)}</div>
        <div class="m">Policy review overdue — was due ${fmtDate(p.nextReview)}</div></div>
        <span class="tag tag-red">Review due</span></div>`;
    });
    out += overdue.slice(0, 5).map((a) => `
        <div class="card row"><div class="body"><div class="t">${esc(a.title)}</div>
        <div class="m">${esc(a.owner || 'Unassigned')} · due ${fmtDate(a.due)}</div></div>
        <span class="tag tag-overdue">Overdue</span></div>`).join('') + `</div>`;
  }
  return out;
}

// ============================================================
// Page: Club Year
// ============================================================
function yearPage() {
  const list = [...S.milestones].sort((a, b) => a.date < b.date ? -1 : 1);
  let out = pageHead('Planner', 'Club Year', 'The recurring milestones of running the club, so nothing sneaks up on the committee.',
    `<button class="btn btn-gold" data-modal="milestone:new">+ Add milestone</button>`);
  if (!list.length) {
    out += `<div class="card empty"><div class="display">No milestones</div>
      <p>Add the key dates in the club's year — affiliation, AGM, season start, events.</p>
      <button class="btn btn-gold" data-modal="milestone:new">Add a milestone</button></div>`;
    return out;
  }
  out += `<div class="rowlist">` + list.map((m) => {
    const d = daysUntil(m.date);
    const past = d < 0;
    const chip = m.done ? `<span class="tag tag-done">Done</span>`
      : past ? `<span class="tag tag-overdue">${-d}d ago</span>`
      : `<span class="tag ${d <= 14 ? 'tag-amber' : 'tag-open'}">${d}d</span>`;
    return `<div class="card row" style="opacity:${m.done ? 0.55 : 1}">
      <button class="checkbtn${m.done ? ' on' : ''}" aria-label="Mark done" data-ms-toggle="${m.id}">✓</button>
      <div class="body" data-modal="milestone:${m.id}" style="cursor:pointer">
        <div class="t">${esc(m.title)}</div>
        <div class="m">${fmtDate(m.date)} · ${esc(m.cat)}${m.prep && m.prep.length ? ` · ${m.prep.length} prep tasks` : ''}</div>
      </div>
      <div class="side">${chip}</div>
    </div>`;
  }).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Meetings
// ============================================================
const STANDING = ['Welcome & apologies', 'Minutes of last meeting', 'Matters arising — action review', 'Treasurer\u2019s report', 'Safeguarding report', 'Membership & teams', 'Fundraising & grants', 'Any other business', 'Date of next meeting'];
const mref = (m) => `${m.title} (${fmtDate(m.date)})`;

function meetingsPage() {
  const list = [...S.meetings].sort((a, b) => a.date < b.date ? 1 : -1);
  let out = pageHead('Meetings', 'Meeting Packs', 'Agendas that pull in open actions, and minutes that write themselves.',
    `<button class="btn btn-gold" data-modal="meeting:new">+ New meeting</button>`);
  if (!list.length) {
    out += `<div class="card empty"><div class="display">No meetings yet</div>
      <p>Create your next committee meeting — the agenda comes pre-loaded with the standing items.</p>
      <button class="btn btn-gold" data-modal="meeting:new">Create a meeting</button></div>`;
    return out;
  }
  out += `<div class="rowlist">` + list.map((m) => `
    <div class="card row" data-open-meeting="${m.id}" style="cursor:pointer">
      <div class="body"><div class="t">${esc(m.title)}</div>
      <div class="m">${fmtDate(m.date)} · ${m.agenda.length} agenda items${m.attendees ? ` · ${esc(m.attendees)}` : ''}</div></div>
      <span class="tag ${m.date >= today() ? 'tag-open' : 'tag-done'}">${m.date >= today() ? 'Upcoming' : 'Held'}</span>
    </div>`).join('') + `</div>`;
  return out;
}

function meetingPage() {
  const m = S.meetings.find((x) => x.id === S.meetingId);
  if (!m) { S.page = 'meetings'; return meetingsPage(); }
  const ref = mref(m);
  const openActions = S.actions.filter((a) => a.status === 'open');

  let out = `<button class="btn btn-ghost btn-sm" data-go="meetings" style="margin-bottom:12px">← All meetings</button>`;
  out += pageHead('Meeting pack', esc(m.title), fmtDate(m.date),
    `<button class="btn btn-gold" data-minutes="${m.id}">Copy minutes</button>`);

  out += `<div class="card" style="margin-bottom:14px">
    <div class="field" style="margin:0"><label>Attendees</label>
    <input data-set="attendees:${m.id}" value="${esc(m.attendees)}" placeholder="Who was there?"></div></div>`;

  out += `<h2 class="sectiontitle display">${star('star')} Agenda & minutes</h2><div class="rowlist">`;
  out += m.agenda.map((item, i) => `
    <div class="card">
      <div class="row" style="margin-bottom:8px">
        <div class="body"><div class="t">${i + 1}. ${esc(item.title)}</div></div>
        <button class="btn btn-danger btn-sm" data-ag-del="${m.id}:${item.id}">✕</button>
      </div>
      <textarea data-set="minutes:${m.id}:${item.id}" placeholder="Minutes / notes for this item…"
        style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;background:#FCFBFE;min-height:56px;resize:vertical">${esc(item.notes)}</textarea>
    </div>`).join('');
  out += `</div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <input id="ag-new" placeholder="Add agenda item…" style="flex:1;min-width:170px;border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;background:#fff">
      <button class="btn btn-ghost" data-ag-add="${m.id}">Add item</button>
    </div>`;

  out += `<h2 class="sectiontitle display">${star('star')} In this meeting</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-gold btn-sm" data-quick-action="${esc(ref)}">+ Log an action</button>
      <button class="btn btn-gold btn-sm" data-quick-decision="${esc(ref)}">+ Log a decision</button>
    </div>`;

  const linkedA = S.actions.filter((a) => a.meeting === ref);
  const linkedD = S.decisions.filter((d) => d.meeting === ref);
  if (linkedA.length || linkedD.length) {
    out += `<div class="rowlist">` +
      linkedA.map((a) => `<div class="card row"><div class="body"><div class="t">${esc(a.title)}</div><div class="m">Action · ${esc(a.owner || 'Unassigned')} · due ${fmtDate(a.due)}</div></div></div>`).join('') +
      linkedD.map((d) => `<div class="card row"><div class="body"><div class="t">${esc(d.title)}</div><div class="m">Decision · ${fmtDate(d.date)}</div></div></div>`).join('') + `</div>`;
  }

  if (openActions.length) {
    out += `<h2 class="sectiontitle display">${star('star')} Open actions to review (matters arising)</h2><div class="rowlist">` +
      openActions.map((a) => `
        <div class="card row">
          <button class="checkbtn" aria-label="Mark done" data-toggle="${a.id}">✓</button>
          <div class="body"><div class="t">${esc(a.title)}</div>
          <div class="m">${esc(a.owner || 'Unassigned')} · due ${fmtDate(a.due)}</div></div>
          ${isOverdue(a) ? `<span class="tag tag-overdue">Overdue</span>` : ''}
        </div>`).join('') + `</div>`;
  }
  return out;
}

function minutesText(m) {
  const ref = mref(m);
  let t = `SWADLINCOTE LASERS BASKETBALL CLUB\n${m.title.toUpperCase()} — ${fmtDate(m.date)}\n`;
  if (m.attendees) t += `Attendees: ${m.attendees}\n`;
  t += `\n`;
  m.agenda.forEach((it, i) => {
    t += `${i + 1}. ${it.title}\n`;
    if (it.notes) t += `   ${it.notes.replace(/\n/g, '\n   ')}\n`;
    t += `\n`;
  });
  const acts = S.actions.filter((a) => a.meeting === ref);
  const decs = S.decisions.filter((d) => d.meeting === ref && !d.void);
  if (decs.length) { t += `DECISIONS\n`; decs.forEach((d) => t += `- ${d.title}\n`); t += `\n`; }
  if (acts.length) { t += `ACTIONS\n`; acts.forEach((a) => t += `- ${a.title} (${a.owner || 'Unassigned'}, due ${fmtDate(a.due)})\n`); }
  return t;
}

// ============================================================
// Page: Registers (actions / decisions / risks)
// ============================================================
function registersPage() {
  let out = pageHead('Registers', 'Actions, Decisions & Risks', '',
    S.reg === 'actions' ? `<button class="btn btn-gold" data-modal="action:new">+ Add action</button>`
    : S.reg === 'decisions' ? `<button class="btn btn-gold" data-modal="decision:new">+ Log decision</button>`
    : `<button class="btn btn-gold" data-modal="risk:new">+ Add risk</button>`);
  out += `<div class="filters">` + [['actions', 'Actions'], ['decisions', 'Decisions'], ['risks', 'Risks']].map(([id, l]) =>
    `<button class="chip${S.reg === id ? ' on' : ''}" data-reg="${id}">${l}</button>`).join('') + `</div>`;
  out += S.reg === 'actions' ? actionsSection() : S.reg === 'decisions' ? decisionsSection() : risksSection();
  return out;
}

function actionsSection() {
  const list = S.actions
    .filter((a) => S.filter === 'all' ? true : S.filter === 'overdue' ? isOverdue(a) : a.status === S.filter)
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);
  let out = `<div class="filters">` + ['open', 'overdue', 'done', 'all'].map((f) =>
    `<button class="chip${S.filter === f ? ' on' : ''}" data-filter="${f}" style="font-size:12px;padding:5px 11px">${f[0].toUpperCase() + f.slice(1)}</button>`).join('') + `</div>`;
  if (!list.length) return out + `<div class="card empty"><div class="display">No ${S.filter === 'all' ? '' : S.filter} actions</div>
    <p>Actions agreed in meetings live here, with owners and due dates.</p></div>`;
  return out + `<div class="rowlist">` + list.map((a) => `
    <div class="card row">
      <button class="checkbtn${a.status === 'done' ? ' on' : ''}" aria-label="Mark done" data-toggle="${a.id}">✓</button>
      <div class="body" data-modal="action:${a.id}" style="cursor:pointer">
        <div class="t"${a.status === 'done' ? ' style="text-decoration:line-through;color:var(--muted)"' : ''}>${esc(a.title)}</div>
        <div class="m">${esc(a.owner || 'Unassigned')} · due ${fmtDate(a.due)}${a.meeting ? ` · ${esc(a.meeting)}` : ''}</div>
      </div>
      <div class="side">${isOverdue(a) ? `<span class="tag tag-overdue">Overdue</span>`
        : `<span class="tag ${a.status === 'done' ? 'tag-done' : 'tag-open'}">${a.status === 'done' ? 'Done' : 'Open'}</span>`}</div>
    </div>`).join('') + `</div>`;
}

function decisionsSection() {
  const list = [...S.decisions].sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1);
  if (!list.length) return `<div class="card empty"><div class="display">No decisions logged yet</div>
    <p>When the committee agrees something, log it here so it never gets lost in old minutes.</p></div>`;
  return `<div class="rowlist">` + list.map((d) => `
    <div class="card row" data-modal="decision:${d.id}" style="cursor:pointer;opacity:${d.void ? 0.55 : 1}">
      <div class="body"><div class="t"${d.void ? ' style="text-decoration:line-through;color:var(--muted)"' : ''}>${esc(d.title)}</div>
      <div class="m">${fmtDate(d.date)}${d.proposer ? ` · proposed by ${esc(d.proposer)}` : ''}${d.meeting ? ` · ${esc(d.meeting)}` : ''}${d.void ? ` · voided by ${esc(d.void.who)}${d.void.reason ? ': ' + esc(d.void.reason) : ''}` : ''}</div></div>
      ${d.void ? `<span class="tag tag-grey">Void</span>` : ''}
    </div>`).join('') + `</div>`;
}

const riskBand = (s) => s >= 15 ? 'red' : s >= 8 ? 'amber' : 'green';
const riskWord = { red: 'High', amber: 'Medium', green: 'Low' };

function risksSection() {
  const list = [...S.risks].sort((a, b) => (b.likelihood * b.impact) - (a.likelihood * a.impact));
  if (!list.length) return `<div class="card empty"><div class="display">No risks recorded</div>
    <p>Track anything that could hurt the club — funding, venues, volunteer cover, safeguarding.</p></div>`;
  return `<div class="rowlist">` + list.map((r) => {
    const score = r.likelihood * r.impact, band = riskBand(score);
    return `<div class="card row" data-modal="risk:${r.id}" style="cursor:pointer;opacity:${r.status === 'closed' ? 0.55 : 1}">
      <div class="score score-${band}">${score}</div>
      <div class="body"><div class="t">${esc(r.title)}</div>
      <div class="m">${r.owner ? esc(r.owner) + ' · ' : ''}${esc(r.mitigation || 'No mitigation recorded yet')}</div></div>
      <div class="side"><span class="tag tag-${band}">${r.status === 'closed' ? 'Closed' : riskWord[band]}</span></div>
    </div>`;
  }).join('') + `</div>`;
}

// ============================================================
// Page: Compliance
// ============================================================
function chk(date) {
  if (!date) return { cls: 'grey', word: 'Not set' };
  const u = daysUntil(date);
  if (u < 0) return { cls: 'red', word: 'Expired' };
  if (u < 60) return { cls: 'amber', word: `${u}d left` };
  return { cls: 'green', word: 'OK' };
}

function compliancePage() {
  let out = pageHead('Compliance', 'Compliance Tracker', 'The things that expire — checks, certificates, cover.',
    `<button class="btn btn-gold" data-modal="person:new">+ Add person</button>`);
  out += `<div class="docnote" style="margin-bottom:14px"><b>Use initials or first names only for now.</b>
    This preview stores data on this device without a login — full names, DBS details and certificate records
    should wait until committee sign-in (Firebase) is switched on.</div>`;

  const club = [['Basketball England affiliation', S.clubComp.affiliation], ['Club insurance', S.clubComp.insurance]];
  out += `<h2 class="sectiontitle display">${star('star')} Club level</h2><div class="rowlist">` +
    club.map(([label, d]) => {
      const c = chk(d);
      return `<div class="card row" data-modal="clubcomp:edit" style="cursor:pointer">
        <div class="body"><div class="t">${label}</div><div class="m">${d ? 'Expires ' + fmtDate(d) : 'No expiry date set'}</div></div>
        <span class="tag tag-${c.cls}">${c.word}</span></div>`;
    }).join('') + `</div>`;

  out += `<h2 class="sectiontitle display">${star('star')} Coaches & volunteers</h2>`;
  if (!S.people.length) {
    out += `<div class="card empty"><div class="display">No one tracked yet</div>
      <p>Add each coach and volunteer, then record when their DBS, safeguarding, first aid and licence run out.</p>
      <button class="btn btn-gold" data-modal="person:new">Add the first person</button></div>`;
  } else {
    const CHECKS = [['dbs', 'DBS'], ['safeguarding', 'S\u2019guard'], ['firstAid', '1st Aid'], ['licence', 'Licence']];
    out += `<div class="rowlist">` + S.people.map((p) => `
      <div class="card row" data-modal="person:${p.id}" style="cursor:pointer">
        <div class="body"><div class="t">${esc(p.name)}</div><div class="m">${esc(p.role || '')}</div>
          <div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">
            ${CHECKS.map(([k, l]) => { const c = chk(p[k]); return `<span class="mini mini-${c.cls}" title="${c.word}">${l}</span>`; }).join('')}
          </div>
        </div>
      </div>`).join('') + `</div>`;
  }

  out += `<h2 class="sectiontitle display">${star('star')} Policy reviews</h2>
    <div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" data-modal="policy:new">+ Add policy</button></div>
    <div class="rowlist">` + S.policies.map((p) => {
      const c = chk(p.nextReview);
      return `<div class="card row" data-modal="policy:${p.id}" style="cursor:pointer">
        <div class="body"><div class="t">${esc(p.name)}</div>
        <div class="m">${p.lastReviewed ? 'Last reviewed ' + fmtDate(p.lastReviewed) : 'Never reviewed'}${p.nextReview ? ' · next due ' + fmtDate(p.nextReview) : ''}</div></div>
        <span class="tag tag-${c.cls}">${c.cls === 'grey' ? 'No date' : c.cls === 'red' ? 'Review due' : c.word}</span>
      </div>`;
    }).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Incidents
// ============================================================
const INC_TYPES = ['Injury', 'Safeguarding concern', 'Near miss', 'Behaviour', 'Other'];

function incidentsPage() {
  const list = [...S.incidents].sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1);
  let out = pageHead('Register', 'Incident Log', 'Injuries, safeguarding concerns and near-misses — recorded properly, reviewed at each meeting.',
    `<button class="btn btn-gold" data-modal="incident:new">+ Log incident</button>`);
  out += `<div class="docnote" style="margin-bottom:14px"><b>Initials only, no medical detail.</b>
    Until committee sign-in is switched on, keep entries factual and minimal — enough to review, not enough to identify.
    Serious safeguarding concerns go to the Safeguarding Lead and Basketball England first; this log is the club's record that it was handled.</div>`;
  if (!list.length) {
    out += `<div class="card empty"><div class="display">No incidents logged</div>
      <p>Good news — but when something happens at training or a game, record it here the same day.</p></div>`;
    return out;
  }
  out += `<div class="rowlist">` + list.map((i) => {
    const restricted = i.type === 'Safeguarding concern';
    return `<div class="card row" data-modal="incident:${i.id}" style="cursor:pointer;opacity:${i.void ? 0.55 : 1}">
      <div class="body"><div class="t"${i.void ? ' style="text-decoration:line-through;color:var(--muted)"' : ''}>${esc(i.type)}${i.who ? ` — ${esc(i.who)}` : ''}</div>
      <div class="m">${fmtDate(i.date)} · ${esc((i.summary || '').slice(0, 90))}${(i.summary || '').length > 90 ? '…' : ''}${i.void ? ` · voided by ${esc(i.void.who)}${i.void.reason ? ': ' + esc(i.void.reason) : ''}` : ''}</div>
      ${restricted ? `<div style="margin-top:6px"><span class="mini mini-grey">🔒 Restricted with sign-in: Safeguarding Lead & Chair only</span></div>` : ''}</div>
      ${i.void ? `<span class="tag tag-grey">Void</span>` : `<span class="tag ${i.status === 'closed' ? 'tag-done' : 'tag-amber'}">${i.status === 'closed' ? 'Closed' : 'Open'}</span>`}
    </div>`;
  }).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Contacts
// ============================================================
function contactsPage() {
  const list = [...S.contacts].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  let out = pageHead('Register', 'Key Contacts', 'The numbers that currently live in one person\u2019s phone.',
    `<button class="btn btn-gold" data-modal="contact:new">+ Add contact</button>`);
  if (!list.length) {
    out += `<div class="card empty"><div class="display">No contacts yet</div>
      <p>Venue manager, league secretary, BE regional contact, first aiders, trophy supplier — get them out of one person\u2019s head.</p>
      <button class="btn btn-gold" data-modal="contact:new">Add the first contact</button></div>`;
    return out;
  }
  out += `<div class="rowlist">` + list.map((c) => `
    <div class="card row" data-modal="contact:${c.id}" style="cursor:pointer">
      <div class="body"><div class="t">${esc(c.name)}</div>
      <div class="m">${esc(c.org || '')}${c.phone ? ` · ${esc(c.phone)}` : ''}${c.email ? ` · ${esc(c.email)}` : ''}</div></div>
    </div>`).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Role Handover
// ============================================================
function handoverPage() {
  let out = pageHead('Continuity', 'Role Handover', 'If you handed your role to a stranger tomorrow, what would they need to know?');
  out += `<div class="rowlist">` + ROLES.map((role) => {
    const h = S.handover[role];
    return `<div class="card row" data-modal="handover:${encodeURIComponent(role)}" style="cursor:pointer">
      <div class="body"><div class="t">${role}</div>
      <div class="m">${h && h.notes ? esc(h.notes.slice(0, 100)) + (h.notes.length > 100 ? '…' : '') + (h.updated ? ` · updated ${fmtDate(h.updated)}` : '') : 'No handover notes yet'}</div></div>
      <span class="tag ${h && h.notes ? 'tag-green' : 'tag-grey'}">${h && h.notes ? 'Written' : 'Empty'}</span>
    </div>`;
  }).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Activity (audit trail)
// ============================================================
function activityPage() {
  let out = pageHead('Accountability', 'Recent Activity', 'Who changed what, and when. Local-only for now — becomes tamper-proof with shared storage.');
  if (!S.audit.length) {
    out += `<div class="card empty"><div class="display">Nothing yet</div>
      <p>Every add, edit, completion, void and delete gets stamped here automatically.</p></div>`;
    return out;
  }
  out += `<div class="rowlist">` + S.audit.slice(0, 50).map((a) => `
    <div class="card row">
      <div class="body"><div class="t" style="font-weight:500">${esc(a.what)}</div>
      <div class="m">${esc(a.who)} · ${new Date(a.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
    </div>`).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Membership
// ============================================================
function membershipPage() {
  const totP = S.teams.reduce((t, x) => t + (Number(x.players) || 0), 0);
  const totE = S.teams.reduce((t, x) => t + (Number(x.subsExpected) || 0), 0);
  const totPd = S.teams.reduce((t, x) => t + (Number(x.subsPaid) || 0), 0);
  let out = pageHead('Club', 'Membership', 'Players per team, and subs paid vs expected.',
    `<button class="btn btn-gold" data-modal="team:new">+ Add team</button>`);
  out += `<div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
    <div class="card stat">${star('starmark')}<div class="n display">${totP}</div><div class="l">Players</div></div>
    <div class="card stat">${star('starmark')}<div class="n display" style="font-size:24px">${gbp(totPd)}</div><div class="l">Subs collected</div></div>
    <div class="card stat${totPd < totE ? ' alert' : ''}">${star('starmark')}<div class="n display" style="font-size:24px">${gbp(totE - totPd)}</div><div class="l">Subs outstanding</div></div>
  </div>`;
  if (!S.teams.length) {
    out += `<div class="card empty"><div class="display">No teams yet</div>
      <p>Add each team with its player count and subs position — the treasurer\u2019s report writes itself.</p>
      <button class="btn btn-gold" data-modal="team:new">Add the first team</button></div>`;
    return out;
  }
  out += `<div class="rowlist">` + S.teams.map((t) => {
    const short = (Number(t.subsExpected) || 0) - (Number(t.subsPaid) || 0);
    return `<div class="card row" data-modal="team:${t.id}" style="cursor:pointer">
      <div class="body"><div class="t">${esc(t.name)}</div>
      <div class="m">${t.players || 0} players · subs ${gbp(t.subsPaid)} of ${gbp(t.subsExpected)}</div></div>
      ${short > 0 ? `<span class="tag tag-amber">${gbp(short)} owed</span>` : `<span class="tag tag-green">Paid up</span>`}
    </div>`;
  }).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Finance
// ============================================================
const gbp = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB');

function financePage() {
  const inc = S.budget.filter((b) => b.type === 'income');
  const exp = S.budget.filter((b) => b.type === 'expense');
  const sum = (arr, k) => arr.reduce((t, b) => t + (Number(b[k]) || 0), 0);
  const net = sum(inc, 'actual') - sum(exp, 'actual');

  let out = pageHead('Finance', 'Budget & Grants', 'Enough for the treasurer\u2019s report to be a glance, not an evening.',
    `<button class="btn btn-gold" data-modal="budget:new">+ Budget line</button>`);

  out += `<div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
    <div class="card stat">${star('starmark')}<div class="n display" style="font-size:24px">${gbp(sum(inc, 'actual'))}</div><div class="l">Income (budget ${gbp(sum(inc, 'budget'))})</div></div>
    <div class="card stat">${star('starmark')}<div class="n display" style="font-size:24px">${gbp(sum(exp, 'actual'))}</div><div class="l">Spent (budget ${gbp(sum(exp, 'budget'))})</div></div>
    <div class="card stat${net < 0 ? ' alert' : ''}">${star('starmark')}<div class="n display" style="font-size:24px">${gbp(net)}</div><div class="l">Net position</div></div>
  </div>`;

  const lineRow = (b) => {
    const over = b.type === 'expense' && Number(b.actual) > Number(b.budget) && Number(b.budget) > 0;
    return `<div class="card row" data-modal="budget:${b.id}" style="cursor:pointer">
      <div class="body"><div class="t">${esc(b.name)}</div>
      <div class="m">${gbp(b.actual)} of ${gbp(b.budget)} budget</div></div>
      ${over ? `<span class="tag tag-red">Over</span>` : ''}
    </div>`;
  };
  out += `<h2 class="sectiontitle display">${star('star')} Income</h2><div class="rowlist">${inc.map(lineRow).join('') || '<div class="card empty"><p style="margin:0">No income lines.</p></div>'}</div>`;
  out += `<h2 class="sectiontitle display">${star('star')} Expenses</h2><div class="rowlist">${exp.map(lineRow).join('') || '<div class="card empty"><p style="margin:0">No expense lines.</p></div>'}</div>`;

  out += `<h2 class="sectiontitle display">${star('star')} Grants</h2>
    <div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" data-modal="grant:new">+ Track a grant</button></div>`;
  if (!S.grants.length) {
    out += `<div class="card empty"><p style="margin:0">Track grant applications from idea to money in the bank.</p></div>`;
  } else {
    const GC = { researching: 'tag-open', applied: 'tag-amber', awarded: 'tag-green', declined: 'tag-red', spent: 'tag-done' };
    out += `<div class="rowlist">` + S.grants.map((g) => `
      <div class="card row" data-modal="grant:${g.id}" style="cursor:pointer">
        <div class="body"><div class="t">${esc(g.name)}</div>
        <div class="m">${gbp(g.amount)}${g.deadline ? ` · deadline ${fmtDate(g.deadline)}` : ''}</div></div>
        <span class="tag ${GC[g.status] || 'tag-open'}">${g.status}</span>
      </div>`).join('') + `</div>`;
  }
  return out;
}

// ============================================================
// Page: Season Review
// ============================================================
function reviewPage() {
  let out = pageHead('Review', 'Season Review', 'The bit committees always skip — done in twenty minutes, and next season starts with a plan.',
    `<button class="btn btn-gold" data-modal="review:new">Start a review</button>`);
  if (!S.reviews.length) {
    out += `<div class="card empty"><div class="display">No reviews yet</div>
      <p>At the end of the season, capture what worked, the numbers, and three priorities for next year.</p>
      <button class="btn btn-gold" data-modal="review:new">Start the ${new Date().getFullYear() - 1}\u2013${String(new Date().getFullYear()).slice(2)} review</button></div>`;
    return out;
  }
  out += `<div class="rowlist">` + S.reviews.map((r) => `
    <div class="card" data-modal="review:${r.id}" style="cursor:pointer">
      <div class="t" style="font-weight:700;font-size:16px">${esc(r.season)} season</div>
      <div class="m" style="margin-top:4px">Members ${esc(r.memStart || '?')} → ${esc(r.memEnd || '?')}${r.priorities ? ` · priorities set` : ''}</div>
      ${r.well ? `<div class="m" style="margin-top:6px"><b>Went well:</b> ${esc(r.well).slice(0, 120)}${r.well.length > 120 ? '…' : ''}</div>` : ''}
    </div>`).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: More & Docs
// ============================================================
function morePage() {
  const items = [
    ['compliance', ICONS.shield, 'Compliance & Policies', 'DBS, safeguarding, affiliation, and policy review dates'],
    ['incidents', ICONS.alert, 'Incident Log', 'Injuries, safeguarding concerns and near-misses'],
    ['membership', ICONS.registers, 'Membership', 'Players per team, subs paid vs expected'],
    ['finance', ICONS.coins, 'Budget & Grants', 'Income vs spend, and grant applications'],
    ['contacts', ICONS.meetings, 'Key Contacts', 'Venue, league, BE regional, first aiders, suppliers'],
    ['handover', ICONS.docs, 'Role Handover', 'How-to-do-my-job notes for each committee role'],
    ['review', ICONS.review, 'Season Review', 'What worked, what didn\u2019t, priorities for next season'],
    ['activity', ICONS.registers, 'Recent Activity', 'Who changed what, and when'],
    ['docs', ICONS.docs, 'Documents', 'The governance library (coming with shared storage)'],
  ];
  return pageHead('Portal', 'More') + `<div class="rowlist">` + items.map(([id, ic, t, m]) => `
    <button class="card row" style="border:1px solid var(--line);text-align:left;width:100%" data-go="${id}">
      <span style="color:var(--purple);width:24px;height:24px;flex:none">${ic}</span>
      <div class="body"><div class="t">${t}</div><div class="m">${m}</div></div>
    </button>`).join('') + `</div>` +
    `<h2 class="sectiontitle display">${star('star')} Access model — coming with sign-in</h2>
    <div class="card" style="font-size:13.5px;color:var(--ink-soft);line-height:1.55">
      <b>Open by default.</b> Every committee member sees and edits the registers, meetings, club year,
      finance, membership, contacts and compliance status — transparency between committee members is good
      governance, and the audit trail provides the accountability.<br><br>
      <b>Restricted:</b> safeguarding incident detail visible to the Safeguarding Lead and Chair only;
      everyone else sees just the count.<br><br>
      <b>Admin (two people minimum):</b> Chair and Secretary invite and remove members — so the club is never
      locked out by one person leaving. Personal logins only, no shared passwords. Access is reviewed every
      year after the AGM (already in the Club Year planner).<br><br>
      <b>Never truly deleted:</b> decisions and incidents can only be marked void, with the reason kept —
      the club\u2019s official record stays intact.
    </div>
    <h2 class="sectiontitle display">${star('star')} Backup</h2>
    <div class="card row">
      <div class="body"><div class="t">Export all data</div>
      <div class="m">Everything on this device as a JSON file — until shared storage exists, this is your backup.</div></div>
      <button class="btn btn-gold btn-sm" data-export="1">Export</button>
    </div>`;
}

function docsPage() {
  return pageHead('Library', 'Documents', 'The governance library — policies, handbooks, meeting packs.') +
    `<div class="docnote"><b>Coming next.</b> The starting six: Constitution, Safeguarding Policy, Financial
    Regulations, Code of Conduct, Complaints & Discipline, and the Committee Handbook — produced as branded
    Word/PDF files first, then wired in here with search once shared storage (Firebase) is connected.</div>`;
}

// ============================================================
// Modals
// ============================================================
function field(label, inner) { return `<div class="field"><label>${label}</label>${inner}</div>`; }
const inp = (id, v, ph, type) => `<input id="${id}" type="${type || 'text'}" value="${esc(v)}" placeholder="${ph || ''}">`;
const txt = (id, v, ph) => `<textarea id="${id}" placeholder="${ph || ''}">${esc(v)}</textarea>`;

function modalHtml() {
  if (!S.modal) return '';
  const [kind, id] = S.modal.split(':');
  const isNew = id === 'new';
  let title = '', body = '', extraBtns = '';

  if (kind === 'action') {
    const a = isNew ? { meeting: (S.prefill || {}).meeting || '' } : S.actions.find((x) => x.id === id) || {};
    title = isNew ? 'New action' : 'Edit action';
    body = field('Action', inp('f-title', a.title, 'What needs doing?')) +
      `<div class="fieldrow">` + field('Owner', inp('f-owner', a.owner, 'Who?')) + field('Due date', inp('f-due', a.due, '', 'date')) + `</div>` +
      field('Meeting reference', inp('f-meeting', a.meeting, 'e.g. Committee meeting (14 Jul 2026)')) +
      field('Notes', txt('f-notes', a.notes));
  } else if (kind === 'decision') {
    const d = isNew ? { date: today(), meeting: (S.prefill || {}).meeting || '' } : S.decisions.find((x) => x.id === id) || {};
    title = isNew ? 'Log decision' : 'Edit decision';
    body = field('Decision', inp('f-title', d.title, 'What was agreed?')) +
      `<div class="fieldrow">` + field('Date', inp('f-date', d.date, '', 'date')) + field('Proposed by', inp('f-proposer', d.proposer)) + `</div>` +
      field('Meeting reference', inp('f-meeting', d.meeting)) +
      field('Notes / context', txt('f-notes', d.notes));
  } else if (kind === 'risk') {
    const r = isNew ? { likelihood: 3, impact: 3, status: 'open' } : S.risks.find((x) => x.id === id) || {};
    const score = (r.likelihood || 3) * (r.impact || 3);
    title = isNew ? 'New risk' : 'Edit risk';
    body = field('Risk', inp('f-title', r.title, 'What could go wrong?')) +
      `<div class="fieldrow">` +
      field(`Likelihood (<span id="lk-n">${r.likelihood}</span>/5)`, `<input id="f-likelihood" type="range" min="1" max="5" value="${r.likelihood}">`) +
      field(`Impact (<span id="im-n">${r.impact}</span>/5)`, `<input id="f-impact" type="range" min="1" max="5" value="${r.impact}">`) + `</div>` +
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:13px">
        <div class="score score-${riskBand(score)}" id="score-chip">${score}</div>
        <div style="font-size:13px;color:var(--muted)" id="score-word">${riskWord[riskBand(score)]} risk</div></div>` +
      field('Owner', inp('f-owner', r.owner)) +
      field('Mitigation — what are we doing about it?', txt('f-mitigation', r.mitigation)) +
      (isNew ? '' : field('Status', `<select id="f-status"><option value="open"${r.status === 'open' ? ' selected' : ''}>Open</option><option value="closed"${r.status === 'closed' ? ' selected' : ''}>Closed</option></select>`));
  } else if (kind === 'milestone') {
    const m = isNew ? { date: today(), cat: 'Season', prep: [] } : S.milestones.find((x) => x.id === id) || {};
    title = isNew ? 'New milestone' : 'Milestone';
    body = field('Milestone', inp('f-title', m.title, 'e.g. AGM')) +
      `<div class="fieldrow">` + field('Date', inp('f-date', m.date, '', 'date')) +
      field('Category', `<select id="f-cat">${['Governance', 'Compliance', 'Season', 'Events', 'Finance'].map((c) => `<option${m.cat === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`) + `</div>` +
      field('Notes', txt('f-notes', m.notes));
    if (!isNew && m.prep && m.prep.length) {
      body += `<div class="docnote" style="margin-bottom:13px"><b>Prep tasks:</b><br>${m.prep.map(esc).join('<br>')}</div>`;
      extraBtns = `<button class="btn btn-ghost" data-prep="${m.id}">Add prep to Actions</button>`;
    }
  } else if (kind === 'person') {
    const p = isNew ? {} : S.people.find((x) => x.id === id) || {};
    title = isNew ? 'Add person' : 'Edit person';
    body = `<div class="fieldrow">` + field('Name / initials', inp('f-name', p.name, 'e.g. JT')) + field('Role', inp('f-role', p.role, 'e.g. U14 coach')) + `</div>` +
      `<div class="fieldrow">` + field('DBS expiry', inp('f-dbs', p.dbs, '', 'date')) + field('Safeguarding cert expiry', inp('f-safeguarding', p.safeguarding, '', 'date')) + `</div>` +
      `<div class="fieldrow">` + field('First aid expiry', inp('f-firstAid', p.firstAid, '', 'date')) + field('Coaching licence expiry', inp('f-licence', p.licence, '', 'date')) + `</div>`;
  } else if (kind === 'clubcomp') {
    title = 'Club compliance';
    body = field('Basketball England affiliation expiry', inp('f-affiliation', S.clubComp.affiliation, '', 'date')) +
      field('Club insurance expiry', inp('f-insurance', S.clubComp.insurance, '', 'date'));
  } else if (kind === 'meeting') {
    title = 'New meeting';
    body = field('Title', inp('f-title', 'Committee meeting')) +
      field('Date', inp('f-date', today(), '', 'date')) +
      `<div class="docnote" style="margin-bottom:13px">The agenda will be pre-loaded with the standing items — apologies, minutes, matters arising, treasurer\u2019s and safeguarding reports and more. You can add or remove items after.</div>`;
  } else if (kind === 'budget') {
    const b = isNew ? { type: 'expense' } : S.budget.find((x) => x.id === id) || {};
    title = isNew ? 'New budget line' : 'Edit budget line';
    body = field('Name', inp('f-title', b.name, 'e.g. Venue hire')) +
      field('Type', `<select id="f-type"><option value="income"${b.type === 'income' ? ' selected' : ''}>Income</option><option value="expense"${b.type === 'expense' ? ' selected' : ''}>Expense</option></select>`) +
      `<div class="fieldrow">` + field('Budget (£)', inp('f-budget', b.budget, '0', 'number')) + field('Actual so far (£)', inp('f-actual', b.actual, '0', 'number')) + `</div>`;
  } else if (kind === 'grant') {
    const g = isNew ? { status: 'researching' } : S.grants.find((x) => x.id === id) || {};
    title = isNew ? 'Track a grant' : 'Edit grant';
    body = field('Grant', inp('f-title', g.name, 'e.g. Sport England Small Grants')) +
      `<div class="fieldrow">` + field('Amount (£)', inp('f-amount', g.amount, '0', 'number')) + field('Deadline', inp('f-deadline', g.deadline, '', 'date')) + `</div>` +
      field('Status', `<select id="f-status">${['researching', 'applied', 'awarded', 'declined', 'spent'].map((s) => `<option${g.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`);
  } else if (kind === 'review') {
    const r = isNew ? { season: `${new Date().getFullYear() - 1}\u2013${String(new Date().getFullYear()).slice(2)}` } : S.reviews.find((x) => x.id === id) || {};
    title = isNew ? 'Season review' : `${r.season} review`;
    body = field('Season', inp('f-season', r.season, 'e.g. 2025\u201326')) +
      `<div class="fieldrow">` + field('Members at start', inp('f-memStart', r.memStart, '', 'number')) + field('Members at end', inp('f-memEnd', r.memEnd, '', 'number')) + `</div>` +
      field('What went well?', txt('f-well', r.well)) +
      field('What was hard?', txt('f-hard', r.hard)) +
      field('Finances in one line', inp('f-fin', r.fin, 'e.g. broke even; venue costs up 10%')) +
      field('Volunteer picture', inp('f-vol', r.vol, 'e.g. same 4 people doing everything')) +
      field('Top 3 priorities for next season', txt('f-priorities', r.priorities, '1.\n2.\n3.'));
  } else if (kind === 'incident') {
    const i = isNew ? { date: today(), type: 'Injury', status: 'open' } : S.incidents.find((x) => x.id === id) || {};
    title = isNew ? 'Log incident' : 'Incident';
    body = `<div class="fieldrow">` +
      field('Date', inp('f-date', i.date, '', 'date')) +
      field('Type', `<select id="f-type">${INC_TYPES.map((t) => `<option${i.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>`) + `</div>` +
      field('Who (initials only)', inp('f-who', i.who, 'e.g. JT, U14s')) +
      field('What happened (factual, brief)', txt('f-summary', i.summary)) +
      field('Action taken', txt('f-action', i.actionTaken, 'e.g. first aid given, parents informed')) +
      field('Reported to', inp('f-reported', i.reportedTo, 'e.g. Safeguarding Lead, BE, parents')) +
      field('Status', `<select id="f-status"><option value="open"${i.status !== 'closed' ? ' selected' : ''}>Open</option><option value="closed"${i.status === 'closed' ? ' selected' : ''}>Closed</option></select>`);
  } else if (kind === 'policy') {
    const p = isNew ? {} : S.policies.find((x) => x.id === id) || {};
    title = isNew ? 'Add policy' : 'Policy review';
    body = field('Policy', inp('f-title', p.name, 'e.g. Safeguarding Policy')) +
      `<div class="fieldrow">` +
      field('Last reviewed', inp('f-last', p.lastReviewed, '', 'date')) +
      field('Next review due', inp('f-next', p.nextReview, '', 'date')) + `</div>` +
      `<div class="docnote" style="margin-bottom:13px">Tip: safeguarding annually; most others every 2\u20133 years or when something changes.</div>`;
  } else if (kind === 'contact') {
    const c = isNew ? {} : S.contacts.find((x) => x.id === id) || {};
    title = isNew ? 'Add contact' : 'Edit contact';
    body = `<div class="fieldrow">` + field('Name', inp('f-title', c.name)) + field('Organisation / role', inp('f-org', c.org, 'e.g. Green Bank Leisure Centre')) + `</div>` +
      `<div class="fieldrow">` + field('Phone', inp('f-phone', c.phone)) + field('Email', inp('f-email', c.email)) + `</div>` +
      field('Notes', txt('f-notes', c.notes, 'e.g. books courts, invoice monthly'));
  } else if (kind === 'handover') {
    const role = decodeURIComponent(id);
    const hh = S.handover[role] || {};
    title = `${role} — handover`;
    body = field('What would your replacement need to know?',
      `<textarea id="f-notes" style="min-height:180px" placeholder="Logins and where credentials live, regular tasks and when, who to contact for what, current issues in flight, where documents are kept…">${esc(hh.notes)}</textarea>`);
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
      <h2 class="display">${title}</h2>${body}
      <div class="actions">
        <button class="btn btn-ghost" data-close="1">Cancel</button>
        <button class="btn btn-gold" data-save="handover:${id}">Save</button>
      </div></div></div>`;
  } else if (kind === 'team') {
    const t = isNew ? {} : S.teams.find((x) => x.id === id) || {};
    title = isNew ? 'Add team' : 'Edit team';
    body = field('Team', inp('f-title', t.name, 'e.g. U14 Boys')) +
      field('Players', inp('f-players', t.players, '0', 'number')) +
      `<div class="fieldrow">` + field('Subs expected (£)', inp('f-expected', t.subsExpected, '0', 'number')) + field('Subs paid (£)', inp('f-paid', t.subsPaid, '0', 'number')) + `</div>`;
  } else if (kind === 'export') {
    title = 'Export — all portal data';
    body = `<textarea id="f-export" style="min-height:240px;font-size:12px" readonly>${esc(JSON.stringify(mem || {}, null, 2))}</textarea>
      <div class="docnote" style="margin-top:10px">A file download has been attempted. If it didn\u2019t appear, long-press in the box to select all, copy, and paste somewhere safe (a note, an email to yourself).</div>`;
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
      <h2 class="display">${title}</h2>${body}
      <div class="actions"><button class="btn btn-gold" data-close="1" style="flex:1">Done</button></div></div></div>`;
  } else if (kind === 'minutes') {
    const m = S.meetings.find((x) => x.id === id);
    title = 'Minutes — ready to copy';
    body = `<textarea id="f-minutes" style="min-height:260px;font-size:13px" readonly>${esc(minutesText(m))}</textarea>
      <div class="docnote" style="margin-top:10px">Long-press in the box to select all and copy, then paste into an email or document.</div>`;
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
      <h2 class="display">${title}</h2>${body}
      <div class="actions"><button class="btn btn-gold" data-close="1" style="flex:1">Done</button></div></div></div>`;
  }

  const VOID_KINDS = ['decision', 'incident'];
  const isVoided = kind === 'decision' ? (S.decisions.find((x) => x.id === id) || {}).void
    : kind === 'incident' ? (S.incidents.find((x) => x.id === id) || {}).void : false;
  return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
    <h2 class="display">${title}</h2>${body}
    <div class="actions">
      ${isNew || kind === 'clubcomp' ? '' : VOID_KINDS.includes(kind)
        ? (isVoided ? '' : `<button class="btn btn-danger" data-void="${kind}:${id}">Mark void</button>`)
        : `<button class="btn btn-danger" data-del="${kind}:${id}">Delete</button>`}
      ${extraBtns}
      <button class="btn btn-ghost" data-close="1">Cancel</button>
      <button class="btn btn-gold" data-save="${kind}:${id}">Save</button>
    </div></div></div>`;
}

// ---------- Save / delete ----------
const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

function upsert(arr, id, obj, extra) {
  return id === 'new' ? [...arr, { ...obj, id: uid(), ...(extra || {}) }] : arr.map((x) => x.id === id ? { ...x, ...obj } : x);
}

function saveModal(kind, id) {
  const isNew = id === 'new';
  if (kind === 'action') {
    if (!val('f-title').trim()) return;
    S.actions = upsert(S.actions, id, { title: val('f-title').trim(), owner: val('f-owner').trim(), due: val('f-due'), meeting: val('f-meeting').trim(), notes: val('f-notes') }, { status: 'open', created: today() });
  } else if (kind === 'decision') {
    if (!val('f-title').trim()) return;
    S.decisions = upsert(S.decisions, id, { title: val('f-title').trim(), date: val('f-date'), proposer: val('f-proposer').trim(), meeting: val('f-meeting').trim(), notes: val('f-notes') });
  } else if (kind === 'risk') {
    if (!val('f-title').trim()) return;
    S.risks = upsert(S.risks, id, { title: val('f-title').trim(), owner: val('f-owner').trim(), mitigation: val('f-mitigation'), likelihood: Number(val('f-likelihood')) || 3, impact: Number(val('f-impact')) || 3, status: val('f-status') || 'open' });
  } else if (kind === 'milestone') {
    if (!val('f-title').trim()) return;
    S.milestones = upsert(S.milestones, id, { title: val('f-title').trim(), date: val('f-date'), cat: val('f-cat'), notes: val('f-notes') }, { done: false, prep: [] });
  } else if (kind === 'person') {
    if (!val('f-name').trim()) return;
    S.people = upsert(S.people, id, { name: val('f-name').trim(), role: val('f-role').trim(), dbs: val('f-dbs'), safeguarding: val('f-safeguarding'), firstAid: val('f-firstAid'), licence: val('f-licence') });
  } else if (kind === 'clubcomp') {
    S.clubComp = { affiliation: val('f-affiliation'), insurance: val('f-insurance') };
  } else if (kind === 'meeting') {
    if (!val('f-title').trim()) return;
    const m = { id: uid(), title: val('f-title').trim(), date: val('f-date'), attendees: '', agenda: STANDING.map((t) => ({ id: uid(), title: t, notes: '' })) };
    S.meetings = [...S.meetings, m];
    S.modal = null; S.prefill = null; S.page = 'meeting'; S.meetingId = m.id;
    saveState(); render(); return;
  } else if (kind === 'budget') {
    if (!val('f-title').trim()) return;
    S.budget = upsert(S.budget, id, { name: val('f-title').trim(), type: val('f-type'), budget: Number(val('f-budget')) || 0, actual: Number(val('f-actual')) || 0 });
  } else if (kind === 'grant') {
    if (!val('f-title').trim()) return;
    S.grants = upsert(S.grants, id, { name: val('f-title').trim(), amount: Number(val('f-amount')) || 0, deadline: val('f-deadline'), status: val('f-status') });
  } else if (kind === 'review') {
    if (!val('f-season').trim()) return;
    S.reviews = upsert(S.reviews, id, { season: val('f-season').trim(), memStart: val('f-memStart'), memEnd: val('f-memEnd'), well: val('f-well'), hard: val('f-hard'), fin: val('f-fin'), vol: val('f-vol'), priorities: val('f-priorities') });
  } else if (kind === 'incident') {
    if (!val('f-summary').trim()) return;
    S.incidents = upsert(S.incidents, id, { date: val('f-date'), type: val('f-type'), who: val('f-who').trim(), summary: val('f-summary'), actionTaken: val('f-action'), reportedTo: val('f-reported').trim(), status: val('f-status') });
  } else if (kind === 'policy') {
    if (!val('f-title').trim()) return;
    S.policies = upsert(S.policies, id, { name: val('f-title').trim(), lastReviewed: val('f-last'), nextReview: val('f-next') });
  } else if (kind === 'contact') {
    if (!val('f-title').trim()) return;
    S.contacts = upsert(S.contacts, id, { name: val('f-title').trim(), org: val('f-org').trim(), phone: val('f-phone').trim(), email: val('f-email').trim(), notes: val('f-notes') });
  } else if (kind === 'handover') {
    const role = decodeURIComponent(id);
    S.handover = { ...S.handover, [role]: { notes: val('f-notes'), updated: today() } };
  } else if (kind === 'team') {
    if (!val('f-title').trim()) return;
    S.teams = upsert(S.teams, id, { name: val('f-title').trim(), players: Number(val('f-players')) || 0, subsExpected: Number(val('f-expected')) || 0, subsPaid: Number(val('f-paid')) || 0 });
  }
  const label = val('f-title').trim() || val('f-name').trim() || val('f-season').trim() || (kind === 'handover' ? decodeURIComponent(id) : '') || val('f-summary').trim().slice(0, 40) || kind;
  log(`${isNew ? 'Added' : 'Updated'} ${kind}: ${label}`);
  S.modal = null; S.prefill = null; saveState(); render();
}

function voidItem(kind, id) {
  const reason = prompt('Reason for voiding (kept in the record):') ?? '';
  const stamp = { when: today(), who: S.member ? S.member.name : '—', reason: reason.trim() };
  if (kind === 'decision') {
    const d = S.decisions.find((x) => x.id === id);
    S.decisions = S.decisions.map((x) => x.id === id ? { ...x, void: stamp } : x);
    log(`Voided decision: ${d ? d.title : id}${reason ? ' — ' + reason : ''}`);
  } else if (kind === 'incident') {
    const i = S.incidents.find((x) => x.id === id);
    S.incidents = S.incidents.map((x) => x.id === id ? { ...x, void: stamp } : x);
    log(`Voided incident: ${i ? i.type + ' ' + fmtDate(i.date) : id}${reason ? ' — ' + reason : ''}`);
  }
  S.modal = null; saveState(); render();
}

function deleteItem(kind, id) {
  if (!confirm('Delete this?')) return;
  const map = { action: 'actions', decision: 'decisions', risk: 'risks', milestone: 'milestones', person: 'people', budget: 'budget', grant: 'grants', review: 'reviews', meeting: 'meetings', incident: 'incidents', policy: 'policies', contact: 'contacts', team: 'teams' };
  const item = S[map[kind]].find((x) => x.id === id);
  log(`Deleted ${kind}: ${item ? (item.title || item.name || item.season || id) : id}`);
  S[map[kind]] = S[map[kind]].filter((x) => x.id !== id);
  S.modal = null; saveState(); render();
}

// ---------- Setup ----------
function setupHtml() {
  return `<div class="setup">${star('bigstar')}
    <div class="setup-card">
      <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers Basketball Club"></div>
      <h1 class="display">Committee Portal</h1>
      <p class="sub">Set up this device to get started.</p>
      ${field('Your name', `<input id="su-name" placeholder="e.g. Sam Taylor">`)}
      ${field('Committee role', `<select id="su-role">${ROLES.map((r) => `<option>${r}</option>`).join('')}</select>`)}
      <button class="btn btn-gold" style="width:100%;justify-content:center;margin-top:6px" id="su-go" disabled>Open the portal</button>
      <p class="note">Data is stored on this device for now. Committee-wide sign-in and shared data arrive with the Firebase upgrade.</p>
    </div></div>`;
}

// ---------- Shell ----------
const NAVMOB = [['home', 'Dashboard', ICONS.home], ['year', 'Club Year', ICONS.year], ['meetings', 'Meetings', ICONS.meetings], ['registers', 'Registers', ICONS.registers], ['more', 'More', ICONS.more]];
const NAVDESK = [['compliance', 'Compliance', ICONS.shield], ['finance', 'Finance', ICONS.coins], ['review', 'Season Review', ICONS.review], ['docs', 'Documents', ICONS.docs]];

function shellHtml(content) {
  const tab = TAB_OF[S.page] || 'home';
  const btn = ([id, label, icon], extra) => `
    <button class="${(extra || '')}${(id === tab && !(extra && id === 'more')) || S.page === id ? ' active' : ''}" data-go="${id}" >${icon}<span>${label}</span></button>`;
  return `<div class="shell">
    <nav class="bottomnav" aria-label="Main">
      <div class="sidehead">
        <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers"></div>
        <div><div class="club">Swadlincote Lasers</div><div class="app-name display">Committee Portal</div></div>
      </div>
      ${NAVMOB.slice(0, 4).map((n) => btn(n)).join('')}
      ${btn(NAVMOB[4], 'mobonly')}
      ${NAVDESK.map((n) => btn(n, 'deskonly ')).join('')}
      <div class="sidefoot">${esc(S.member ? S.member.name : '')} · ${esc(S.member ? S.member.role : '')}</div>
    </nav>
    <div>
      <header class="topbar">
        <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers"></div>
        <div class="titles"><div class="club">Swadlincote Lasers</div><div class="app-name display">Committee Portal</div></div>
        <div class="who"><b>${esc(S.member.name)}</b>${esc(S.member.role)}</div>
      </header>
      <main>${content}</main>
    </div>
    ${modalHtml()}
  </div>`;
}

function render() {
  const root = document.getElementById('app');
  if (!S.member) { root.innerHTML = setupHtml(); bindSetup(); return; }
  const pages = { home: dashboardPage, year: yearPage, meetings: meetingsPage, meeting: meetingPage, registers: registersPage, compliance: compliancePage, finance: financePage, review: reviewPage, docs: docsPage, more: morePage, incidents: incidentsPage, contacts: contactsPage, handover: handoverPage, membership: membershipPage, activity: activityPage };
  root.innerHTML = shellHtml((pages[S.page] || dashboardPage)());
  bindRiskSliders();
}

// ---------- Events ----------
function bindSetup() {
  const name = document.getElementById('su-name');
  const go = document.getElementById('su-go');
  name.addEventListener('input', () => { go.disabled = !name.value.trim(); });
  go.addEventListener('click', () => {
    S.member = { name: name.value.trim(), role: document.getElementById('su-role').value };
    saveState(); render();
  });
}

function bindRiskSliders() {
  const lk = document.getElementById('f-likelihood'), im = document.getElementById('f-impact');
  if (!lk || !im) return;
  const upd = () => {
    const score = Number(lk.value) * Number(im.value), band = riskBand(score);
    document.getElementById('lk-n').textContent = lk.value;
    document.getElementById('im-n').textContent = im.value;
    const chip = document.getElementById('score-chip');
    chip.textContent = score; chip.className = 'score score-' + band;
    document.getElementById('score-word').textContent = riskWord[band] + ' risk';
  };
  lk.addEventListener('input', upd); im.addEventListener('input', upd);
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'overlay') { S.modal = null; S.prefill = null; render(); return; }
  const t = e.target.closest('[data-go],[data-modal],[data-filter],[data-reg],[data-toggle],[data-ms-toggle],[data-save],[data-del],[data-void],[data-close],[data-open-meeting],[data-ag-add],[data-ag-del],[data-quick-action],[data-quick-decision],[data-minutes],[data-prep],[data-export]');
  if (!t) return;
  const d = t.dataset;
  if (d.go) { S.page = d.go; render(); }
  else if (d.filter) { S.filter = d.filter; render(); }
  else if (d.reg) { S.reg = d.reg; render(); }
  else if (d.toggle) {
    const a = S.actions.find((x) => x.id === d.toggle);
    S.actions = S.actions.map((x) => x.id === d.toggle ? { ...x, status: x.status === 'open' ? 'done' : 'open' } : x);
    if (a) log(`${a.status === 'open' ? 'Completed' : 'Reopened'} action: ${a.title}`);
    saveState(); render();
  }
  else if (d.void) { const [k, i] = d.void.split(':'); voidItem(k, i); }
  else if (d.msToggle) {
    S.milestones = S.milestones.map((m) => m.id === d.msToggle ? { ...m, done: !m.done } : m);
    saveState(); render();
  }
  else if (d.openMeeting) { S.page = 'meeting'; S.meetingId = d.openMeeting; render(); }
  else if (d.agAdd) {
    const input = document.getElementById('ag-new');
    if (input && input.value.trim()) {
      S.meetings = S.meetings.map((m) => m.id === d.agAdd ? { ...m, agenda: [...m.agenda, { id: uid(), title: input.value.trim(), notes: '' }] } : m);
      saveState(); render();
    }
  }
  else if (d.agDel) {
    const [mid, iid] = d.agDel.split(':');
    S.meetings = S.meetings.map((m) => m.id === mid ? { ...m, agenda: m.agenda.filter((i) => i.id !== iid) } : m);
    saveState(); render();
  }
  else if (d.quickAction !== undefined) { S.prefill = { meeting: d.quickAction }; S.modal = 'action:new'; render(); }
  else if (d.quickDecision !== undefined) { S.prefill = { meeting: d.quickDecision }; S.modal = 'decision:new'; render(); }
  else if (d.minutes) { S.modal = 'minutes:' + d.minutes; render(); }
  else if (d.prep) {
    const m = S.milestones.find((x) => x.id === d.prep);
    if (m && m.prep) {
      const due = new Date(m.date + 'T00:00'); due.setDate(due.getDate() - 14);
      const dueIso = due.toISOString().slice(0, 10);
      m.prep.forEach((p) => S.actions.push({ id: uid(), title: p, owner: '', due: dueIso, meeting: m.title, notes: '', status: 'open', created: today() }));
      S.modal = null; saveState(); render();
    }
  }
  else if (d.export) {
    saveState();
    try {
      const blob = new Blob([JSON.stringify(mem, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lasers-committee-backup-' + today() + '.json';
      a.click();
    } catch {}
    S.modal = 'export:all'; render();
  }
  else if (d.modal) { S.modal = d.modal; render(); }
  else if (d.close) { S.modal = null; S.prefill = null; render(); }
  else if (d.save) { const [k, i] = d.save.split(':'); saveModal(k, i); }
  else if (d.del) { const [k, i] = d.del.split(':'); deleteItem(k, i); }
});

// Save meeting notes / attendees without re-rendering (keeps typing smooth)
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-set]');
  if (!t) return;
  const parts = t.dataset.set.split(':');
  if (parts[0] === 'attendees') {
    S.meetings = S.meetings.map((m) => m.id === parts[1] ? { ...m, attendees: t.value } : m);
  } else if (parts[0] === 'minutes') {
    S.meetings = S.meetings.map((m) => m.id === parts[1]
      ? { ...m, agenda: m.agenda.map((i) => i.id === parts[2] ? { ...i, notes: t.value } : i) } : m);
  }
  saveState();
});

render();
