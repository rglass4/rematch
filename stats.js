import { supabase, signInWithOtp, signOut, getSession } from './supabaseClient.js';

const statusEl = document.getElementById('auth-status');
const emailInput = document.getElementById('email-input');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMsg = document.getElementById('auth-message');

const summaryIds = {
  games: document.getElementById('total-games'),
  wl: document.getElementById('wl-record'),
  ot: document.getElementById('ot-games'),
  gf: document.getElementById('goals-for'),
  ga: document.getElementById('goals-against'),
  gd: document.getElementById('goal-diff')
};

const leaderboardBody = document.getElementById('player-stats-body');

function showAuthMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.className = isError ? 'message error' : 'message';
}

async function refreshAuthUi() {
  try {
    const session = await getSession();
    if (session) {
      statusEl.textContent = `Logged in: ${session.user.email}`;
      logoutBtn.hidden = false;
      loginBtn.hidden = true;
      emailInput.hidden = true;
    } else {
      statusEl.textContent = 'Not logged in';
      logoutBtn.hidden = true;
      loginBtn.hidden = false;
      emailInput.hidden = false;
    }
  } catch {
    statusEl.textContent = 'Auth status unavailable';
  }
}

function calcSummary(games) {
  const totalGames = games.length;
  const wins = games.filter((g) => g.result === 'W').length;
  const losses = games.filter((g) => g.result === 'L').length;
  const otGames = games.filter((g) => g.overtime).length;
  const gf = games.reduce((sum, g) => sum + g.goals_for, 0);
  const ga = games.reduce((sum, g) => sum + g.goals_against, 0);

  return { totalGames, wins, losses, otGames, gf, ga, gd: gf - ga };
}

function calcPlayerTotals(players, lines) {
  const totals = players.map((p) => ({
    player_id: p.id,
    name: p.name,
    gp: 0,
    goals: 0,
    assists: 0,
    points: 0,
    goalie_starts: 0
  }));

  const map = new Map(totals.map((t) => [t.player_id, t]));

  for (const line of lines) {
    const t = map.get(line.player_id);
    if (!t) continue;
    t.gp += 1;
    t.goals += line.goals;
    t.assists += line.assists;
    t.points = t.goals + t.assists;
    if (line.started_in_goal) t.goalie_starts += 1;
  }

  return totals.sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name));
}

function renderSummary(summary) {
  summaryIds.games.textContent = summary.totalGames;
  summaryIds.wl.textContent = `${summary.wins}-${summary.losses}`;
  summaryIds.ot.textContent = summary.otGames;
  summaryIds.gf.textContent = summary.gf;
  summaryIds.ga.textContent = summary.ga;
  summaryIds.gd.textContent = summary.gd;
}

function renderLeaderboard(rows) {
  leaderboardBody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.name}</td>
      <td>${row.gp}</td>
      <td>${row.goals}</td>
      <td>${row.assists}</td>
      <td>${row.points}</td>
      <td>${row.goalie_starts}</td>
    `;
    leaderboardBody.appendChild(tr);
  }
}

async function loadStats() {
  const [{ data: games, error: gamesErr }, { data: lines, error: linesErr }, { data: players, error: playersErr }] = await Promise.all([
    supabase.from('games').select('*'),
    supabase.from('player_game_stats').select('*'),
    supabase.from('players').select('*').order('name')
  ]);

  if (gamesErr || linesErr || playersErr) {
    const message = gamesErr?.message || linesErr?.message || playersErr?.message || 'Unknown data error.';
    throw new Error(message);
  }

  renderSummary(calcSummary(games));
  renderLeaderboard(calcPlayerTotals(players, lines));
}

loginBtn?.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showAuthMessage('Enter an email for magic link login.', true);
    return;
  }

  const { error } = await signInWithOtp(email);
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }
  showAuthMessage('Magic link sent. Check your email.');
});

logoutBtn?.addEventListener('click', async () => {
  const { error } = await signOut();
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }
  showAuthMessage('Logged out.');
  refreshAuthUi();
});

supabase.auth.onAuthStateChange(() => {
  refreshAuthUi();
});

(async function init() {
  await refreshAuthUi();
  try {
    await loadStats();
  } catch (err) {
    document.getElementById('stats-error').textContent = `Could not load stats: ${err.message}`;
  }
})();
