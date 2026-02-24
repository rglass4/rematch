import { supabase, signInWithPassword, signUpWithPassword, signOut, getSession } from './supabaseClient.js';

const statusEl = document.getElementById('auth-status');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMsg = document.getElementById('auth-message');
const leaderboardMode = document.getElementById('leaderboard-mode');
const statsDateFilter = document.getElementById('stats-date-filter');

const summaryIds = {
  games: document.getElementById('total-games'),
  wl: document.getElementById('wl-record'),
  ot: document.getElementById('ot-games'),
  gf: document.getElementById('goals-for'),
  ga: document.getElementById('goals-against'),
  gd: document.getElementById('goal-diff')
};

const leaderboardBody = document.getElementById('player-stats-body');
const specialLeaderboardBody = document.getElementById('special-player-stats-body');
const gamesBody = document.getElementById('games-body');

const SPECIAL_PLAYERS = new Set(['4th Man', '5th Man']);
let allGames = [];
let allLines = [];
let allPlayers = [];

function showAuthMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.className = isError ? 'message error' : 'message';
}

function dateOnlyString(dateInput) {
  return new Date(dateInput).toISOString().slice(0, 10);
}

function formatGameDate(dateInput) {
  return new Date(dateInput).toLocaleString();
}

async function refreshAuthUi() {
  try {
    const session = await getSession();
    if (session) {
      statusEl.textContent = `Logged in: ${session.user.email}`;
      logoutBtn.hidden = false;
      loginBtn.hidden = true;
      signupBtn.hidden = true;
      emailInput.hidden = true;
      passwordInput.hidden = true;
    } else {
      statusEl.textContent = 'Not logged in';
      logoutBtn.hidden = true;
      loginBtn.hidden = false;
      signupBtn.hidden = false;
      emailInput.hidden = false;
      passwordInput.hidden = false;
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

function renderLeaderboard(tableBody, rows) {
  tableBody.innerHTML = '';
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
    tableBody.appendChild(tr);
  }
}

function renderGames(games, selectedDate) {
  gamesBody.innerHTML = '';
  if (!selectedDate) return;

  const filteredGames = games
    .filter((g) => dateOnlyString(g.game_date) === selectedDate)
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date));

  for (const game of filteredGames) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatGameDate(game.game_date)}</td>
      <td>${game.result}</td>
      <td>${game.goals_for}-${game.goals_against}</td>
      <td>${game.overtime ? 'Yes' : 'No'}</td>
    `;
    gamesBody.appendChild(tr);
  }
}

function applyFilters() {
  const mode = leaderboardMode.value;
  const selectedDate = statsDateFilter.value;

  let visibleGames = allGames;
  if (mode === 'date' && selectedDate) {
    visibleGames = allGames.filter((g) => dateOnlyString(g.game_date) === selectedDate);
  }

  const visibleGameIds = new Set(visibleGames.map((g) => g.id));
  const visibleLines = allLines.filter((line) => visibleGameIds.has(line.game_id));

  renderSummary(calcSummary(visibleGames));

  const totals = calcPlayerTotals(allPlayers, visibleLines);
  const mainPlayers = totals.filter((row) => !SPECIAL_PLAYERS.has(row.name));
  const specialPlayers = totals.filter((row) => SPECIAL_PLAYERS.has(row.name));

  renderLeaderboard(leaderboardBody, mainPlayers);
  renderLeaderboard(specialLeaderboardBody, specialPlayers);
  renderGames(allGames, selectedDate);
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

  allGames = games;
  allLines = lines;
  allPlayers = players;
  applyFilters();
}

leaderboardMode?.addEventListener('change', applyFilters);
statsDateFilter?.addEventListener('change', applyFilters);

loginBtn?.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showAuthMessage('Enter both email and password to log in.', true);
    return;
  }

  const { error } = await signInWithPassword(email, password);
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }

  showAuthMessage('Logged in.');
  refreshAuthUi();
});

signupBtn?.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showAuthMessage('Enter both email and password to sign up.', true);
    return;
  }

  const { error } = await signUpWithPassword(email, password);
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }

  showAuthMessage('Sign-up successful. You can now log in.');
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
