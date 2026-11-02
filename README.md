# Gielinor's Most Wanted

A 14-day bounty-board event site for the UwU Girls RuneScape 3 clan. Players claim contracts with screenshot evidence, admins approve them, and each contract retires after five approved claims — replaced automatically from the pool.

Built with React, TypeScript, Tailwind CSS and Supabase (Postgres, Auth, Storage, Realtime). There is no custom server: every game rule runs inside the database.

---

## Setting it up (about 30 minutes, no coding)

You'll need three free accounts: **Supabase** (database and sign-in), **GitHub** (to hold the code) and **Vercel** (to host the site). Netlify works too.

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign up, and click **New project**. Pick the London region (`eu-west-2`) and save the database password somewhere safe.
2. When it's ready, open **SQL Editor** in the left sidebar.
3. Open `supabase/setup_all.sql` from this project, copy the whole file, paste it into a new query and click **Run**. You should see "Success. No rows returned".

   (It's the files in `supabase/migrations/`, then `seed.sql` and `seed_most_wanted.sql`, joined together in order. You can run them one by one instead if you prefer.)
4. Go to **Table Editor → board_slots**: you should see 14 rows with contracts in them: 12 on the main board and 2 Most Wanted.

**Already ran an earlier version?** Don't run `setup_all.sql` again. Run only the files you haven't run yet, in this order: `migrations/0004_profiles_wanted_discord.sql`, `seed_most_wanted.sql`, `migrations/0005_passphrase_login.sql`, `migrations/0006_admin_entry_and_review_alerts.sql`. Your existing board, claims and reputation are kept.

### 2. Set up sign-in

Players sign in with their **RuneScape name and a passphrase the site generates for them** (like `ember-goblin-lantern-harbour-sage-42`). No email, Discord or RuneScape password is involved. Behind the scenes each account has a random placeholder address that can never receive mail, so Supabase must not try to send any.

In Supabase, open **Authentication → Sign In / Providers → Email** and:

- leave **Enable Email provider** on (it handles the passphrases),
- turn **Confirm email** **off** (important: with it on, sign-ups won't complete),
- leave **Secure password change** off, so players can change their own passphrase.

Under **Authentication → Policies** (or **Password requirements**, depending on your dashboard version), leave the password rules at their defaults. If you've switched on any email notifications (for example "password changed"), switch them off.

Optional: to stop people outside the clan registering, set a **join code** in **Admin → Event → Sign-up** once you're an admin, and share it in clan chat.

### 3. Put the code on GitHub

1. Create a new repository on [github.com](https://github.com) (private is fine).
2. Upload everything in this folder except `node_modules` (drag and drop works on the repository page).

### 4. Deploy on Vercel

1. Sign in to [vercel.com](https://vercel.com) with GitHub and click **Add New → Project**, then pick the repository.
2. Vercel detects Vite automatically. Under **Environment Variables** add:
   - `VITE_SUPABASE_URL` — Supabase **Project Settings → API → Project URL**
   - `VITE_SUPABASE_ANON_KEY` — Supabase **Project Settings → API → anon public** key
3. Click **Deploy**. You'll get an address like `gielinors-most-wanted.vercel.app`.
4. In Supabase, open **Authentication → URL Configuration** and set **Site URL** to your Vercel address.

### 5. Make yourself an admin

1. Open your site, click **Join or sign in → Join the hunt**, enter your RuneScape name and save the passphrase it gives you.
2. In Supabase **SQL Editor**, run (with your own name):
   ```sql
   update public.profiles set role = 'admin' where rs_name = 'Your RS Name';
   ```
3. Reload the site: an **Admin** tab appears. From then on, promote other admins from **Admin → Players**.

### 6. Post bounty news to Discord (optional)

1. In your clan's Discord, open the channel's settings → **Integrations** → **Webhooks** → **New Webhook**, then **Copy Webhook URL**.
2. On the site, open **Admin → Event → Discord**, paste it, choose what to post, save, and click **Send test message**.

The site then posts when a claim is approved, when a bounty is fully claimed, and when a new bounty goes up. Posts can't ping @everyone. This uses Supabase's built-in `pg_net` extension, which the setup file turns on for you.

### 7. Before launch

- **Admin → Event**: set the real start and end dates and a codeword. The seed uses placeholder dates (starting the moment you ran it, for 14 days).
- **Admin → Contracts**: check each sample contract against the game, edit wording, add your own. The samples ask players to type the codeword in **clan chat**, so their name shows next to it.
- Read the player-facing **How it works** page and adjust anything that doesn't match your rules (it's in `src/pages/HowItWorksPage.tsx`; dates, codeword, ranks and claim limits fill in automatically).
- Do a test run with a couple of clan members. To reset afterwards, see "Starting fresh" below.

---

## How it works

| Rule | Where it's enforced |
| --- | --- |
| One open-or-approved claim per player per contract | Unique index on `submissions` |
| A contract can only pay a player once | Unique index on `reputation_events (player_id, contract_id)` |
| No duplicate live contracts | Unique `board_slots.contract_id` |
| Only five approvals per contract, even if two admins click at once | `review_submission()` locks the contract row, re-counts, then approves |
| Retire and replace on the fifth approval | Same transaction as the approval |
| Empty pool | Slot shows "awaiting"; adding a pool contract fills it automatically |
| Players can't see the future pool | Row-level security on `contracts` |
| Evidence is private | Private storage bucket; players read only their own folder, admins read all |
| Reputation = sum of the ledger | `reputation_events`; corrections are new rows, never edits |
| Admins can't approve their own claims | `review_submission()` |
| Every important action is logged | `audit_log`, written by the database functions |
| Most Wanted bounties need reputation to claim | `submit_claim()` checks the player's total reputation |
| Most Wanted contracts only go into Most Wanted slots | `_fill_slot()` matches contracts to the slot's tier |
| The Discord webhook and join code stay secret | `integration_settings` is readable by admins only |
| Sign-ups need a valid, unused RuneScape name (and the join code, if set) | Trigger on `auth.users` rejects the account otherwise |
| Signing in never reveals a real email address | `login_email_for()` only returns placeholder logins |
| Admins can enter claims for Discord-only players | `admin_submit_claim()`: same rules as a player's own claim, can be dated back to the Discord post, can be approved in the same step, and is logged |
| Lost passphrase | Admin → Players → Reset passphrase: new one shown once, old one stops working, player signed out everywhere |

**Slots fill on approval, not submission.** When a bounty fills, any pending claims on it close with no reputation. The review queue is sorted oldest first so the earliest valid claim normally gets the last slot.

**Most Wanted.** Any contract with a "reputation needed to claim" above 0 is a Most Wanted contract. It goes up in the separate Most Wanted slots (2 by default, set in Admin → Event) instead of the main board. Everyone can see it; only players with enough total reputation, bonuses included, can claim it. It rotates exactly like the main board.

**Guests** can browse everything without an account: the board, contract details, leaderboards, the archive and hunter profiles. Signing in is only needed to claim.

**Passphrases** are five random words and a number (about 47 bits of randomness), generated in the browser. Supabase stores only a bcrypt hash and rate-limits sign-in attempts. Players can get a new passphrase any time from **My bounties**. A player who renames themselves signs in with the new name.

**Claims posted in Discord.** In **Admin → Add claim**, type the player's RuneScape name (or add them as a new player: an account is made with just their name), pick the bounty, save the screenshot from Discord and add it (or paste a copied image), set when they posted it, and choose whether to approve now or send it to the review queue. Discord's own image links expire, so upload the screenshot rather than linking to it.

**Review alerts.** When a player's claim is approved, rejected or closed, a red count appears next to **My bounties** until they open it; those claims are marked **New**.

**Screenshots** are shrunk in the player's browser before upload: long edge capped at 1920 px and re-saved as WebP, so a 3–5 MB screenshot usually lands well under 1 MB. That keeps the event comfortably inside Supabase's free 1 GB of storage.

**Retire vs return** (Admin → Board): *Retire* moves the contract to the archive. *Return* puts it at the back of the pool, keeping its approved claims, so it continues counting if it goes up again.

## Running it locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm run dev
```

`npm run test:db` runs 122 checks of the game rules (claim limits, rotation, duplicate awards, Most Wanted gating, Discord posts, passphrase sign-up and resets, admin claim entry, review alerts, row-level security) against an in-memory Postgres.

## Starting fresh after a test run

In the SQL Editor:

```sql
truncate public.audit_log, public.reputation_events, public.submissions restart identity;
update public.board_slots set contract_id = null, state = 'awaiting';
select set_config('gmw.internal', 'on', false);
update public.contracts set status = 'pool', approved_count = 0, activated_at = null, retired_at = null
 where status in ('active', 'retired');
select public._sync_board_slots();
```

Run it as one query. Uploaded screenshots stay in **Storage → evidence**; delete that folder's contents there if you want them gone too.

## Project layout

```
supabase/migrations/   schema, game functions, security (run in order)
supabase/seed.sql      settings, ranks, 30 sample contracts
supabase/seed_most_wanted.sql  4 sample Most Wanted contracts
supabase/setup_all.sql everything above in one file
src/components/board/  noticeboard, posters, wax seals, emblems
src/pages/             board, contract, profiles, leaderboards, archive, how it works, sign-in
src/pages/admin/       review queue, add claim, board slots, contracts, players, event, audit log
```

RuneScape is a trademark of Jagex Ltd. This is a fan-made clan event site, not affiliated with or endorsed by Jagex. All artwork on the site is original.
