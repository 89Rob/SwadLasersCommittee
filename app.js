const LOGO = 'logo.jpg';

// ============================================================
// Swadlincote Lasers — Committee Portal
// Supabase-connected build: real sign-in, shared data, role-based
// access enforced by the database (row-level security), file uploads.
// ============================================================

const SUPABASE_URL = 'https://hlhodqsvegvpxacqhdzi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YHEc5hXs6RE6uPfJ6mfQ2Q_Xc8y6H5Q';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Utilities ----------
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

// ---------- App state (populated from Supabase after sign-in) ----------
const S = {
  page: 'home', filter: 'open', reg: 'actions', modal: null, meetingId: null, prefill: null, docCat: 'All',
  actions: [], decisions: [], risks: [], milestones: [], people: [], clubComp: { affiliation: '', insurance: '' },
  meetings: [], budget: [], grants: [], reviews: [], incidents: [], policies: [], contacts: [], handover: {},
  teams: [], docs: [], audit: [], members: [], complianceSummary: { red: 0, amber: 0, green: 0, not_set: 0 },
  interests: [], policy_acks: [],
};

let CM = null;       // the signed-in member's row (name, role, is_admin, can_safeguarding, email)
let session = null;  // Supabase auth session

// ---------- Field-name mapping (a handful of DB columns are snake_case) ----------
function fromDb(table, row) {
  if (!row) return row;
  switch (table) {
    case 'people': { const { first_aid, ...rest } = row; return { ...rest, firstAid: first_aid }; }
    case 'incidents': { const { action_taken, reported_to, ...rest } = row; return { ...rest, actionTaken: action_taken, reportedTo: reported_to }; }
    case 'teams': { const { subs_expected, subs_paid, ...rest } = row; return { ...rest, subsExpected: subs_expected, subsPaid: subs_paid }; }
    case 'reviews': { const { mem_start, mem_end, ...rest } = row; return { ...rest, memStart: mem_start, memEnd: mem_end }; }
    case 'policies': { const { last_reviewed, next_review, ...rest } = row; return { ...rest, lastReviewed: last_reviewed, nextReview: next_review }; }
    case 'docs': { const { where_kept, ...rest } = row; return { ...rest, where: where_kept }; }
    default: return row;
  }
}
function toDb(table, obj) {
  switch (table) {
    case 'people': { const { firstAid, ...rest } = obj; return { ...rest, first_aid: firstAid ?? null }; }
    case 'incidents': { const { actionTaken, reportedTo, ...rest } = obj; return { ...rest, action_taken: actionTaken, reported_to: reportedTo }; }
    case 'teams': { const { subsExpected, subsPaid, ...rest } = obj; return { ...rest, subs_expected: subsExpected, subs_paid: subsPaid }; }
    case 'reviews': { const { memStart, memEnd, ...rest } = obj; return { ...rest, mem_start: memStart, mem_end: memEnd }; }
    case 'policies': { const { lastReviewed, nextReview, ...rest } = obj; return { ...rest, last_reviewed: lastReviewed ?? null, next_review: nextReview ?? null }; }
    case 'docs': { const { where, ...rest } = obj; return { ...rest, where_kept: where }; }
    default: return obj;
  }
}

// ---------- Toast notifications (replaces native alert()) ----------
let toastTimer = null;
function showToast(message, type = 'error') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  host.className = 'toast toast-' + type;
  host.textContent = message;
  // Force reflow so the transition re-triggers even if a toast is already showing
  void host.offsetWidth;
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.classList.remove('show'); }, 4200);
}

// ---------- Audit trail: real, server-side, append-only ----------
async function log(what) {
  const who = CM ? CM.name : '—';
  S.audit.unshift({ t: new Date().toISOString(), who, what });
  if (S.audit.length > 200) S.audit.length = 200;
  try { await sb.from('audit').insert({ who, what }); } catch (e) { console.error('audit log failed', e); }
}

// ---------- Load everything the signed-in member can see ----------
const TABLES = ['actions', 'decisions', 'risks', 'milestones', 'people', 'meetings', 'budget', 'grants',
  'reviews', 'incidents', 'policies', 'contacts', 'teams', 'docs', 'members', 'interests', 'policy_acks'];

async function loadAll() {
  const results = await Promise.all(TABLES.map((t) => sb.from(t).select('*')));
  TABLES.forEach((t, i) => {
    const { data, error } = results[i];
    if (error) { console.error(t, error); S[t] = []; return; }
    S[t] = (data || []).map((row) => fromDb(t, row));
  });

  const { data: cc } = await sb.from('club_compliance').select('*').eq('id', 1).maybeSingle();
  S.clubComp = cc || { affiliation: '', insurance: '' };

  const { data: hoRows } = await sb.from('handover').select('*');
  S.handover = {};
  (hoRows || []).forEach((r) => { S.handover[r.role] = { notes: r.notes, updated: r.updated }; });

  const { data: auditRows } = await sb.from('audit').select('*').order('t', { ascending: false }).limit(500);
  S.audit = auditRows || [];

  const { data: summaryRows } = await sb.rpc('compliance_summary');
  S.complianceSummary = (summaryRows && summaryRows[0]) || { red: 0, amber: 0, green: 0, not_set: 0 };
}

// ============================================================
// Auth screens
// ============================================================
function signInHtml(sentTo) {
  return `<main class="setup">${star('bigstar')}
    <div class="setup-card">
      <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers Basketball Club"></div>
      <h1 class="display">Committee Portal</h1>
      <p class="sub">Sign in with your committee email.</p>
      ${sentTo ? `
        <div class="docnote">Check <b>${esc(sentTo)}</b> for a sign-in link. Open it on this device to continue.
        Links expire after a while — request a new one if needed.</div>
        <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:10px" id="si-again">Use a different email</button>
      ` : `
        <div class="field"><label>Email address</label><input id="si-email" type="email" placeholder="you@example.com"></div>
        <button class="btn btn-gold" style="width:100%;justify-content:center;margin-top:6px" id="si-go">Send sign-in link</button>
        <p class="note">No password — a link is emailed to you. Only invited committee members can sign in.</p>
      `}
    </div></main>`;
}

function notInvitedHtml() {
  const email = session && session.user ? session.user.email : '';
  return `<main class="setup">${star('bigstar')}
    <div class="setup-card">
      <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers Basketball Club"></div>
      <h1 class="display">Not on the list yet</h1>
      <p class="sub">${esc(email)} isn\u2019t an active committee member on this portal.</p>
      <p class="note">Ask an admin (Chair or Secretary) to invite you from Committee Members, then sign in again.</p>
      <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:10px" id="si-signout">Sign out</button>
    </div></main>`;
}

function loadingHtml() {
  return `<main class="setup">${star('bigstar')}
    <div class="setup-card" style="text-align:center"><div class="display" style="color:var(--purple)">Loading the portal…</div></div></main>`;
}

function renderAuthScreen(sentTo) {
  document.getElementById('app').innerHTML = signInHtml(sentTo);
  if (sentTo) {
    document.getElementById('si-again').addEventListener('click', () => renderAuthScreen(null));
    return;
  }
  const box = document.getElementById('si-email');
  document.getElementById('si-go').addEventListener('click', async () => {
    const email = (box.value || '').trim();
    if (!email) return;
    const btn = document.getElementById('si-go'); btn.disabled = true; btn.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) { showToast('Could not send link: ' + error.message); btn.disabled = false; btn.textContent = 'Send sign-in link'; return; }
    renderAuthScreen(email);
  });
}

function renderNotInvited() {
  document.getElementById('app').innerHTML = notInvitedHtml();
  document.getElementById('si-signout').addEventListener('click', async () => { await sb.auth.signOut(); });
}

// ---------- Boot sequence ----------
async function boot(newSession) {
  session = newSession;
  if (!session) { renderAuthScreen(null); return; }

  const email = session.user.email.toLowerCase();
  const { data: member } = await sb.from('members').select('*').ilike('email', email).maybeSingle();
  if (!member || !member.active) {
    CM = null;
    sb.functions.invoke('log-signin-attempt').catch(() => {});
    renderNotInvited();
    return;
  }
  CM = member;

  document.getElementById('app').innerHTML = loadingHtml();
  await loadAll();
  render();
}

sb.auth.onAuthStateChange((_event, s) => { boot(s); });
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
  members: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8.5" r="2.4"/><path d="M15.5 14.2c2.6.4 4.5 2.6 4.5 5.8"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.3-4.3"/></svg>`,
};

const TAB_OF = { home: 'home', year: 'year', meetings: 'meetings', meeting: 'meetings', registers: 'registers', more: 'more', compliance: 'more', finance: 'more', review: 'more', docs: 'more', incidents: 'more', contacts: 'more', handover: 'more', membership: 'more', activity: 'more', members: 'more', search: 'more', interests: 'more' };

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
  if (CM.can_safeguarding || CM.is_admin) {
    S.people.forEach((p) => ['dbs', 'safeguarding', 'firstAid', 'licence'].forEach((k) => check(p[k])));
  } else {
    n += (S.complianceSummary.red || 0) + (S.complianceSummary.amber || 0);
  }
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
      <div class="side" style="flex-direction:row;align-items:center;gap:8px">
        <button class="btn btn-ghost btn-sm" data-ical-milestone="${m.id}" title="Add to calendar">📅</button>
        ${chip}
      </div>
    </div>`;
  }).join('') + `</div>`;
  return out;
}

// ============================================================
// Page: Meetings
// ============================================================
const STANDING = ['Welcome & apologies', 'Minutes of last meeting', 'Matters arising — action review', 'Treasurer\u2019s report', 'Safeguarding report', 'Membership & teams', 'Fundraising & grants', 'Any other business', 'Date of next meeting'];
const OFFBOARD_ITEMS = [
  'Handover notes reviewed and up to date for this role',
  'Removed from any shared drives or documents kept outside the portal',
  'Removed from committee WhatsApp/communication groups',
  'Any club property returned (kit, keys, equipment)',
  'Replacement (if any) introduced to key contacts — venue, league, Basketball England',
];
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
    `<div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" data-ical-meeting="${m.id}">📅 Add to calendar</button>
      <button class="btn btn-ghost" data-print-minutes="${m.id}">⬇ Download PDF</button>
      <button class="btn btn-gold" data-minutes="${m.id}">Copy minutes</button>
    </div>`);

  out += `<div class="card" style="margin-bottom:14px">
    <div class="field" style="margin:0"><label>Attendees</label>
    <input data-set="attendees:${m.id}" value="${esc(m.attendees)}" placeholder="Who was there?"></div></div>`;

  out += `<h2 class="sectiontitle display">${star('star')} Agenda & minutes</h2><div class="rowlist">`;
  out += m.agenda.map((item, i) => `
    <div class="card">
      <div class="row" style="margin-bottom:8px">
        <div class="body"><div class="t">${i + 1}. ${esc(item.title)}</div>
        ${item.proposedBy ? `<div class="m">Proposed by ${esc(item.proposedBy)}</div>` : ''}</div>
        <div style="display:flex;gap:6px;flex:none">
          <button class="btn btn-ghost btn-sm" data-ag-to-decision="${m.id}:${item.id}">→ Decision</button>
          <button class="btn btn-danger btn-sm" data-ag-del="${m.id}:${item.id}">✕</button>
        </div>
      </div>
      <textarea data-set="minutes:${m.id}:${item.id}" placeholder="Minutes / notes for this item…"
        style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;background:#FCFBFE;min-height:56px;resize:vertical">${esc(item.notes)}</textarea>
    </div>`).join('');
  out += `</div>`;
  if (m.date >= today()) {
    out += `<div class="docnote" style="margin-top:10px">Got something for this meeting? Add it below \u2014 anyone can suggest an agenda item ahead of time, not just on the day.</div>`;
  }
  out += `<div style="margin-top:10px">
      <input id="ag-new" placeholder="Add agenda item…" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;background:#fff;margin-bottom:8px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="ag-new-by" placeholder="Proposed by (optional)" style="flex:1;min-width:140px;border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;background:#fff">
        <button class="btn btn-ghost" data-ag-add="${m.id}">Add item</button>
      </div>
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

// Branded, printable minutes — used with window.print() so anyone can
// "Save as PDF" via their browser's own print dialog. No new library,
// no new external dependency, nothing that could weaken the CSP/SRI work.
function minutesPrintHtml(m) {
  const ref = mref(m);
  const acts = S.actions.filter((a) => a.meeting === ref);
  const decs = S.decisions.filter((d) => d.meeting === ref && !d.void);
  let out = `<div class="print-header">
    <img src="${LOGO}" alt="Swadlincote Lasers" />
    <div><div class="print-club">Swadlincote Lasers Basketball Club</div>
    <div class="print-title">${esc(m.title)} — ${fmtDate(m.date)}</div>
    ${m.attendees ? `<div class="print-attendees">Attendees: ${esc(m.attendees)}</div>` : ''}</div>
  </div>`;
  out += `<ol class="print-agenda">` + m.agenda.map((it) => `
    <li><div class="print-item-title">${esc(it.title)}</div>
    ${it.notes ? `<div class="print-item-notes">${esc(it.notes).replace(/\n/g, '<br>')}</div>` : ''}</li>`).join('') + `</ol>`;
  if (decs.length) out += `<h3>Decisions</h3><ul class="print-list">` + decs.map((d) => `<li>${esc(d.title)}</li>`).join('') + `</ul>`;
  if (acts.length) out += `<h3>Actions</h3><ul class="print-list">` + acts.map((a) => `<li>${esc(a.title)} — ${esc(a.owner || 'Unassigned')}, due ${fmtDate(a.due)}</li>`).join('') + `</ul>`;
  return out;
}

function printMinutes(meetingId) {
  const m = S.meetings.find((x) => x.id === meetingId);
  if (!m) return;
  const area = document.getElementById('print-area');
  area.innerHTML = minutesPrintHtml(m);
  window.print();
}

// ---------- .ics calendar file — meetings and Club Year milestones ----------
function icsEscape(s) { return String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n'); }

function downloadICS({ title, description, date }) {
  const d = date.replace(/-/g, '');
  const next = new Date(date + 'T00:00'); next.setDate(next.getDate() + 1);
  const dNext = next.toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Swadlincote Lasers//Committee Portal//EN',
    'BEGIN:VEVENT',
    `UID:${uid()}@swadlaserscommittee.netlify.app`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${dNext}`,
    `SUMMARY:${icsEscape(title)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w\- ]+/g, '').slice(0, 40)}.ics`;
  a.click();
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
  const isMine = (a) => (a.owner || '').trim().toLowerCase() === (CM.name || '').trim().toLowerCase();
  const list = S.actions
    .filter((a) => S.filter === 'all' ? true : S.filter === 'overdue' ? isOverdue(a) : S.filter === 'mine' ? isMine(a) : a.status === S.filter)
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);
  let out = `<div class="filters">` + ['open', 'overdue', 'mine', 'done', 'all'].map((f) =>
    `<button class="chip${S.filter === f ? ' on' : ''}" data-filter="${f}" style="font-size:12px;padding:5px 11px">${f === 'mine' ? 'Mine' : f[0].toUpperCase() + f.slice(1)}</button>`).join('') + `</div>`;
  const emptyLabel = S.filter === 'all' ? 'No actions' : S.filter === 'mine' ? 'No actions assigned to you' : `No ${S.filter} actions`;
  if (!list.length) return out + `<div class="card empty"><div class="display">${emptyLabel}</div>
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
      <div class="m">${fmtDate(d.date)}${d.proposer ? ` · proposed by ${esc(d.proposer)}` : ''}${d.seconder ? `, seconded by ${esc(d.seconder)}` : ''}${d.meeting ? ` · ${esc(d.meeting)}` : ''}${d.void ? ` · voided by ${esc(d.void.who)}${d.void.reason ? ': ' + esc(d.void.reason) : ''}` : ''}</div></div>
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

// A policy_ack only counts as "current" if its acknowledged_version snapshot
// matches the policy's present lastReviewed date — so updating a policy
// automatically makes every earlier acknowledgement stale, with no separate
// version-number column to maintain.
function currentAcks(policyId, lastReviewed) {
  return S.policy_acks.filter((a) => a.policy_id === policyId && (a.acknowledged_version || null) === (lastReviewed || null));
}

function compliancePage() {
  const privileged = CM.can_safeguarding || CM.is_admin;
  let out = pageHead('Compliance', 'Compliance Tracker', 'The things that expire — checks, certificates, cover.',
    privileged ? `<button class="btn btn-gold" data-modal="person:new">+ Add person</button>` : '');
  out += `<div class="docnote" style="margin-bottom:14px"><b>Visible to signed-in committee members only.</b>
    DBS, safeguarding and first aid dates are protected by sign-in — only active committee accounts can see this page at all.</div>`;

  const club = [['Basketball England affiliation', S.clubComp.affiliation], ['Club insurance', S.clubComp.insurance]];
  out += `<h2 class="sectiontitle display">${star('star')} Club level</h2><div class="rowlist">` +
    club.map(([label, d]) => {
      const c = chk(d);
      return `<div class="card row" data-modal="clubcomp:edit" style="cursor:pointer">
        <div class="body"><div class="t">${label}</div><div class="m">${d ? 'Expires ' + fmtDate(d) : 'No expiry date set'}</div></div>
        <span class="tag tag-${c.cls}">${c.word}</span></div>`;
    }).join('') + `</div>`;

  out += `<h2 class="sectiontitle display">${star('star')} Coaches & volunteers</h2>`;

  if (!privileged) {
    // Counts only — never names or dates — for anyone without safeguarding/admin access.
    const s = S.complianceSummary;
    out += `<div class="statgrid" style="grid-template-columns:repeat(4,1fr)">
      <div class="card stat alert"><div class="n display" style="color:var(--red)">${s.red}</div><div class="l">Expired</div></div>
      <div class="card stat"><div class="n display" style="color:var(--amber)">${s.amber}</div><div class="l">Expiring soon</div></div>
      <div class="card stat"><div class="n display" style="color:var(--green)">${s.green}</div><div class="l">Up to date</div></div>
      <div class="card stat"><div class="n display" style="color:var(--muted)">${s.not_set}</div><div class="l">Not set</div></div>
    </div>
    <div class="docnote">Individual names and dates are visible to the Safeguarding Lead and Chair only.
      If something here needs chasing, raise it with them directly or at the next meeting.</div>`;
  } else if (!S.people.length) {
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
      const acks = currentAcks(p.id, p.lastReviewed);
      const iAcked = acks.some((a) => a.who === CM.name);
      return `<div class="card row" data-modal="policy:${p.id}" style="cursor:pointer">
        <div class="body"><div class="t">${esc(p.name)}</div>
        <div class="m">${p.lastReviewed ? 'Last reviewed ' + fmtDate(p.lastReviewed) : 'Never reviewed'}${p.nextReview ? ' · next due ' + fmtDate(p.nextReview) : ''}</div>
        <div class="m">${acks.length} acknowledged this version${iAcked ? ' · you\u2019ve confirmed it' : ' · you haven\u2019t confirmed it yet'}</div></div>
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
  out += `<div class="docnote" style="margin-bottom:14px"><b>Keep entries factual and minimal.</b>
    Safeguarding-type entries are restricted to the Safeguarding Lead and Chair — everyone else sees just the count.
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
      ${restricted ? `<div style="margin-top:6px"><span class="mini mini-grey">🔒 Safeguarding Lead & Chair only</span></div>` : ''}</div>
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
// Page: Interest Register
// ============================================================
function interestsPage() {
  const list = [...S.interests].sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1);
  let out = pageHead('Register', 'Interest Register', 'Anything that could be seen as a conflict of interest \u2014 declared openly, kept as a permanent record.',
    `<button class="btn btn-gold" data-modal="interest:new">+ Declare an interest</button>`);
  out += `<div class="docnote" style="margin-bottom:14px">Visible to every committee member \u2014 openness is the safeguard here. Once declared, an entry is never deleted, only marked void with a reason if it stops applying.</div>`;
  if (!list.length) {
    out += `<div class="card empty"><div class="display">Nothing declared yet</div>
      <p>If a decision could benefit you, a family member, or a business connection, declare it here — before it becomes an issue, not after.</p>
      <button class="btn btn-gold" data-modal="interest:new">Declare the first one</button></div>`;
    return out;
  }
  out += `<div class="rowlist">` + list.map((i) => `
    <div class="card row" data-modal="interest:${i.id}" style="cursor:pointer;opacity:${i.void ? 0.55 : 1}">
      <div class="body"><div class="t"${i.void ? ' style="text-decoration:line-through;color:var(--muted)"' : ''}>${esc(i.who)}</div>
      <div class="m">${esc(i.interest)}${i.date ? ' · declared ' + fmtDate(i.date) : ''}${i.void ? ` · voided by ${esc(i.void.who)}${i.void.reason ? ': ' + esc(i.void.reason) : ''}` : ''}</div></div>
      ${i.void ? `<span class="tag tag-grey">Void</span>` : ''}
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
  out += `<div class="rowlist">` + S.audit.slice(0, 500).map((a) => `
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
// ============================================================
// Page: Search — across the whole portal: actions, decisions, risks,
// incidents, policies, contacts, documents and meeting minutes
// ============================================================
function searchPage() {
  let out = pageHead('Find', 'Search', 'Across actions, decisions, risks, incidents, policies, contacts, documents and every meeting\u2019s minutes.');
  out += `<input id="global-search" placeholder="Search everything…" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:11px 13px;background:#fff;margin-bottom:14px" autofocus>`;
  out += `<div id="search-results"></div>`;
  return out;
}

function runGlobalSearch(q) {
  const results = document.getElementById('search-results');
  if (!results) return;
  const query = q.trim().toLowerCase();
  if (!query) { results.innerHTML = `<div class="card empty"><p style="margin:0">Start typing to search actions, decisions, risks, incidents, policies, contacts, documents and minutes.</p></div>`; return; }

  const hits = [];
  S.actions.forEach((a) => {
    if ((a.title + ' ' + (a.notes || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Action', title: a.title, meta: `${a.owner || 'Unassigned'} · due ${fmtDate(a.due)}`, go: 'registers', reg: 'actions' });
    }
  });
  S.decisions.forEach((d) => {
    if ((d.title + ' ' + (d.notes || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Decision', title: d.title, meta: fmtDate(d.date), go: 'registers', reg: 'decisions' });
    }
  });
  S.risks.forEach((r) => {
    if ((r.title + ' ' + (r.mitigation || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Risk', title: r.title, meta: `${r.owner ? r.owner + ' · ' : ''}score ${r.likelihood * r.impact}`, go: 'registers', reg: 'risks' });
    }
  });
  // Safeguarding-type incidents are already restricted server-side (via RLS) to the
  // Safeguarding Lead and Chair, so S.incidents for anyone else simply won't contain
  // them — this loop naturally respects that same restriction without any extra check.
  S.incidents.forEach((i) => {
    if ((i.type + ' ' + (i.who || '') + ' ' + (i.summary || '') + ' ' + (i.actionTaken || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Incident', title: `${i.type}${i.who ? ' — ' + i.who : ''}`, meta: fmtDate(i.date), go: 'incidents' });
    }
  });
  S.policies.forEach((p) => {
    if ((p.name || '').toLowerCase().includes(query)) {
      hits.push({ type: 'Policy', title: p.name, meta: p.nextReview ? `next review ${fmtDate(p.nextReview)}` : 'No review date set', go: 'compliance' });
    }
  });
  S.contacts.forEach((c) => {
    if ((c.name + ' ' + (c.org || '') + ' ' + (c.notes || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Contact', title: c.name, meta: c.org || '', go: 'contacts' });
    }
  });
  S.interests.forEach((it) => {
    if ((it.who + ' ' + (it.interest || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Interest', title: it.who, meta: (it.interest || '').slice(0, 60), go: 'interests' });
    }
  });
  S.docs.forEach((doc) => {
    if ((doc.name + ' ' + doc.cat + ' ' + (doc.notes || '')).toLowerCase().includes(query)) {
      hits.push({ type: 'Document', title: doc.name, meta: doc.cat, go: 'docs' });
    }
  });
  S.meetings.forEach((m) => {
    (m.agenda || []).forEach((item) => {
      if ((item.title + ' ' + (item.notes || '')).toLowerCase().includes(query)) {
        hits.push({ type: 'Minutes', title: `${m.title} — ${item.title}`, meta: fmtDate(m.date), go: 'meeting', meetingId: m.id });
      }
    });
  });

  if (!hits.length) {
    results.innerHTML = `<div class="card empty"><p style="margin:0">Nothing matches "${esc(q)}".</p></div>`;
    return;
  }
  // Navigation is handled entirely through data-search-* attributes, picked up by the
  // same central click-delegation system as every other button in the app — no separate
  // listeners bound here, so this stays in sync with the rest of the app's event handling.
  results.innerHTML = `<div class="rowlist">` + hits.map((h) => `
    <div class="card row" data-search-go="${h.go}"${h.meetingId ? ` data-search-meeting="${h.meetingId}"` : ''}${h.reg ? ` data-search-reg="${h.reg}"` : ''} style="cursor:pointer">
      <div class="body"><div class="t">${esc(h.title)}</div><div class="m">${esc(h.meta)}</div></div>
      <span class="tag tag-open">${h.type}</span>
    </div>`).join('') + `</div>`;
}

function bindGlobalSearch() {
  const box = document.getElementById('global-search');
  if (!box) return;
  box.addEventListener('input', () => runGlobalSearch(box.value));
  runGlobalSearch('');
}

function morePage() {
  const items = [
    ['compliance', ICONS.shield, 'Compliance & Policies', 'DBS, safeguarding, affiliation, and policy review dates'],
    ['incidents', ICONS.alert, 'Incident Log', 'Injuries, safeguarding concerns and near-misses'],
    ['membership', ICONS.registers, 'Membership', 'Players per team, subs paid vs expected'],
    ['finance', ICONS.coins, 'Budget & Grants', 'Income vs spend, and grant applications'],
    ['contacts', ICONS.meetings, 'Key Contacts', 'Venue, league, BE regional, first aiders, suppliers'],
    ['interests', ICONS.shield, 'Interest Register', 'Committee members\u2019 declared conflicts of interest'],
    ['handover', ICONS.docs, 'Role Handover', 'How-to-do-my-job notes for each committee role'],
    ['review', ICONS.review, 'Season Review', 'What worked, what didn\u2019t, priorities for next season'],
    ['search', ICONS.search, 'Search', 'Find anything across actions, decisions and minutes'],
    ['activity', ICONS.registers, 'Recent Activity', 'Who changed what, and when'],
    ['docs', ICONS.docs, 'Documents', 'The document library — indexed now, uploads coming next'],
  ];
  if (CM.is_admin) items.push(['members', ICONS.members, 'Committee Members', 'Invite, deactivate, and manage access levels']);
  return pageHead('Portal', 'More') + `<div class="rowlist">` + items.map(([id, ic, t, m]) => `
    <button class="card row" style="border:1px solid var(--line);text-align:left;width:100%" data-go="${id}">
      <span style="color:var(--purple);width:24px;height:24px;flex:none">${ic}</span>
      <div class="body"><div class="t">${t}</div><div class="m">${m}</div></div>
    </button>`).join('') + `</div>` +
    `<h2 class="sectiontitle display">${star('star')} Access model — live</h2>
    <div class="card" style="font-size:13.5px;color:var(--ink-soft);line-height:1.55">
      <b>Open by default.</b> Every committee member sees and edits the registers, meetings, club year,
      membership and contacts — transparency between committee members is good governance, and the audit
      trail provides the accountability.<br><br>
      <b>Restricted:</b> safeguarding incident detail and named DBS/safeguarding/first-aid records are visible
      to the Safeguarding Lead and Chair only — everyone else sees counts, never names. Budget and grant
      figures can only be edited by the Treasurer and admins (everyone can still view them).<br><br>
      <b>Admin (Chair + Secretary):</b> invite and remove members, and are the only ones who can still amend a
      decision or a past meeting once it\u2019s locked. Inviting someone sends them a real email straight away —
      no need to tell them to visit the site themselves. Personal logins only, no shared passwords. Access is
      reviewed every year after the AGM (already in the Club Year planner).<br><br>
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

// ============================================================
// Page: Members (admin only)
// ============================================================
function membersPage() {
  if (!CM.is_admin) {
    return pageHead('Access', 'Members') + `<div class="card empty"><div class="display">Admin only</div>
      <p>Managing committee accounts is limited to the Chair and Secretary.</p></div>`;
  }
  const list = [...S.members].sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name));
  let out = pageHead('Admin', 'Committee Members', 'Who can sign in, and what they can see.',
    `<button class="btn btn-gold" data-modal="member:new">+ Invite member</button>`);
  out += `<div class="rowlist">` + list.map((m) => `
    <div class="card row" data-modal="member:${m.id}" style="cursor:pointer;opacity:${m.active ? 1 : 0.5}">
      <div class="body"><div class="t">${esc(m.name)}${m.email === CM.email ? ' (you)' : ''}</div>
      <div class="m">${esc(m.role)} · ${esc(m.email)}${m.role_start ? ' · since ' + fmtDate(m.role_start) : ''}</div>
      <div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">
        ${m.is_admin ? `<span class="mini mini-green">Admin</span>` : ''}
        ${m.can_safeguarding ? `<span class="mini mini-amber">Safeguarding</span>` : ''}
        ${m.can_finance ? `<span class="mini mini-green">Finance</span>` : ''}
        ${!m.active ? `<span class="mini mini-grey">Inactive</span>` : ''}
      </div></div>
      ${!m.active ? `<button class="btn btn-ghost btn-sm" data-offboard="${m.id}">${m.offboarding ? 'Offboarding \u2713' : 'Offboarding'}</button>` : ''}
    </div>`).join('') + `</div>`;
  out += `<div class="docnote" style="margin-top:16px"><b>Access model:</b> everyone active sees the registers,
    meetings, finance, compliance and club year. Admin can manage members. Safeguarding grants visibility of
    restricted incident detail. Deactivating someone (rather than deleting) keeps the audit trail intact.</div>`;
  return out;
}

const DOC_CATS = ['Governance', 'Policies', 'Meetings & minutes', 'Finance', 'Safeguarding', 'Events & tournaments', 'Templates & forms', 'Other'];
// Map any records saved under the old category names
const OLD_CATS = { 'Minutes': 'Meetings & minutes', 'Meeting packs': 'Meetings & minutes', 'Templates': 'Templates & forms' };

function docsPage() {
  let out = pageHead('Library', 'Documents', 'The club\u2019s papers — searchable, versioned, and now uploadable.',
    `<button class="btn btn-gold" data-modal="doc:new">⬆ Add document</button>`);

  out += `<input id="doc-search" placeholder="Search documents…" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff;margin-bottom:12px">`;

  out += `<div class="filters">` + ['All', ...DOC_CATS].map((c) =>
    `<button class="chip${S.docCat === c ? ' on' : ''}" data-doccat="${c}">${c}</button>`).join('') + `</div>`;

  const list = S.docs
    .filter((d) => S.docCat === 'All' || d.cat === S.docCat)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!S.docs.length) {
    out += `<div class="card empty"><div class="display">No documents yet</div>
      <p>Add the first one — attach a file, or just index where it currently lives (Drive, email, someone\u2019s laptop…).</p>
      <button class="btn btn-gold" data-modal="doc:new">Add the first document</button></div>`;
  } else if (!list.length) {
    out += `<div class="card empty"><p style="margin:0">Nothing in ${esc(S.docCat)} yet.</p></div>`;
  } else {
    out += `<div class="rowlist">` + list.map((d) => `
      <div class="card row docrow" data-modal="doc:${d.id}" data-search="${esc((d.name + ' ' + d.cat + ' ' + (d.notes || '')).toLowerCase())}" style="cursor:pointer">
        <span style="color:var(--purple);width:22px;height:22px;flex:none">${ICONS.docs}</span>
        <div class="body"><div class="t">${esc(d.name)}${d.version ? ` <span style="color:var(--muted);font-weight:500;font-size:12px">v${esc(d.version)}</span>` : ''}</div>
        <div class="m">${esc(d.cat)}${d.where ? ` · lives in: ${esc(d.where)}` : ''}${(d.versions || []).length ? ` · ${d.versions.length} earlier version${d.versions.length > 1 ? 's' : ''}` : ''}${d.notes ? ` · ${esc(d.notes)}` : ''}</div></div>
        ${d.file_path ? `<button class="btn btn-ghost btn-sm" data-open-doc="${d.id}">Open</button>` : `<span class="tag tag-grey">No file</span>`}
      </div>`).join('') + `</div>`;
  }

  out += `<div class="docnote" style="margin-top:16px"><b>Policies note:</b> review dates for policies are tracked
    in Compliance & Policies. Uploading a new version of a policy keeps the old one as history below it —
    remember to update the review date there once you have.</div>`;
  return out;
}

// ============================================================
// Modals
// ============================================================
function field(label, inner) { return `<div class="field"><label>${label}</label>${inner}</div>`; }
const inp = (id, v, ph, type) => `<input id="${id}" type="${type || 'text'}" value="${esc(v)}" placeholder="${ph || ''}">`;
const txt = (id, v, ph) => `<textarea id="${id}" placeholder="${ph || ''}">${esc(v)}</textarea>`;

function modalHtml() {
  if (!S.modal) return '';

  // Voiding needs a proper reason-entry step, not a browser prompt() —
  // parsed specially since the id itself may not contain ':'.
  if (S.modal.startsWith('voidconfirm:')) {
    const rest = S.modal.slice('voidconfirm:'.length);
    const sep = rest.indexOf(':');
    const vKind = rest.slice(0, sep);
    const vId = rest.slice(sep + 1);
    const labels = { decision: 'decision', incident: 'incident', interest: 'interest declaration' };
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="Mark void">
      <h2 class="display">Mark ${labels[vKind] || 'item'} void</h2>
      <div class="docnote" style="margin-bottom:13px">This keeps the record — it\u2019s never deleted — but marks it
        void and stamps who did it and when. Give a short reason so anyone reading it later understands why.</div>
      <div class="field"><label>Reason (recommended)</label><textarea id="void-reason" placeholder="e.g. logged against the wrong meeting"></textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close="1">Cancel</button>
        <button class="btn btn-danger" data-voidconfirm="${vKind}:${vId}" style="flex:1">Confirm void</button>
      </div></div></div>`;
  }

  // Deleting also gets a proper branded confirm step instead of the browser's native confirm().
  if (S.modal.startsWith('delconfirm:')) {
    const rest = S.modal.slice('delconfirm:'.length);
    const sep = rest.indexOf(':');
    const dKind = rest.slice(0, sep);
    const dId = rest.slice(sep + 1);
    const dTable = TABLE_OF_KIND[dKind];
    const dItem = (S[dTable] || []).find((x) => x.id === dId) || {};
    const dName = labelFor(dItem);
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="Delete item">
      <h2 class="display">Delete this ${esc(dKind)}?</h2>
      <div class="docnote" style="margin-bottom:13px">"${esc(dName)}" will be permanently removed — this can\u2019t be undone.
        If this needs to stay in the record instead, Cancel and use Void where available.</div>
      <div class="actions">
        <button class="btn btn-ghost" data-close="1">Cancel</button>
        <button class="btn btn-danger" data-delconfirm="${dKind}:${dId}" style="flex:1">Delete</button>
      </div></div></div>`;
  }

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
    const d = isNew ? { date: today(), meeting: (S.prefill || {}).meeting || '', title: (S.prefill || {}).title || '', proposer: (S.prefill || {}).proposer || '' } : S.decisions.find((x) => x.id === id) || {};
    title = isNew ? 'Log decision' : 'Edit decision';
    body = field('Decision', inp('f-title', d.title, 'What was agreed?')) +
      `<div class="fieldrow">` + field('Date', inp('f-date', d.date, '', 'date')) + field('Proposed by', inp('f-proposer', d.proposer)) + `</div>` +
      field('Seconded by', inp('f-seconder', d.seconder)) +
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
    body += `<div class="field"><label>Prep tasks</label>
      <div id="prep-list">${(m.prep || []).map((p) => `
        <div class="preprow" style="display:flex;gap:8px;margin-bottom:8px">
          <input type="text" class="prep-item" value="${esc(p)}" style="flex:1;border:1.5px solid var(--line);border-radius:8px;padding:9px 11px;background:#FCFBFE">
          <button type="button" class="btn btn-danger btn-sm" data-prep-row-del="1">✕</button>
        </div>`).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="prep-add-row">+ Add prep task</button>
    </div>`;
    if (!isNew && m.prep && m.prep.length) {
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
    if (!isNew) {
      const acks = currentAcks(p.id, p.lastReviewed);
      const iAcked = acks.some((a) => a.who === CM.name);
      body += `<div class="field"><label>Acknowledged this version</label>` +
        (acks.length
          ? `<div class="rowlist">` + acks.map((a) => `
              <div class="card row" style="padding:10px 12px">
                <div class="body"><div class="t" style="font-size:13.5px">${esc(a.who)}</div>
                <div class="m">${fmtDate((a.acknowledged_at || '').slice(0, 10))}</div></div>
              </div>`).join('') + `</div>`
          : `<div class="docnote">Nobody has confirmed reading this version yet.</div>`) +
        `</div>` +
        (iAcked
          ? `<div class="docnote" style="margin-bottom:13px">You\u2019ve confirmed you\u2019ve read this version.</div>`
          : `<button type="button" class="btn btn-gold btn-sm" data-ack-policy="${p.id}" style="margin-bottom:13px">I\u2019ve read this policy</button>`);
    }
  } else if (kind === 'contact') {
    const c = isNew ? {} : S.contacts.find((x) => x.id === id) || {};
    title = isNew ? 'Add contact' : 'Edit contact';
    body = `<div class="fieldrow">` + field('Name', inp('f-title', c.name)) + field('Organisation / role', inp('f-org', c.org, 'e.g. Green Bank Leisure Centre')) + `</div>` +
      `<div class="fieldrow">` + field('Phone', inp('f-phone', c.phone)) + field('Email', inp('f-email', c.email)) + `</div>` +
      field('Notes', txt('f-notes', c.notes, 'e.g. books courts, invoice monthly'));
  } else if (kind === 'interest') {
    const it = isNew ? { date: today(), who: CM.name } : S.interests.find((x) => x.id === id) || {};
    title = isNew ? 'Declare an interest' : 'Interest declaration';
    body = field('Who is declaring', inp('f-title', it.who, 'Your name')) +
      field('Date declared', inp('f-date', it.date, '', 'date')) +
      field('The interest', txt('f-notes', it.interest, 'e.g. My spouse runs the company that supplies our kit'));
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
  } else if (kind === 'offboard') {
    const mem = S.members.find((x) => x.id === id) || {};
    const ob = mem.offboarding || { items: {} };
    title = `Offboarding — ${mem.name || ''}`;
    body = `<div class="docnote" style="margin-bottom:13px">${mem.name || 'This person'} has been marked inactive. Working through this
      checklist helps make sure nothing gets missed when someone leaves the committee.</div>`;
    body += OFFBOARD_ITEMS.map((label, i) => `
      <label style="display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--ink-soft);margin-bottom:12px">
        <input type="checkbox" id="ob-item-${i}" ${ob.items && ob.items[i] ? 'checked' : ''} style="width:19px;height:19px;margin-top:1px;flex:none">
        <span>${label}</span>
      </label>`).join('');
    body += field('Notes (optional)', txt('ob-notes', ob.notes));
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
      <h2 class="display">${title}</h2>${body}
      <div class="actions">
        <button class="btn btn-ghost" data-close="1">Close</button>
        <button class="btn btn-gold" data-save-offboard="${id}" style="flex:1">Save checklist</button>
      </div></div></div>`;
  } else if (kind === 'export') {
    title = 'Export — all portal data';
    body = `<textarea id="f-export" style="min-height:240px;font-size:12px" readonly>${esc(JSON.stringify(exportPayload(), null, 2))}</textarea>
      <div class="docnote" style="margin-top:10px">A file download has been attempted. If it didn\u2019t appear, long-press in the box to select all, copy, and paste somewhere safe (a note, an email to yourself).${(CM.can_safeguarding || CM.is_admin) ? '' : ' Named DBS/safeguarding detail and the member list are left out of your export, the same as on-screen \u2014 an admin\u2019s export includes them.'}</div>`;
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
      <h2 class="display">${title}</h2>${body}
      <div class="actions"><button class="btn btn-gold" data-close="1" style="flex:1">Done</button></div></div></div>`;
  } else if (kind === 'doc') {
    const dd = isNew ? { cat: 'Policies', versions: [] } : S.docs.find((x) => x.id === id) || {};
    const priorVersions = Array.isArray(dd.versions) ? dd.versions : [];
    title = isNew ? 'Add document' : 'Document record';
    body = field('Document', inp('f-title', dd.name, 'e.g. Safeguarding Policy')) +
      `<div class="fieldrow">` +
      field('Category', `<select id="f-cat">${DOC_CATS.map((c) => `<option${dd.cat === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`) +
      field('Version', inp('f-version', dd.version, 'e.g. 2.1 or 2026')) + `</div>` +
      field(dd.file_path ? 'Replace the file (optional)' : 'File (optional — you can index without one)', `<input id="f-file" type="file">`) +
      (dd.file_path
        ? `<div class="docnote" style="margin-bottom:13px">Current file: <button class="btn btn-ghost btn-sm" data-open-doc="${dd.id}" style="margin-left:6px">Open</button><br>Choosing a new file above keeps this one as history below — nothing is ever overwritten.</div>`
        : '') +
      (priorVersions.length
        ? `<div class="field"><label>Version history</label><div class="rowlist">` +
          priorVersions.slice().reverse().map((v, i) => `
            <div class="card row" style="padding:10px 12px">
              <div class="body"><div class="t" style="font-size:13.5px">${v.version ? 'v' + esc(v.version) : 'Earlier version'}</div>
              <div class="m">Replaced ${fmtDate(v.archived_at)}${v.uploaded_by ? ' · uploaded by ' + esc(v.uploaded_by) : ''}</div></div>
              <button class="btn btn-ghost btn-sm" data-open-docpath="${esc(v.file_path)}">Open</button>
            </div>`).join('') + `</div></div>`
        : '') +
      field('Where else it lives (optional)', inp('f-where', dd.where, 'e.g. Google Drive > Club folder')) +
      field('Notes', txt('f-notes', dd.notes));
  } else if (kind === 'member') {
    const m = isNew ? { role: 'Committee Member', is_admin: false, can_safeguarding: false, can_finance: false, active: true } : S.members.find((x) => x.id === id) || {};
    title = isNew ? 'Invite member' : 'Edit member';
    body = field('Name', inp('f-name', m.name, 'e.g. Sam Taylor')) +
      field('Email', inp('f-email', m.email, 'e.g. sam@example.com')) +
      field('Committee role', `<select id="f-role">${['Chair','Vice Chair','Secretary','Treasurer','Safeguarding Lead','Head Coach','Committee Member'].map((r) => `<option${m.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`) +
      field('Role start date', inp('f-rolestart', m.role_start, '', 'date')) +
      `<div class="fieldrow">
        <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink-soft)"><input type="checkbox" id="f-admin" ${m.is_admin ? 'checked' : ''} style="width:18px;height:18px"> Admin access</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink-soft)"><input type="checkbox" id="f-safeguarding" ${m.can_safeguarding ? 'checked' : ''} style="width:18px;height:18px"> Safeguarding access</label>
      </div>` +
      `<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink-soft);margin-bottom:13px"><input type="checkbox" id="f-finance" ${m.can_finance ? 'checked' : ''} style="width:18px;height:18px"> Finance access (Treasurer)</label>` +
      (isNew ? '' : `<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink-soft);margin-bottom:13px"><input type="checkbox" id="f-active" ${m.active ? 'checked' : ''} style="width:18px;height:18px"> Active (unticking removes portal access)</label>`) +
      (isNew ? `<div class="docnote">Saving sends them a real invite email straight away — no need to tell them to visit the site themselves.</div>` : '');
  } else if (kind === 'minutes') {
    const m = S.meetings.find((x) => x.id === id);
    title = 'Minutes — ready to copy';
    body = `<textarea id="f-minutes" style="min-height:260px;font-size:13px" readonly>${esc(minutesText(m))}</textarea>
      <div class="docnote" style="margin-top:10px">Long-press in the box to select all and copy, then paste into an email or document.</div>`;
    return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
      <h2 class="display">${title}</h2>${body}
      <div class="actions"><button class="btn btn-gold" data-close="1" style="flex:1">Done</button></div></div></div>`;
  }

  const VOID_KINDS = ['decision', 'incident', 'interest'];
  const isVoided = kind === 'decision' ? (S.decisions.find((x) => x.id === id) || {}).void
    : kind === 'incident' ? (S.incidents.find((x) => x.id === id) || {}).void
    : kind === 'interest' ? (S.interests.find((x) => x.id === id) || {}).void : false;
  return `<div class="overlay" id="overlay"><div class="sheet" role="dialog" aria-label="${title}">
    <h2 class="display">${title}</h2>${body}
    <div class="actions">
      ${isNew || kind === 'clubcomp' ? '' : VOID_KINDS.includes(kind)
        ? (isVoided ? '' : `<button class="btn btn-danger" data-voidask="${kind}:${id}">Mark void</button>`)
        : `<button class="btn btn-danger" data-del="${kind}:${id}">Delete</button>`}
      ${extraBtns}
      <button class="btn btn-ghost" data-close="1">Cancel</button>
      <button class="btn btn-gold" data-save="${kind}:${id}">Save</button>
    </div></div></div>`;
}
// ============================================================
// Navigation & shell
// ============================================================
const NAVMOB = [['home', 'Dashboard', ICONS.home], ['year', 'Club Year', ICONS.year], ['meetings', 'Meetings', ICONS.meetings], ['registers', 'Registers', ICONS.registers], ['more', 'More', ICONS.more]];
const NAVDESK = [['compliance', 'Compliance', ICONS.shield], ['finance', 'Finance', ICONS.coins], ['review', 'Season Review', ICONS.review], ['docs', 'Documents', ICONS.docs]];

function shellHtml(content) {
  const tab = TAB_OF[S.page] || 'home';
  const btn = ([id, label, icon], extra) => `
    <button class="${(extra || '')}${(id === tab && !(extra && id === 'more')) || S.page === id ? ' active' : ''}" data-go="${id}">${icon}<span>${label}</span></button>`;
  const desk = [...NAVDESK];
  if (CM.is_admin) desk.push(['members', 'Members', ICONS.members]);
  return `<div class="shell">
    <nav class="bottomnav" aria-label="Main">
      <div class="sidehead">
        <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers"></div>
        <div><div class="club">Swadlincote Lasers</div><div class="app-name display">Committee Portal</div></div>
      </div>
      ${NAVMOB.slice(0, 4).map((n) => btn(n)).join('')}
      ${btn(NAVMOB[4], 'mobonly')}
      ${desk.map((n) => btn(n, 'deskonly ')).join('')}
      <div class="sidefoot">${esc(CM.name)} · ${esc(CM.role)} · <a href="#" id="signout-link" style="color:inherit">Sign out</a></div>
    </nav>
    <div>
      <header class="topbar">
        <div class="crest"><img src="${LOGO}" alt="Swadlincote Lasers"></div>
        <div class="titles"><div class="club">Swadlincote Lasers</div><div class="app-name display">Committee Portal</div></div>
        <div class="who"><b>${esc(CM.name)}</b>${esc(CM.role)} · <a href="#" id="signout-link-mobile" style="color:inherit">Sign out</a></div>
      </header>
      <main>${content}</main>
    </div>
    ${modalHtml()}
    <div id="print-area" class="print-only"></div>
  </div>`;
}

function render() {
  if (!CM) return; // auth screens own the DOM until a member is resolved
  const pages = {
    home: dashboardPage, year: yearPage, meetings: meetingsPage, meeting: meetingPage, registers: registersPage,
    compliance: compliancePage, finance: financePage, review: reviewPage, docs: docsPage, more: morePage,
    incidents: incidentsPage, contacts: contactsPage, handover: handoverPage, membership: membershipPage,
    activity: activityPage, members: membersPage, search: searchPage, interests: interestsPage,
  };
  document.getElementById('app').innerHTML = shellHtml((pages[S.page] || dashboardPage)());
  bindRiskSliders();
  bindDocSearch();
  bindGlobalSearch();
  bindPrepList();
  const doSignOut = async (e) => { e.preventDefault(); await sb.auth.signOut(); };
  document.getElementById('signout-link')?.addEventListener('click', doSignOut);
  document.getElementById('signout-link-mobile')?.addEventListener('click', doSignOut);
}

function bindPrepList() {
  const list = document.getElementById('prep-list');
  const addBtn = document.getElementById('prep-add-row');
  if (!list || !addBtn) return;
  addBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'preprow';
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    row.innerHTML = `<input type="text" class="prep-item" placeholder="e.g. Book the venue" style="flex:1;border:1.5px solid var(--line);border-radius:8px;padding:9px 11px;background:#FCFBFE">
      <button type="button" class="btn btn-danger btn-sm" data-prep-row-del="1">✕</button>`;
    list.appendChild(row);
    row.querySelector('input').focus();
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-prep-row-del]')) e.target.closest('.preprow').remove();
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

function bindDocSearch() {
  const box = document.getElementById('doc-search');
  if (!box) return;
  box.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase();
    document.querySelectorAll('.docrow').forEach((r) => {
      r.style.display = !q || (r.dataset.search || '').includes(q) ? '' : 'none';
    });
  });
}

// ============================================================
// Mutations — every save/delete/void talks to Supabase, then
// updates the in-memory cache and re-renders.
// ============================================================
const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
const checkedBox = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

// ---------- Inline required-field validation (replaces silent no-op on empty fields) ----------
function requireFields(pairs) {
  // pairs: [[elementId, humanLabel], ...] — checked in order, stops at first empty one
  pairs.forEach(([id]) => { const el = document.getElementById(id); if (el) el.classList.remove('input-error'); });
  for (const [id, label] of pairs) {
    const el = document.getElementById(id);
    const value = el ? el.value.trim() : '';
    if (!value) {
      if (el) { el.classList.add('input-error'); el.focus(); }
      showToast(`Please fill in: ${label}`, 'error');
      return false;
    }
  }
  return true;
}

const TABLE_OF_KIND = {
  action: 'actions', decision: 'decisions', risk: 'risks', milestone: 'milestones', person: 'people',
  budget: 'budget', grant: 'grants', review: 'reviews', incident: 'incidents', policy: 'policies',
  contact: 'contacts', team: 'teams', doc: 'docs', member: 'members', interest: 'interests',
};
const labelFor = (obj) => obj.title || obj.name || obj.season || obj.interest || (obj.summary || '').slice(0, 40) || 'item';

async function uploadDocFile(docId, cat) {
  const fileInput = document.getElementById('f-file');
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) return null;
  const path = `${(cat || 'Other').replace(/\W+/g, '-')}/${docId}-${Date.now()}-${file.name}`;
  const { error } = await sb.storage.from('documents').upload(path, file, { upsert: false });
  if (error) { showToast('File upload failed: ' + error.message); return null; }
  return path;
}

async function openDocPath(path) {
  if (!path) return;
  const { data, error } = await sb.storage.from('documents').createSignedUrl(path, 60);
  if (error) { showToast('Could not open file: ' + error.message); return; }
  window.open(data.signedUrl, '_blank');
  const owner = S.docs.find((d) => d.file_path === path || (d.versions || []).some((v) => v.file_path === path));
  await log(`Opened document${owner ? ': ' + owner.name : ''}${owner && owner.file_path !== path ? ' (earlier version)' : ''}`);
}

async function openDoc(id) {
  const d = S.docs.find((x) => x.id === id);
  if (!d || !d.file_path) return;
  const { data, error } = await sb.storage.from('documents').createSignedUrl(d.file_path, 60);
  if (error) { showToast('Could not open file: ' + error.message); return; }
  window.open(data.signedUrl, '_blank');
  await log(`Opened document: ${d.name}`);
}

async function saveModal(kind, id) {
  const isNew = id === 'new';
  let payload = null;
  let justDeactivated = false;

  if (kind === 'action') {
    if (!requireFields([['f-title', 'What needs doing']])) return;
    payload = { title: val('f-title').trim(), owner: val('f-owner').trim(), due: val('f-due') || null, meeting: val('f-meeting').trim(), notes: val('f-notes') };
    if (isNew) payload.status = 'open';
  } else if (kind === 'decision') {
    if (!requireFields([['f-title', 'What was agreed']])) return;
    payload = { title: val('f-title').trim(), date: val('f-date') || null, proposer: val('f-proposer').trim(), seconder: val('f-seconder').trim(), meeting: val('f-meeting').trim(), notes: val('f-notes') };
  } else if (kind === 'risk') {
    if (!requireFields([['f-title', 'What could go wrong']])) return;
    payload = { title: val('f-title').trim(), owner: val('f-owner').trim(), mitigation: val('f-mitigation'), likelihood: Number(val('f-likelihood')) || 3, impact: Number(val('f-impact')) || 3, status: val('f-status') || 'open' };
  } else if (kind === 'milestone') {
    if (!requireFields([['f-title', 'Milestone name']])) return;
    const prepList = Array.from(document.querySelectorAll('#prep-list .prep-item'))
      .map((el) => el.value.trim()).filter(Boolean);
    payload = { title: val('f-title').trim(), date: val('f-date'), cat: val('f-cat'), notes: val('f-notes'), prep: prepList };
  } else if (kind === 'person') {
    if (!requireFields([['f-name', 'Name or initials']])) return;
    payload = { name: val('f-name').trim(), role: val('f-role').trim(), dbs: val('f-dbs') || null, safeguarding: val('f-safeguarding') || null, firstAid: val('f-firstAid') || null, licence: val('f-licence') || null };
  } else if (kind === 'clubcomp') {
    const patch = { affiliation: val('f-affiliation') || null, insurance: val('f-insurance') || null };
    const { error } = await sb.from('club_compliance').update(patch).eq('id', 1);
    if (error) { showToast(error.message); return; }
    S.clubComp = patch; await log('Updated club compliance dates');
    S.modal = null; render(); return;
  } else if (kind === 'meeting') {
    if (!requireFields([['f-title', 'Meeting title']])) return;
    const agenda = STANDING.map((t) => ({ id: uid(), title: t, notes: '' }));
    const { data, error } = await sb.from('meetings').insert({ title: val('f-title').trim(), date: val('f-date'), attendees: '', agenda }).select().single();
    if (error) { showToast(error.message); return; }
    S.meetings = [...S.meetings, data];
    await log('Created meeting: ' + data.title);
    S.modal = null; S.prefill = null; S.page = 'meeting'; S.meetingId = data.id; render(); return;
  } else if (kind === 'budget') {
    if (!requireFields([['f-title', 'Budget line name']])) return;
    payload = { name: val('f-title').trim(), type: val('f-type'), budget: Number(val('f-budget')) || 0, actual: Number(val('f-actual')) || 0 };
  } else if (kind === 'grant') {
    if (!requireFields([['f-title', 'Grant name']])) return;
    payload = { name: val('f-title').trim(), amount: Number(val('f-amount')) || 0, deadline: val('f-deadline') || null, status: val('f-status') };
  } else if (kind === 'review') {
    if (!requireFields([['f-season', 'Season']])) return;
    payload = { season: val('f-season').trim(), memStart: val('f-memStart'), memEnd: val('f-memEnd'), well: val('f-well'), hard: val('f-hard'), fin: val('f-fin'), vol: val('f-vol'), priorities: val('f-priorities') };
  } else if (kind === 'incident') {
    if (!requireFields([['f-summary', 'What happened']])) return;
    payload = { date: val('f-date'), type: val('f-type'), who: val('f-who').trim(), summary: val('f-summary'), actionTaken: val('f-action'), reportedTo: val('f-reported').trim(), status: val('f-status') };
  } else if (kind === 'policy') {
    if (!requireFields([['f-title', 'Policy name']])) return;
    payload = { name: val('f-title').trim(), lastReviewed: val('f-last') || null, nextReview: val('f-next') || null };
  } else if (kind === 'contact') {
    if (!requireFields([['f-title', 'Contact name']])) return;
    payload = { name: val('f-title').trim(), org: val('f-org').trim(), phone: val('f-phone').trim(), email: val('f-email').trim(), notes: val('f-notes') };
  } else if (kind === 'interest') {
    if (!requireFields([['f-title', 'Who is declaring'], ['f-notes', 'What the interest is']])) return;
    payload = { who: val('f-title').trim(), date: val('f-date') || today(), interest: val('f-notes').trim() };
  } else if (kind === 'handover') {
    const role = decodeURIComponent(id);
    const notes = val('f-notes');
    const { error } = await sb.from('handover').upsert({ role, notes, updated: today(), updated_by: CM.name });
    if (error) { showToast(error.message); return; }
    S.handover[role] = { notes, updated: today() };
    await log('Updated handover notes: ' + role);
    S.modal = null; render(); return;
  } else if (kind === 'team') {
    if (!requireFields([['f-title', 'Team name']])) return;
    payload = { name: val('f-title').trim(), players: Number(val('f-players')) || 0, subsExpected: Number(val('f-expected')) || 0, subsPaid: Number(val('f-paid')) || 0 };
  } else if (kind === 'doc') {
    if (!requireFields([['f-title', 'Document name']])) return;
    payload = { name: val('f-title').trim(), cat: val('f-cat'), version: val('f-version').trim(), where: val('f-where').trim(), notes: val('f-notes') };
    if (isNew) payload.uploaded_by = CM.name;
    else if ((document.getElementById('f-file') || {}).files && document.getElementById('f-file').files.length) payload.uploaded_by = CM.name;
  } else if (kind === 'member') {
    if (!requireFields([['f-name', 'Name'], ['f-email', 'Email address']])) return;
    const memberPayload = {
      name: val('f-name').trim(), email: val('f-email').trim().toLowerCase(), role: val('f-role'),
      is_admin: checkedBox('f-admin'), can_safeguarding: checkedBox('f-safeguarding'), can_finance: checkedBox('f-finance'),
      role_start: val('f-rolestart') || null,
    };
    if (isNew) {
      const { data, error } = await sb.functions.invoke('invite-member', { body: memberPayload });
      if (error) { showToast('Could not invite: ' + error.message); return; }
      if (data && data.error) { showToast('Could not invite: ' + data.error); return; }
      S.members = [...S.members, data.member];
      await log(`Invited member: ${data.member.name}${data.inviteSent ? '' : ' — invite email failed to send, ask them to visit the site directly'}`);
      S.modal = null; render(); return;
    }
    const wasActive = (S.members.find((x) => x.id === id) || {}).active;
    payload = { ...memberPayload, active: checkedBox('f-active') };
    justDeactivated = wasActive && !payload.active;
  }

  if (!payload) { S.modal = null; render(); return; }

  const table = TABLE_OF_KIND[kind];
  const dbPayload = toDb(table, payload);
  const result = isNew
    ? await sb.from(table).insert(dbPayload).select().single()
    : await sb.from(table).update(dbPayload).eq('id', id).select().single();
  if (result.error) {
    // PGRST116: the save was blocked at the database level (RLS) because the signed-in
    // account doesn't have the required role for this change — surfaces as "0 rows
    // returned" rather than a clear permission error, so translate it here.
    const isPermissionBlock = result.error.code === 'PGRST116' || /coerce the result/i.test(result.error.message || '');
    showToast(isPermissionBlock ? 'You don\u2019t have permission to make this change. Ask another admin.' : result.error.message);
    return;
  }
  let row = fromDb(table, result.data);

  // Document file upload happens after the row exists, so we have an id for the storage path.
  // If this doc already had a file, keep it in the versions list — never overwritten, never lost.
  if (kind === 'doc') {
    const path = await uploadDocFile(row.id, row.cat);
    if (path) {
      const priorVersions = Array.isArray(row.versions) ? row.versions : [];
      const newVersions = row.file_path
        ? [...priorVersions, { file_path: row.file_path, version: row.version || '', uploaded_by: row.uploaded_by || '', archived_at: today() }]
        : priorVersions;
      const { data: updated } = await sb.from('docs').update({ file_path: path, versions: newVersions }).eq('id', row.id).select().single();
      if (updated) row = fromDb('docs', updated);
      await log(`Uploaded new version of document: ${row.name}${newVersions.length ? ` (previous version kept, ${newVersions.length} in history)` : ''}`);
    }
  }

  S[table] = isNew ? [...S[table], row] : S[table].map((x) => x.id === id ? row : x);
  await log(`${isNew ? 'Added' : 'Updated'} ${kind}: ${labelFor(payload)}`);
  if (justDeactivated) {
    await log(`Deactivated member: ${row.name} — opening offboarding checklist`);
    S.modal = 'offboard:' + id;
  } else {
    S.modal = null;
  }
  S.prefill = null; render();
}

async function saveOffboarding(memberId) {
  const items = {};
  OFFBOARD_ITEMS.forEach((_, i) => { items[i] = !!(document.getElementById('ob-item-' + i) || {}).checked; });
  const notes = val('ob-notes');
  const payload = { items, notes, completed_by: CM.name, completed_at: today() };
  const { data, error } = await sb.from('members').update({ offboarding: payload }).eq('id', memberId).select().single();
  if (error) { showToast(error.message); return; }
  S.members = S.members.map((m) => m.id === memberId ? data : m);
  await log(`Updated offboarding checklist: ${data.name}`);
  S.modal = null; render();
}

async function voidItem(kind, id, reason) {
  const stamp = { when: today(), who: CM.name, reason: (reason || '').trim() };
  const table = TABLE_OF_KIND[kind];
  const { data, error } = await sb.from(table).update({ void: stamp }).eq('id', id).select().single();
  if (error) { showToast(error.message); return; }
  const row = fromDb(table, data);
  S[table] = S[table].map((x) => x.id === id ? row : x);
  await log(`Voided ${kind}: ${labelFor(row)}${reason ? ' — ' + reason : ''}`);
  S.modal = null; render();
}

// Confirmation now happens via the branded "delconfirm" modal before this is ever called —
// see the data-del / data-delconfirm handling in the event delegation below.
async function deleteItem(kind, id) {
  const table = TABLE_OF_KIND[kind];
  const item = S[table].find((x) => x.id === id) || {};
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) { showToast(error.message); return; }
  S[table] = S[table].filter((x) => x.id !== id);
  await log(`Deleted ${kind}: ${labelFor(item)}`);
  S.modal = null; render();
}

async function toggleAction(id) {
  const a = S.actions.find((x) => x.id === id);
  if (!a) return;
  const newStatus = a.status === 'open' ? 'done' : 'open';
  const { data, error } = await sb.from('actions').update({ status: newStatus }).eq('id', id).select().single();
  if (error) { showToast(error.message); return; }
  S.actions = S.actions.map((x) => x.id === id ? data : x);
  await log(`${newStatus === 'done' ? 'Completed' : 'Reopened'} action: ${a.title}`);
  render();
}

async function ackPolicy(policyId) {
  const p = S.policies.find((x) => x.id === policyId);
  if (!p) return;
  const { data, error } = await sb.from('policy_acks')
    .insert({ policy_id: policyId, who: CM.name, acknowledged_version: p.lastReviewed || null })
    .select().single();
  if (error) { showToast(error.message); return; }
  S.policy_acks = [...S.policy_acks, data];
  await log(`Acknowledged policy: ${p.name}`);
  render();
}

async function toggleMilestone(id) {
  const m = S.milestones.find((x) => x.id === id);
  if (!m) return;
  const { data, error } = await sb.from('milestones').update({ done: !m.done }).eq('id', id).select().single();
  if (error) { showToast(error.message); return; }
  S.milestones = S.milestones.map((x) => x.id === id ? data : x);
  render();
}

async function updateMeeting(id, patch) {
  const { data, error } = await sb.from('meetings').update(patch).eq('id', id).select().single();
  if (error) { console.error(error); return; }
  S.meetings = S.meetings.map((m) => m.id === id ? data : m);
}

async function addPrepActions(milestoneId) {
  const m = S.milestones.find((x) => x.id === milestoneId);
  if (!m || !m.prep || !m.prep.length) return;
  const due = new Date(m.date + 'T00:00'); due.setDate(due.getDate() - 14);
  const dueIso = due.toISOString().slice(0, 10);
  const rows = m.prep.map((p) => ({ title: p, owner: '', due: dueIso, meeting: m.title, notes: '', status: 'open' }));
  const { data, error } = await sb.from('actions').insert(rows).select();
  if (error) { showToast(error.message); return; }
  S.actions = [...S.actions, ...data];
  await log(`Added ${data.length} prep actions from milestone: ${m.title}`);
  S.modal = null; render();
}

// The export payload — shared by the Export button and the export preview modal, so the
// two can never drift apart. Everyone gets the full open registers plus the complete audit
// trail (the audit log is already visible to every signed-in member on Activity, so this
// adds nothing new). Named DBS/safeguarding detail and the committee roster mirror the same
// restriction used on-screen: people to Safeguarding Lead/Chair, members to admins only.
function exportPayload() {
  const payload = { exportedAt: new Date().toISOString(), actions: S.actions, decisions: S.decisions, risks: S.risks,
    milestones: S.milestones, clubComp: S.clubComp, meetings: S.meetings, budget: S.budget,
    grants: S.grants, reviews: S.reviews, incidents: S.incidents, policies: S.policies, contacts: S.contacts,
    handover: S.handover, teams: S.teams, docs: S.docs, audit: S.audit };
  if (CM.can_safeguarding || CM.is_admin) payload.people = S.people;
  if (CM.is_admin) payload.members = S.members;
  return payload;
}

function doExport() {
  const payload = exportPayload();
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lasers-committee-backup-' + today() + '.json';
    a.click();
  } catch (e) { console.error(e); }
  S.modal = 'export:all'; render();
}

// ============================================================
// Event delegation
// ============================================================
// Wraps an async action with a disabled/"Saving…" button state, so a slow connection
// can't result in a double-submit and the user gets visible confirmation their tap registered.
function withSavingState(btn, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  Promise.resolve(fn()).finally(() => {
    // If the save succeeded, render() will have already replaced this button's whole
    // parent tree (modal closed) — isConnected guards against touching a detached node.
    if (btn.isConnected) { btn.disabled = false; btn.textContent = original; }
  });
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'overlay') { S.modal = null; S.prefill = null; render(); return; }
  const t = e.target.closest('[data-go],[data-modal],[data-filter],[data-reg],[data-toggle],[data-ms-toggle],'
    + '[data-save],[data-del],[data-delconfirm],[data-voidask],[data-voidconfirm],[data-close],[data-open-meeting],[data-ag-add],[data-ag-del],[data-ag-to-decision],'
    + '[data-quick-action],[data-quick-decision],[data-minutes],[data-prep],[data-export],[data-doccat],[data-open-doc],'
    + '[data-open-docpath],[data-print-minutes],[data-ical-meeting],[data-ical-milestone],[data-offboard],[data-save-offboard],[data-ack-policy],'
    + '[data-search-go]');
  if (!t) return;
  const d = t.dataset;
  if (d.go) { S.page = d.go; render(); }
  else if (d.filter) { S.filter = d.filter; render(); }
  else if (d.reg) { S.reg = d.reg; render(); }
  else if (d.doccat) { S.docCat = d.doccat; render(); }
  else if (d.toggle) { toggleAction(d.toggle); }
  else if (d.msToggle) { toggleMilestone(d.msToggle); }
  else if (d.openMeeting) { S.page = 'meeting'; S.meetingId = d.openMeeting; render(); }
  else if (d.openDoc) { openDoc(d.openDoc); }
  else if (d.ackPolicy) { ackPolicy(d.ackPolicy); }
  else if (d.openDocpath) { openDocPath(d.openDocpath); }
  else if (d.printMinutes) { printMinutes(d.printMinutes); }
  else if (d.icalMeeting) {
    const m = S.meetings.find((x) => x.id === d.icalMeeting);
    if (m) downloadICS({ title: m.title, description: 'Swadlincote Lasers committee meeting', date: m.date });
  }
  else if (d.icalMilestone) {
    const m = S.milestones.find((x) => x.id === d.icalMilestone);
    if (m) downloadICS({ title: m.title, description: (m.prep || []).join('; '), date: m.date });
  }
  else if (d.offboard) { S.modal = 'offboard:' + d.offboard; render(); }
  else if (d.saveOffboard) { withSavingState(t, () => saveOffboarding(d.saveOffboard)); }
  else if (d.agAdd) {
    const input = document.getElementById('ag-new');
    const byInput = document.getElementById('ag-new-by');
    if (input && input.value.trim()) {
      const m = S.meetings.find((x) => x.id === d.agAdd);
      if (m) updateMeeting(d.agAdd, { agenda: [...m.agenda, { id: uid(), title: input.value.trim(), notes: '', proposedBy: (byInput && byInput.value.trim()) || '' }] }).then(render);
    }
  }
  else if (d.agDel) {
    const [mid, iid] = d.agDel.split(':');
    const m = S.meetings.find((x) => x.id === mid);
    if (m) updateMeeting(mid, { agenda: m.agenda.filter((i) => i.id !== iid) }).then(render);
  }
  else if (d.agToDecision) {
    const [mid, iid] = d.agToDecision.split(':');
    const m = S.meetings.find((x) => x.id === mid);
    const item = m && m.agenda.find((a) => a.id === iid);
    if (m && item) {
      S.prefill = { meeting: mref(m), title: item.title, proposer: item.proposedBy || '' };
      S.modal = 'decision:new';
      render();
    }
  }
  else if (d.quickAction !== undefined) { S.prefill = { meeting: d.quickAction }; S.modal = 'action:new'; render(); }
  else if (d.quickDecision !== undefined) { S.prefill = { meeting: d.quickDecision }; S.modal = 'decision:new'; render(); }
  else if (d.minutes) { S.modal = 'minutes:' + d.minutes; render(); }
  else if (d.prep) { addPrepActions(d.prep); }
  else if (d.export) { doExport(); }
  else if (d.modal) { S.modal = d.modal; render(); }
  else if (d.close) { S.modal = null; S.prefill = null; render(); }
  else if (d.save) { const [k, i] = d.save.split(':'); withSavingState(t, () => saveModal(k, i)); }
  else if (d.del) { S.modal = 'delconfirm:' + d.del; render(); }
  else if (d.delconfirm) {
    const rest = d.delconfirm; const sep = rest.indexOf(':');
    const k = rest.slice(0, sep), i = rest.slice(sep + 1);
    withSavingState(t, () => deleteItem(k, i));
  }
  else if (d.voidask) { S.modal = 'voidconfirm:' + d.voidask; render(); }
  else if (d.voidconfirm) {
    const rest = d.voidconfirm; const sep = rest.indexOf(':');
    const k = rest.slice(0, sep), i = rest.slice(sep + 1);
    const reason = (document.getElementById('void-reason') || {}).value || '';
    withSavingState(t, () => voidItem(k, i, reason));
  }
  else if (d.searchGo) {
    if (d.searchReg) S.reg = d.searchReg;
    if (d.searchMeeting) S.meetingId = d.searchMeeting;
    S.page = d.searchGo;
    render();
  }
});


// Meeting attendees / minutes textareas save on change without a full re-render
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-set]');
  if (!t) return;
  const parts = t.dataset.set.split(':');
  if (parts[0] === 'attendees') updateMeeting(parts[1], { attendees: t.value });
  else if (parts[0] === 'minutes') {
    const m = S.meetings.find((x) => x.id === parts[1]);
    if (m) updateMeeting(parts[1], { agenda: m.agenda.map((i) => i.id === parts[2] ? { ...i, notes: t.value } : i) });
  }
});
