import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const root = process.argv[2] ?? new URL('../..', import.meta.url).pathname;
const db = new PGlite({ extensions: { citext, pgcrypto } });
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FAIL', msg); } };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = async (uid) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
const expectErr = async (fn, re, msg) => {
  try { await fn(); ok(false, msg + ' (no error)'); }
  catch (e) { ok(re.test(e.message), `${msg} -> "${e.message}"`); }
};

// --- Supabase stubs ---------------------------------------------------------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb, encrypted_password text, updated_at timestamptz);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
  create schema extensions;
  create extension pgcrypto with schema extensions;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert on storage.objects to authenticated;
  create schema net;
  create table net.calls (id serial primary key, url text, body jsonb);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id $$;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`);

for (const f of ['migrations/0001_schema.sql', 'migrations/0002_functions.sql', 'migrations/0003_security.sql', 'migrations/0004_profiles_wanted_discord.sql', 'migrations/0005_passphrase_login.sql', 'migrations/0006_admin_entry_and_review_alerts.sql', 'migrations/0007_tavern_results_and_admin_tools.sql', 'seed.sql', 'seed_most_wanted.sql']) {
  await db.exec(fs.readFileSync(`${root}/supabase/${f}`, 'utf8'));
  console.log('loaded', f);
}

// --- Users ------------------------------------------------------------------
const mk = async (email) => (await q(`insert into auth.users (email) values ($1) returning id`, [email]))[0].id;
const adminA = await mk('a@x'), adminB = await mk('b@x');
const P = [];
for (let i = 1; i <= 7; i++) P.push(await mk(`p${i}@x`));
await q(`update profiles set role = 'admin' where id in ($1, $2)`, [adminA, adminB]);
ok((await q(`select count(*)::int n from profiles`))[0].n === 9, 'profiles created by trigger');

// --- Board ------------------------------------------------------------------
let board = await q(`select * from get_board()`);
ok(board.filter(b => b.tier === 'main').length === 12, `12 main slots on board (${board.length} total)`);
const wanted0 = board.filter(b => b.tier === 'wanted');
ok(wanted0.length === 2 && wanted0.map(b => b.title).join() === "The Warden's Fall,Angel of Death", `2 Most Wanted slots filled (${wanted0.map(b => b.title).join(', ')})`);
ok(wanted0.every(b => b.min_reputation === 250), 'Most Wanted contracts carry their reputation requirement');
board = board.filter(b => b.tier === 'main');
ok(board.every(b => b.contract_id), 'every slot filled at launch');
const titles = board.map(b => b.title).sort();
console.log('   board:', titles.join(', '));
ok(titles.includes('Royal Pain') && titles.includes('The Fashion Criminal') && !titles.includes('Barrows Bounty'), 'launch contracts are the Start ones');

const royal = board.find(b => b.title === 'Royal Pain');

// --- Claims -----------------------------------------------------------------
await as(P[0]);
await expectErr(() => q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/a'], '{}')`, [royal.contract_id]), /display name/, 'cannot claim without display name');
for (let i = 0; i < 7; i++) { await as(P[i]); await q(`select set_display_name($1)`, [`Hunter ${i + 1}`]); }
await as(P[1]);
await expectErr(() => q(`select set_display_name('hunter 1')`), /already registered/, 'display names unique, case-insensitive');
await expectErr(() => q(`select set_display_name('this name is far too long')`), /1–12/, 'display name format enforced');

const subs = [];
for (let i = 0; i < 6; i++) {
  await as(P[i]);
  subs.push((await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/${i}'], '{}', 'done') as id`, [royal.contract_id]))[0].id);
}
await as(P[0]);
await expectErr(() => q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/x'], '{}')`, [royal.contract_id]), /already have/, 'second open claim on same contract blocked');
await expectErr(() => q(`select submit_claim(gen_random_uuid(), $1, array['http://imgur.com/x'], '{}')`, [board[1].contract_id]), /https/, 'non-https links rejected');
await expectErr(() => q(`select submit_claim('11111111-1111-1111-1111-111111111111', $1, '{}', array['someone/else.png'])`, [board[1].contract_id]), /Invalid evidence/, 'evidence file outside own folder rejected');

// Evidence file path check
const sid = '22222222-2222-2222-2222-222222222222';
await expectErr(() => q(`select submit_claim($1, $2, '{}', array[$3])`, [sid, board[1].contract_id, `${P[0]}/${sid}/a.png`]), /not found/, 'evidence file must exist in storage');
await q(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [`${P[0]}/${sid}/a.png`]);
await q(`select submit_claim($1, $2, '{}', array[$3])`, [sid, board[1].contract_id, `${P[0]}/${sid}/a.png`]);
ok(true, 'claim with uploaded screenshot accepted');

// Player cannot approve
await expectErr(() => q(`select review_submission($1, true)`, [subs[0]]), /Only admins/, 'players cannot review');

// Admin self-review blocked
await as(adminA); await q(`select set_display_name('Admin A')`);
const ownSub = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/me'], '{}') as id`, [board[2].contract_id]))[0].id;
await expectErr(() => q(`select review_submission($1, true)`, [ownSub]), /own claim/, 'admins cannot approve their own claim');

// Reject one, then approve five
const r0 = (await q(`select review_submission($1, false, 'Codeword missing') r`, [subs[5]]))[0].r;
ok(r0.status === 'rejected', 'rejection recorded');
await as(P[5]);
const resub = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/again'], '{}') as id`, [royal.contract_id]))[0].id;
ok(!!resub, 'rejected player can resubmit');
await as(P[6]);
const lateSub = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/late'], '{}') as id`, [royal.contract_id]))[0].id;

await as(adminA);
let last;
for (let i = 0; i < 5; i++) last = (await q(`select review_submission($1, true) r`, [subs[i]]))[0].r;
console.log('   fifth approval ->', JSON.stringify(last));
ok(last.retired === true, 'fifth approval retires the contract');
ok(last.replacement === 'Barrows Bounty', `replacement is next PvM in pool (${last.replacement})`);
const rp = (await q(`select status, approved_count, retired_at from contracts where id = $1`, [royal.contract_id]))[0];
ok(rp.status === 'retired' && rp.approved_count === 5 && rp.retired_at, 'Royal Pain retired with 5 claims');
const closed = await q(`select status, review_note from submissions where id in ($1, $2)`, [resub, lateSub]);
ok(closed.every(s => s.status === 'closed'), 'remaining pending claims closed');
await expectErr(() => q(`select review_submission($1, true)`, [resub]), /no longer pending/, 'closed claim cannot be approved');
await expectErr(() => q(`select review_submission($1, true)`, [subs[0]]), /no longer pending/, 'approved claim cannot be approved twice');

board = (await q(`select * from get_board()`)).filter(b => b.tier === 'main');
ok(board.length === 12 && !board.some(b => b.title === 'Royal Pain'), 'board still 12 slots, Royal Pain gone');
ok((await q(`select count(*)::int n from (select contract_id from board_slots where contract_id is not null group by contract_id having count(*) > 1) d`))[0].n === 0, 'no duplicate live contracts');

// Reputation
const lb = await q(`select * from get_leaderboard()`);
console.log('   leaderboard:', lb.map(r => `${r.place}. ${r.rs_name} ${r.reputation}`).join(' | '));
ok(lb.length === 5 && lb.every(r => Number(r.reputation) === 20), 'five players with 20 rep each');
ok(lb[0].rs_name === 'Hunter 1', 'tie broken by who reached the total first');
await expectErr(() => q(`insert into reputation_events (player_id, amount, source, category, contract_id, submission_id) values ($1, 20, 'claim', 'pvm', $2, $3)`, [P[0], royal.contract_id, resub]), /duplicate|unique/, 'duplicate award blocked by unique index');
ok((await q(`select count(*)::int n from get_leaderboard('skilling')`))[0].n === 0, 'skilling leaderboard empty');

await q(`select adjust_reputation($1, 100, 'Event opening bonus', 'bonus')`, [P[0]]);
const s0 = (await q(`select * from get_player_summary($1)`, [P[0]]))[0];
ok(Number(s0.reputation) === 120 && s0.rank_name === 'Bounty Hunter' && s0.next_rank_name === 'Veteran Hunter', `player summary rank (${s0.rank_name}, next ${s0.next_rank_name} at ${s0.next_rank_at})`);
ok((await q(`select * from get_leaderboard('pvm')`))[0].reputation == 20, 'bonus not counted in PvM board');

// Archive
const arc = await q(`select * from get_archive()`);
ok(arc.length === 1 && arc[0].claimants.length === 5, 'archive shows retired contract with 5 claimants');

// --- Manual rotation --------------------------------------------------------
const special = board.filter(b => b.category === 'special');
const r1 = (await q(`select rotate_slot($1, 'return') r`, [special[0].slot_id]))[0].r;
ok(r1.new === 'Star Chaser', `return-to-pool installs next pool contract (${r1.new})`);
const pool = (await q(`select id from contracts where title = 'Master of Clues'`))[0].id;
const r2 = (await q(`select rotate_slot($1, 'retire', $2) r`, [special[1].slot_id, pool]))[0].r;
ok(r2.new === 'Master of Clues', 'retire + chosen replacement');
const royalId = (await q(`select id from contracts where title='Royal Pain'`))[0].id;
await expectErr(() => q(`select rotate_slot($1, 'retire', $2) r`, [special[1].slot_id, royalId]), /not in the special pool/, 'retired/other-category contract cannot be installed');

// Drain the special pool
for (let i = 0; i < 10; i++) {
  const sl = (await q(`select id from board_slots where category = 'special' and contract_id is not null order by position limit 1`));
  if (!sl.length) break;
  await q(`select rotate_slot($1, 'retire')`, [sl[0].id]);
}
const sp = await q(`select state, contract_id from board_slots where category = 'special'`);
ok(sp.every(s => s.state === 'awaiting' && !s.contract_id), 'empty pool leaves slots awaiting');

// New pool contract fills an awaiting slot automatically
await q(`insert into contracts (title, category, difficulty, summary, status) values ('Fresh Trail', 'special', 'hard', 'New one', 'pool')`);
const sp2 = await q(`select b.state, c.title, c.reputation from board_slots b join contracts c on c.id = b.contract_id where b.category = 'special'`);
ok(sp2.length === 1 && sp2[0].title === 'Fresh Trail' && sp2[0].reputation === 30, 'new pool contract auto-fills awaiting slot with default 30 rep');

// Slot count change
await q(`update event_settings set slots_pvm = 6`);
ok((await q(`select count(*)::int n from board_slots where category='pvm' and contract_id is not null`))[0].n === 6, 'raising PvM slots to 6 fills new slot');
await q(`update event_settings set slots_pvm = 5`);
ok((await q(`select count(*)::int n from board_slots where category='pvm'`))[0].n === 5, 'lowering back to 5 removes a slot');

// Guard: direct lifecycle edits rejected
await expectErr(() => q(`update contracts set status = 'active' where title = 'Elder Grove'`), /board controls/, 'cannot put a contract live by direct edit');
await expectErr(() => q(`update contracts set approved_count = 0 where title = 'Royal Pain'`), /managed by the game/, 'cannot reset claim counts by direct edit');

// Pause
await q(`update event_settings set is_paused = true`);
await as(P[3]);
board = await q(`select * from get_board()`);
await expectErr(() => q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/z'], '{}')`, [board.find(b=>b.contract_id).contract_id]), /paused/, 'paused event blocks submissions');
await as(adminA); await q(`update event_settings set is_paused = false`);

// --- Public profiles ---------------------------------------------------------
const hunter = (await q(`select get_hunter('hunter 1') h`))[0].h;
ok(hunter && hunter.rs_name === 'Hunter 1' && hunter.claims.length === 1 && hunter.claims[0].title === 'Royal Pain', 'public profile lists approved bounties');
ok(Number(hunter.summary.reputation) === 120 && Number(hunter.bonus_total) === 100, 'public profile shows reputation and bonus total');
ok((await q(`select get_hunter('Nobody') h`))[0].h === null, 'unknown hunter returns nothing');

// --- Most Wanted tier ---------------------------------------------------------
let full = await q(`select * from get_board()`);
const warden = full.find(b => b.title === "The Warden's Fall");
await as(P[1]);   // Hunter 2 has 20 rep
await expectErr(() => q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/w'], '{}')`, [warden.contract_id]), /needs 250 reputation; you have 20/, 'Most Wanted claim blocked below the reputation requirement');
await as(P[0]);   // Hunter 1 has 120 rep
await expectErr(() => q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/w'], '{}')`, [warden.contract_id]), /needs 250/, 'bonus reputation counts but 120 is still short');
await as(adminA);
await q(`select adjust_reputation($1, 150, 'Test top-up', 'bonus')`, [P[0]]);
await as(P[0]);
const wSub = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/w'], '{}') id`, [warden.contract_id]))[0].id;
ok(!!wSub, 'Most Wanted claim accepted at 270 reputation');
await as(adminA);
await expectErr(() => q(`update contracts set min_reputation = 0 where id = $1`, [warden.contract_id]), /between the main board and Most Wanted/, 'live contract cannot switch tiers');
const elder = (await q(`select id from contracts where title = 'Elder Grove'`))[0].id;
await expectErr(() => q(`select rotate_slot($1, 'retire', $2)`, [warden.slot_id, elder]), /Most Wanted pool/, 'main-board contract cannot go into a Most Wanted slot');
const wr = (await q(`select rotate_slot($1, 'retire') r`, [warden.slot_id]))[0].r;
ok(wr.new === 'Master Tracker', `Most Wanted slot rotates to next Most Wanted contract (${wr.new})`);
ok((await q(`select status from submissions where id = $1`, [wSub]))[0].status === 'closed', 'pending Most Wanted claim closed on retirement');
await q(`update event_settings set slots_wanted = 3`);
full = await q(`select * from get_board()`);
ok(full.filter(b => b.tier === 'wanted').map(b => b.title).includes('Grove Guardian'), 'third Most Wanted slot takes the next one');
await q(`update event_settings set slots_wanted = 4`);
full = await q(`select * from get_board()`);
const emptyWanted = full.filter(b => b.tier === 'wanted' && !b.contract_id);
ok(emptyWanted.length === 1 && emptyWanted[0].category === null, 'empty Most Wanted slot waits with no category');
await q(`insert into contracts (title, category, difficulty, summary, min_reputation, status) values ('Late Addition', 'skilling', 'elite', 'x', 300, 'pool')`);
full = await q(`select * from get_board()`);
ok(full.some(b => b.tier === 'wanted' && b.title === 'Late Addition' && b.category === 'skilling'), 'new Most Wanted pool contract fills the empty slot');
ok(full.filter(b => b.tier === 'main').length === 12, 'main board untouched by Most Wanted changes');

// --- Discord posts --------------------------------------------------------------
await q(`update integration_settings set discord_webhook_url = 'https://discord.com/api/webhooks/123/abc', site_url = 'https://gmw.example'`);
await q(`truncate net.calls`);
await as(P[2]);
const kb = full.find(b => b.title === 'Long Live the King');
const dSub = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/k'], '{}') id`, [kb.contract_id]))[0].id;
await as(adminA);
await q(`select review_submission($1, true)`, [dSub]);
let calls = await q(`select url, body from net.calls order by id`);
ok(calls.length === 1 && calls[0].body.content.includes('**Hunter 3** claimed **Long Live the King** for 30 reputation (claim 1)'), `approval posted to Discord: ${calls[0]?.body.content}`);
ok(JSON.stringify(calls[0].body.allowed_mentions) === '{"parse":[]}', 'Discord posts cannot ping @everyone');
await q(`select send_discord_test()`);
ok((await q(`select count(*)::int n from net.calls`))[0].n === 2, 'admin test message sent');
await expectErr(() => q(`update integration_settings set discord_webhook_url = 'https://evil.example/hook'`), /check constraint/, 'only Discord webhook addresses accepted');
await q(`update integration_settings set notify_approvals = false`);
await q(`truncate net.calls`);
await as(P[3]);
const dSub2 = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/k2'], '{}') id`, [kb.contract_id]))[0].id;
await as(adminA);
await q(`select review_submission($1, true)`, [dSub2]);
ok((await q(`select count(*)::int n from net.calls`))[0].n === 0, 'approval posts can be switched off');

// --- Passphrase sign-in ------------------------------------------------------
const joinGames = async (name, code, email) => (await q(
  `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, encrypted_password)
   values ($1, '{"provider":"email","providers":["email"]}', $2, extensions.crypt('first-pass-phrase-11', extensions.gen_salt('bf')))
   returning id, raw_user_meta_data`,
  [email ?? `${Math.random().toString(16).slice(2, 18)}@players.gmw.invalid`, JSON.stringify({ rs_name: name, join_code: code })]))[0];
ok((await q(`select check_signup('Iron Pip') m`))[0].m === null, 'free name passes the sign-up check');
ok(/already registered/.test((await q(`select check_signup('hunter 1') m`))[0].m), 'taken name (any case) fails the sign-up check');
ok(/1–12/.test((await q(`select check_signup('x!') m`))[0].m), 'bad name fails the sign-up check');
const newbie = await joinGames('  Iron   Pip ', null);
ok((await q(`select rs_name from profiles where id = $1`, [newbie.id]))[0].rs_name === 'Iron Pip', 'sign-up creates the profile with a tidied RuneScape name');
await expectErr(() => joinGames('IRON PIP', null), /already registered/, 'second sign-up with the same name rejected');
await q(`update integration_settings set join_code = 'Lantern42'`);
ok((await q(`select signup_needs_code() n`))[0].n === true, 'site knows a join code is required');
ok(/join code/.test((await q(`select check_signup('Newcomer', 'nope') m`))[0].m), 'wrong join code fails the check');
await expectErr(() => joinGames('Newcomer', 'nope'), /join code/, 'wrong join code rejects the sign-up');
await expectErr(() => joinGames('Newcomer', null), /join code/, 'missing join code rejects the sign-up');
const coded = await joinGames('Newcomer', ' lantern42 ');
ok(!!coded.id, 'join code matches ignoring case and spaces');
ok(!('join_code' in coded.raw_user_meta_data), 'join code is not kept on the account');
const loginEmail = (await q(`select login_email_for('newcomer') e`))[0].e;
ok(/@players\.gmw\.invalid$/.test(loginEmail), `name looks up the placeholder login address (${loginEmail})`);
const realUser = (await q(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ('real@person.com', '{"provider":"email"}', '{"rs_name":"Realname","join_code":"lantern42"}') returning id`))[0].id;
ok((await q(`select login_email_for('Realname') e`))[0].e === null, 'a real email address is never revealed');
ok((await q(`select login_email_for('Nobody') e`))[0].e === null, 'unknown name gives nothing');
const oauth = (await q(`insert into auth.users (email, raw_app_meta_data) values ('d@discord.example', '{"provider":"discord"}') returning id`))[0].id;
ok((await q(`select count(*)::int n from profiles where id = $1 and rs_name is null`, [oauth]))[0].n === 1, 'other sign-in methods still get a profile (name picked later)');
await q(`update integration_settings set join_code = null`);

// Admin reset
await q(`insert into auth.sessions (user_id) values ($1), ($1)`, [newbie.id]);
await as(P[0]);
await expectErr(() => q(`select admin_set_passphrase($1, 'brand-new-passphrase-77')`, [newbie.id]), /Only admins/, 'players cannot reset passphrases');
await as(adminA);
await expectErr(() => q(`select admin_set_passphrase($1, 'short')`, [newbie.id]), /at least 16/, 'reset needs a long passphrase');
await expectErr(() => q(`select admin_set_passphrase($1, 'brand-new-passphrase-77')`, [realUser]), /Only passphrase accounts/, 'reset limited to passphrase accounts');
await q(`select admin_set_passphrase($1, 'brand-new-passphrase-77')`, [newbie.id]);
const pw = (await q(`select encrypted_password = extensions.crypt('brand-new-passphrase-77', encrypted_password) as new_ok,
                            encrypted_password = extensions.crypt('first-pass-phrase-11', encrypted_password) as old_ok,
                            left(encrypted_password, 4) as prefix from auth.users where id = $1`, [newbie.id]))[0];
ok(pw.new_ok && !pw.old_ok && pw.prefix === '$2a$', 'reset stores a bcrypt hash of the new passphrase and the old one stops working');
ok((await q(`select count(*)::int n from auth.sessions where user_id = $1`, [newbie.id]))[0].n === 0, 'reset signs the player out everywhere');
ok((await q(`select count(*)::int n from audit_log where action = 'player.passphrase_reset'`))[0].n === 1, 'reset is in the audit log');

// --- Admin claim entry ---------------------------------------------------------
full = await q(`select * from get_board()`);
const threeKings = full.find(b => b.title === 'The Three Kings');
const discordie = await joinGames('Discordie', null);   // account the admin created for a Discord-only player
await q(`update event_settings set starts_at = now() - interval '2 days'`);
const posted = new Date(Date.now() - 3 * 3600_000).toISOString();
const aSid = '33333333-3333-3333-3333-333333333333';
await q(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [`${discordie.id}/${aSid}/1.webp`]);
await as(P[0]);
await expectErr(() => q(`select admin_submit_claim($1, $2, $3, '{}', array[$4])`, [aSid, discordie.id, threeKings.contract_id, `${discordie.id}/${aSid}/1.webp`]), /Only admins/, 'players cannot enter claims for others');
await as(adminA);
await expectErr(() => q(`select admin_submit_claim(gen_random_uuid(), $1, $2, array['https://imgur.com/x'], '{}')`, [adminA, threeKings.contract_id]), /normal claim form/, 'admins cannot enter claims for themselves');
await expectErr(() => q(`select admin_submit_claim(gen_random_uuid(), $1, $2, array['https://imgur.com/x'], '{}', '', now() + interval '1 day')`, [discordie.id, threeKings.contract_id]), /future/, 'posted time cannot be in the future');
await expectErr(() => q(`select admin_submit_claim(gen_random_uuid(), $1, $2, array['https://imgur.com/x'], '{}', '', now() - interval '30 days')`, [discordie.id, threeKings.contract_id]), /during the event/, 'posted time must be during the event');
await q(`update event_settings set is_paused = true`);
const entered = (await q(`select admin_submit_claim($1, $2, $3, '{}', array[$4], 'Posted in #bounties', $5, false) r`,
  [aSid, discordie.id, threeKings.contract_id, `${discordie.id}/${aSid}/1.webp`, posted]))[0].r;
await q(`update event_settings set is_paused = false`);
const eRow = (await q(`select status, submitted_at, player_note from submissions where id = $1`, [aSid]))[0];
ok(entered.status === 'pending' && eRow.status === 'pending', 'admin can enter a claim (even while paused) and leave it pending');
ok(Math.abs(new Date(eRow.submitted_at) - new Date(posted)) < 1000, 'claim keeps the Discord posting time for queue order');
ok(eRow.player_note.startsWith('Entered by an admin from Discord.'), 'claim is labelled as entered by an admin');
await expectErr(() => q(`select admin_submit_claim(gen_random_uuid(), $1, $2, array['https://imgur.com/y'], '{}')`, [discordie.id, threeKings.contract_id]), /already has a pending or approved claim/, 'duplicate claim for the same player blocked');
const otherBounty = full.find(b => b.title === 'Shark Supper');
const approvedNow = (await q(`select admin_submit_claim(gen_random_uuid(), $1, $2, array['https://discord.com/channels/1/2/3'], '{}', '', null, true) r`, [discordie.id, otherBounty.contract_id]))[0].r;
ok(approvedNow.status === 'approved', 'admin can enter and approve in one step');
const dRep = (await q(`select * from get_player_summary($1)`, [discordie.id]))[0];
ok(Number(dRep.reputation) === 20, 'Discord-only player earns reputation like anyone else');
ok((await q(`select count(*)::int n from audit_log where action = 'submission.entered_by_admin'`))[0].n === 2, 'admin entries are in the audit log');
const wardenNow = full.find(b => b.tier === 'wanted' && b.contract_id);
await expectErr(() => q(`select admin_submit_claim(gen_random_uuid(), $1, $2, array['https://imgur.com/z'], '{}')`, [discordie.id, wardenNow.contract_id]), /needs/, 'Most Wanted reputation rule applies to admin entries too');

// --- Review heads-up --------------------------------------------------------------
await q(`update profiles set reviews_seen_at = now() - interval '1 hour' where id = $1`, [discordie.id]);
await as(discordie.id);
ok((await q(`select my_unseen_reviews() n`))[0].n === 1, 'player sees one newly reviewed claim');
const prevSeen = (await q(`select mark_reviews_seen() t`))[0].t;
ok(!!prevSeen && (await q(`select my_unseen_reviews() n`))[0].n === 0, 'opening My bounties clears the heads-up and returns the previous time');
await as(adminA);
await q(`select review_submission($1, false, 'Codeword not visible')`, [aSid]);
await as(discordie.id);
ok((await q(`select my_unseen_reviews() n`))[0].n === 1, 'a later rejection shows up as new');
await as(adminA);

// --- Revoking an approval -------------------------------------------------------
full = await q(`select * from get_board()`);
const kingSlot = full.find(b => b.title === 'Long Live the King');
const kingBefore = kingSlot.approved_count;
const hunter4Before = Number((await q(`select * from get_player_summary($1)`, [P[3]]))[0].reputation);
const hunter4Claim = (await q(`select id from submissions where contract_id = $1 and player_id = $2 and status = 'approved'`, [kingSlot.contract_id, P[3]]))[0].id;
await as(P[0]);
await expectErr(() => q(`select revoke_approval($1, 'oops')`, [hunter4Claim]), /Only admins/, 'players cannot revoke approvals');
await as(adminA);
await expectErr(() => q(`select revoke_approval($1, '')`, [hunter4Claim]), /reason/, 'revoking needs a reason');
const rv = (await q(`select revoke_approval($1, 'Wrong boss in screenshot') r`, [hunter4Claim]))[0].r;
ok(rv.reputation_removed === 30 && rv.claims === kingBefore - 1, `revoke removes the 30 reputation and frees the slot (${kingBefore} -> ${rv.claims})`);
ok(Number((await q(`select * from get_player_summary($1)`, [P[3]]))[0].reputation) === hunter4Before - 30, "player's total drops by the revoked award");
const rvRow = (await q(`select status, review_note from submissions where id = $1`, [hunter4Claim]))[0];
ok(rvRow.status === 'rejected' && rvRow.review_note === 'Approval revoked: Wrong boss in screenshot', 'player sees the claim as rejected with the reason');
await expectErr(() => q(`select revoke_approval($1, 'again')`, [hunter4Claim]), /Only approved/, 'cannot revoke twice');
await as(P[3]);
const reSub = (await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/fixed'], '{}') id`, [kingSlot.contract_id]))[0].id;
await as(adminA);
ok((await q(`select review_submission($1, true) r`, [reSub]))[0].r.status === 'approved', 'player can resubmit and be approved again after a revoke');
ok((await q(`select count(*)::int n from audit_log where action = 'submission.revoked'`))[0].n === 1, 'revokes are in the audit log');

// --- Pending counts, activity, results ----------------------------------------------
full = await q(`select * from get_board()`);
ok(full.every(b => b.contract_id === null || typeof b.pending_count === 'number'), 'board reports pending counts');
await as(P[4]);
const pend = full.find(b => b.title === 'Golden Touch');
await q(`select submit_claim(gen_random_uuid(), $1, array['https://imgur.com/g'], '{}')`, [pend.contract_id]);
await as(adminA);
ok((await q(`select pending_count from get_board() where contract_id = $1`, [pend.contract_id]))[0].pending_count === 1, 'pending claim shows on the poster count');
const act = await q(`select * from get_activity(50)`);
ok(act.some(a => a.kind === 'claim' && a.player === 'Hunter 4' && a.title === 'Long Live the King'), 'activity lists approved claims with names');
ok(act.some(a => a.kind === 'retired' && a.title === 'Royal Pain'), 'activity lists fully claimed bounties');
ok(act.some(a => a.kind === 'posted' && a.title && a.contract_id), 'activity lists new bounties with links');
ok(act.filter(a => a.kind === 'claim' && a.player === 'Hunter 4' && a.title === 'Long Live the King').length === 1, 'revoked approval drops out of the activity feed');
const stats = (await q(`select get_event_stats() s`))[0].s;
ok(stats.podium.length >= 3 && stats.podium[0].rs_name === 'Hunter 1', `results podium (${stats.podium.map(p => p.rs_name).join(', ')})`);
ok(stats.category_winners.pvm.length >= 1 && Array.isArray(stats.category_winners.special), 'results include category winners');
ok(stats.bounties_claimed === 1 && stats.fastest && stats.fastest.title === 'Royal Pain', 'results include the fastest claimed bounty');
ok(Number(stats.claims) > 0 && Number(stats.hunters) > 0 && stats.busiest, 'results include totals and the busiest bounty');

// --- Tavern chat -------------------------------------------------------------------
await as(P[0]);
const m1 = (await q(`select post_chat('Royal Pain was mine first, nerds') id`))[0].id;
ok(!!m1, 'players can post in the Tavern');
await expectErr(() => q(`select post_chat('Royal Pain was mine first, nerds')`), /just said that/, 'duplicate message blocked');
await expectErr(() => q(`select post_chat('   ')`), /Say something/, 'empty message blocked');
await expectErr(() => q(`select post_chat($1)`, ['x'.repeat(501)]), /500/, 'long message blocked');
await q(`select post_chat('two')`); await q(`select post_chat('three')`); await q(`select post_chat('four')`);
await expectErr(() => q(`select post_chat('five')`), /Slow down/, 'rapid posting slowed down');
let chat = await q(`select * from get_chat()`);
ok(chat.length === 4 && chat[0].rs_name === 'Hunter 1' && chat[0].rank_name, 'chat shows names and rank titles, oldest first');
await as(P[1]);
await expectErr(() => q(`select delete_chat($1)`, [m1]), /your own/, "players cannot delete others' messages");
await as(adminA);
await q(`select delete_chat($1)`, [m1]);
ok((await q(`select count(*)::int n from get_chat()`))[0].n === 3, 'admin deletes a message');
await q(`select set_player_muted($1, true)`, [P[1]]);
await as(P[1]);
await expectErr(() => q(`select post_chat('let me talk')`), /muted/, 'muted player cannot post');
await as(adminA);
await q(`select set_player_muted($1, false)`, [P[1]]);
await as('');
await expectErr(() => q(`select post_chat('anon')`), /Sign in/, 'guests cannot post');
await as(adminA);

// --- Daily Discord standings --------------------------------------------------------------
await q(`truncate net.calls`);
await q(`update integration_settings set daily_post_hour = null, last_daily_post_on = null, final_posted = false, notify_approvals = true`);
ok((await q(`select post_daily_leaderboard() r`))[0].r === 'daily post off', 'no daily post unless an hour is set');
const londonHour = (await q(`select extract(hour from now() at time zone 'Europe/London')::int h`))[0].h;
await q(`update integration_settings set daily_post_hour = $1`, [londonHour]);
ok((await q(`select post_daily_leaderboard() r`))[0].r === 'posted', 'posts at the chosen London hour');
ok((await q(`select post_daily_leaderboard() r`))[0].r === 'already posted today', 'only once a day');
let post = (await q(`select body from net.calls order by id desc limit 1`))[0].body.content;
ok(/Standings, day \d+ of \d+/.test(post) && post.includes(':first_place: **Hunter 1**'), `daily post content: ${post.split('\n')[0]}`);
await q(`update integration_settings set daily_post_hour = $1`, [(londonHour + 1) % 24]);
ok((await q(`select post_daily_leaderboard() r`))[0].r === 'not the hour', 'waits for the chosen hour');
await q(`select send_standings_now()`);
ok((await q(`select count(*)::int n from net.calls`))[0].n === 2, 'admin can post standings on demand');
await q(`update event_settings set ends_at = now() - interval '1 minute', starts_at = now() - interval '14 days'`);
ok((await q(`select post_daily_leaderboard() r`))[0].r === 'final posted', 'final standings posted when the event ends');
ok((await q(`select post_daily_leaderboard() r`))[0].r === 'final already posted', 'final standings posted only once');
post = (await q(`select body from net.calls order by id desc limit 1`))[0].body.content;
ok(post.startsWith(':crossed_swords: **The hunt is over!**') && post.includes('/results>'), 'final post links to the results page');
await q(`update event_settings set ends_at = now() + interval '12 days', starts_at = now() - interval '2 days'`);

// --- Row-level security as real roles --------------------------------------
await as(P[1]);
await db.exec(`set role authenticated`);
ok((await q(`select count(*)::int n from contracts where status = 'pool'`))[0].n === 0, 'players cannot see the pool');
ok((await q(`select count(*)::int n from submissions`))[0].n === (await q(`select count(*)::int n from submissions where player_id = auth.uid()`))[0].n, 'players see only their own submissions');
ok((await q(`select count(*)::int n from audit_log`))[0].n === 0, 'players cannot read audit log');
await expectErr(() => q(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [`${P[0]}/x/1.png`]), /row-level security/, "players cannot upload into another player's evidence folder");
await q(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [`${P[1]}/x/1.png`]);
ok(true, 'players can upload into their own evidence folder');
await expectErr(() => q(`insert into submissions (contract_id, player_id, evidence_links) values ($1, $2, array['https://x'])`, [board[0].contract_id, P[1]]), /permission denied|row-level/, 'direct submission insert blocked');
await expectErr(() => q(`insert into reputation_events (player_id, amount, source, reason) values ($1, 500, 'bonus', 'free rep')`, [P[1]]), /permission denied|row-level/, 'direct reputation insert blocked');
await expectErr(() => q(`update profiles set role = 'admin' where id = auth.uid()`), /permission denied|row-level/, 'cannot promote self');
await expectErr(() => q(`select _fill_slot(1)`), /permission denied/, 'internal functions not callable');
await expectErr(() => q(`select _internal_on()`), /permission denied/, 'internal flag not callable');
const upd = await db.query(`update event_settings set is_paused = true`);
ok(upd.affectedRows === 0, 'players cannot change settings');
ok((await q(`select count(*)::int n from get_board() where tier = 'main'`))[0].n === 12, 'players can read the board');
ok((await q(`select count(*)::int n from integration_settings`))[0].n === 0, 'players cannot read the Discord webhook or join code');
ok((await q(`select count(*)::int n from chat_messages where deleted_at is not null`))[0].n === 0, 'players cannot see deleted chat messages');
await expectErr(() => q(`insert into chat_messages (player_id, body) values (auth.uid(), 'sneaky')`), /permission denied/, 'chat only through post_chat');
await expectErr(() => q(`select set_player_muted($1, true)`, [P[2]]), /Only admins/, 'players cannot mute');
await expectErr(() => q(`select send_standings_now()`), /Only admins/, 'players cannot post standings');
await expectErr(() => q(`select send_discord_test()`), /Only admins/, 'players cannot send Discord messages');
ok((await q(`select get_hunter('Hunter 1') h`))[0].h.rs_name === 'Hunter 1', 'players can view public profiles');
await db.exec(`reset role`);
await as(adminA);
await db.exec(`set role authenticated`);
ok((await q(`select count(*)::int n from contracts where status = 'pool'`))[0].n > 0, 'admins see the pool');
ok((await q(`select count(*)::int n from audit_log`))[0].n > 5, 'admins read audit log');
await q(`insert into storage.objects (bucket_id, name) values ('evidence', $1)`, [`${P[2]}/y/1.png`]);
ok(true, "admins can upload evidence into a player's folder");
await db.exec(`reset role`);
await as('');
await db.exec(`set role anon`);
ok((await q(`select count(*)::int n from get_board() where tier = 'main'`))[0].n === 12, 'visitors can read the board');
ok((await q(`select get_hunter('Hunter 1') h`))[0].h.claims.length >= 1, 'visitors can view public profiles');
ok((await q(`select count(*)::int n from get_chat()`))[0].n === 3 && (await q(`select count(*)::int n from get_activity()`))[0].n > 0, 'visitors can read the Tavern and activity');
ok((await q(`select get_event_stats() s`))[0].s.podium.length > 0, 'visitors can see results');
await expectErr(() => q(`select revoke_approval(gen_random_uuid(), 'x')`), /permission denied/, 'visitors cannot call admin functions');
ok((await q(`select check_signup('Brand New') m`))[0].m === null && (await q(`select signup_needs_code() n`))[0].n === false, 'visitors can run the sign-up check');
ok(/@players\.gmw\.invalid$/.test((await q(`select login_email_for('Newcomer') e`))[0].e), 'visitors can look up a login to sign in');
await expectErr(() => q(`select admin_set_passphrase($1, 'brand-new-passphrase-88')`, [newbie.id]), /permission denied/, 'visitors cannot reset passphrases');
await expectErr(() => q(`select count(*) from submissions`), /permission denied/, 'visitors cannot read submissions');
await db.exec(`reset role`);

console.log(`\n${pass} passed, ${fail} failed`);
const acts = await q(`select action, count(*)::int n from audit_log group by 1 order by 1`);
console.log('audit actions:', acts.map(a => `${a.action}=${a.n}`).join(', '));
process.exit(fail ? 1 : 0);
