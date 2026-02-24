# Rematch Stat Tracker

Simple static website for tracking Rematch game stats, designed for **GitHub Pages** + **Supabase Postgres**.

## Project files

- `index.html` — dashboard (team summary + player leaderboard)
- `add-game.html` — add a game and per-player stat lines
- `app.css` — minimal styles
- `supabaseClient.js` — Supabase init + auth helpers
- `stats.js` — dashboard queries + aggregation
- `addGame.js` — add-game submission flow

---

## 1) Supabase setup

1. Create a new Supabase project.
2. Open **SQL Editor** and run the SQL below.
3. In **Authentication → Providers**, keep Email enabled (magic link).
4. In **Project Settings → API**, copy:
   - `Project URL`
   - `anon public` key
5. Paste these into `supabaseClient.js`:

```js
const SUPABASE_URL = '___';
const SUPABASE_ANON_KEY = '___';
```

> Never put the `service_role` key in browser code or this repository.

### SQL (schema + seed + RLS policies)

```sql
-- Optional: for case-insensitive unique names
create extension if not exists citext;

-- Drop existing objects if you are re-running during setup
-- drop table if exists player_game_stats;
-- drop table if exists games;
-- drop table if exists players;

create table if not exists players (
  id bigint generated always as identity primary key,
  name citext not null unique,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id bigint generated always as identity primary key,
  game_date timestamptz not null,
  result text not null check (result in ('W', 'L')),
  goals_for integer not null check (goals_for >= 0),
  goals_against integer not null check (goals_against >= 0),
  overtime boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists player_game_stats (
  id bigint generated always as identity primary key,
  game_id bigint not null references games(id) on delete cascade,
  player_id bigint not null references players(id) on delete restrict,
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  started_in_goal boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, player_id)
);

insert into players (name)
values
  ('Bobs'),
  ('Joe'),
  ('Mac'),
  ('Pton'),
  ('TDot'),
  ('Bags'),
  ('5th Man')
on conflict (name) do nothing;

-- RLS
alter table players enable row level security;
alter table games enable row level security;
alter table player_game_stats enable row level security;

-- Public read access
create policy "public can read players"
on players for select
to anon, authenticated
using (true);

create policy "public can read games"
on games for select
to anon, authenticated
using (true);

create policy "public can read player_game_stats"
on player_game_stats for select
to anon, authenticated
using (true);

-- Authenticated inserts
create policy "authenticated can insert games"
on games for insert
to authenticated
with check (true);

create policy "authenticated can insert player_game_stats"
on player_game_stats for insert
to authenticated
with check (true);

-- Optional: authenticated can add players
create policy "authenticated can insert players"
on players for insert
to authenticated
with check (true);
```

With RLS enabled, anon access works only for actions explicitly allowed by policies above.

---

## 2) Run locally (optional)

Because this is a static app, you can use any static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

---

## 3) Deploy to GitHub Pages

1. Push this repo to GitHub.
2. In GitHub repo settings, open **Pages**.
3. Set source to:
   - Branch: `main`
   - Folder: `/ (root)`
4. Save and wait for deployment.
5. Open the Pages URL.

---

## Notes

- Login button sends a magic-link email using Supabase Auth.
- `add-game.html` requires authenticated session before submit.
- Player rows are loaded from the `players` table, so seeded players automatically appear on add/edit flows.
