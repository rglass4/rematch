import { supabase, signInWithPassword, signOut, getSession } from './supabaseClient.js';

const statusEl = document.getElementById('auth-status');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMsg = document.getElementById('auth-message');
const statsViewFilter = document.getElementById('stats-view-filter');

const summaryIds = {
  games: document.getElementById('total-games'),
  wl: document.getElementById('wl-record'),
  ot: document.getElementById('ot-games'),
  gf: document.getElementById('goals-for'),
  ga: document.getElementById('goals-against'),
  gd: document.getElementById('goal-diff')
};

const leaderboardBody = document.getElementById('player-stats-body');
const gamesBody = document.getElementById('games-body');
const boxscoreModal = document.getElementById('boxscore-modal');
const boxscoreTitle = document.getElementById('boxscore-title');
const boxscoreMeta = document.getElementById('boxscore-meta');
const boxscoreBody = document.getElementById('boxscore-body');
const boxscoreCloseBtn = document.getElementById('boxscore-close');

let allGames = [];
let allLines = [];
let allPlayers = [];
let isAuthed = false;
let playerSort = { key: 'points', direction: 'desc' };

function showAuthMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.className = isError ? 'message error' : 'message';
}

function dateOnlyString(dateInput) {
  return new Date(dateInput).toISOString().slice(0, 10);
}

function formatGameDate(dateInput) {
  return new Date(dateInput).toLocaleDateString();
}

async function refreshAuthUi() {
  try {
    const session = await getSession();
    isAuthed = Boolean(session);
    if (session) {
      statusEl.textContent = `Logged in: ${session.user.email}`;
      logoutBtn.hidden = false;
      loginBtn.hidden = true;
      emailInput.hidden = true;
      passwordInput.hidden = true;
    } else {
      statusEl.textContent = 'Not logged in';
      logoutBtn.hidden = true;
      loginBtn.hidden = false;
      emailInput.hidden = false;
      passwordInput.hidden = false;
    }
  } catch {
    statusEl.textContent = 'Auth status unavailable';
    isAuthed = false;
  }

  applyFilters();
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
    if (line.played_in_game !== false) t.gp += 1;
    t.goals += line.goals;
    t.assists += line.assists;
    t.points = t.goals + t.assists;
    if (line.started_in_goal) t.goalie_starts += 1;
  }

  return totals;
}

function sortPlayerRows(rows) {
  const { key, direction } = playerSort;
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const diff = (a[key] - b[key]) * multiplier;
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
}

function calculatePpg(row) {
  if (!row.gp) return '0.00';
  return ((row.goals + row.assists) / row.gp).toFixed(2);
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
      <td>${calculatePpg(row)}</td>
      <td>${row.goalie_starts}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function getGamesForSelection() {
  if (!statsViewFilter) return [...(allGames || [])];
  const selectedValue = statsViewFilter.value;
  if (!selectedValue || selectedValue === 'total') return [...(allGames || [])];
  return allGames.filter((g) => dateOnlyString(g.game_date) === selectedValue);
}

function renderGames(games) {
  gamesBody.innerHTML = '';

  const sortedGames = [...games].sort((a, b) => b.id - a.id);
  for (const game of sortedGames) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatGameDate(game.game_date)}</td>
      <td>${game.result}</td>
      <td>${game.goals_for}-${game.goals_against}</td>
      <td>${game.overtime ? 'Yes' : 'No'}</td>
      <td class="game-actions">
        <button type="button" class="secondary game-view" data-game-id="${game.id}">View</button>
        ${isAuthed ? `<button type="button" class="secondary game-edit" data-game-id="${game.id}">Edit</button>
        <button type="button" class="secondary game-delete" data-game-id="${game.id}">Delete</button>` : ''}
      </td>
    `;
    gamesBody.appendChild(tr);
  }
}

function populateViewFilter() {
  if (!statsViewFilter) return;

  const uniqueDates = [...new Set(allGames.map((g) => dateOnlyString(g.game_date)))].sort((a, b) => b.localeCompare(a));
  const selectedBefore = statsViewFilter.value;
  const options = [
    '<option value="total">Total</option>',
    ...uniqueDates.map((date) => `<option value="${date}">${date}</option>`)
  ];
  statsViewFilter.innerHTML = options.join('');

  if (selectedBefore && options.some((opt) => opt.includes(`value="${selectedBefore}"`))) {
    statsViewFilter.value = selectedBefore;
  } else if (uniqueDates[0]) {
    statsViewFilter.value = uniqueDates[0];
  }
}

function applyFilters() {
  const visibleGames = getGamesForSelection();
  const visibleGameIds = new Set(visibleGames.map((g) => g.id));
  const visibleLines = allLines.filter((line) => visibleGameIds.has(line.game_id));

  renderSummary(calcSummary(visibleGames));

  const totals = calcPlayerTotals(allPlayers, visibleLines)
    .filter((row) => row.gp > 0);

  renderLeaderboard(leaderboardBody, sortPlayerRows(totals));
  renderGames(visibleGames);
}

function renderBoxScore(gameId) {
  const game = allGames.find((g) => String(g.id) === String(gameId));
  if (!game) return;

  const playerMap = new Map(allPlayers.map((p) => [p.id, p.name]));
  const lines = allLines
    .filter((line) => String(line.game_id) === String(gameId))
    .filter((line) => line.played_in_game !== false || line.goals > 0 || line.assists > 0 || line.started_in_goal)
    .sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists));

  boxscoreTitle.textContent = `Box Score • ${formatGameDate(game.game_date)}`;
  boxscoreMeta.textContent = `Result: ${game.result} (${game.goals_for}-${game.goals_against})${game.overtime ? ' OT' : ''}`;

  boxscoreBody.innerHTML = lines
    .map((line) => {
      const name = playerMap.get(line.player_id) || `Player #${line.player_id}`;
      return `<tr>
        <td>${name}</td>
        <td>${line.goals}</td>
        <td>${line.assists}</td>
        <td>${line.goals + line.assists}</td>
        <td>${line.started_in_goal ? 'Yes' : ''}</td>
      </tr>`;
    })
    .join('') || '<tr><td colspan="5">No active players recorded.</td></tr>';

  boxscoreModal.showModal();
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

  allGames = games || [];
  allLines = lines || [];
  allPlayers = players || [];
  populateViewFilter();
  applyFilters();
}

async function deleteGame(gameId) {
  const confirmed = window.confirm('Delete this game?');
  if (!confirmed) return;

  const { error } = await supabase.from('games').delete().eq('id', gameId);
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }

  showAuthMessage('Game deleted.');
  await loadStats();
}

function editGame(gameId) {
  window.location.href = `./add-game.html?editId=${encodeURIComponent(gameId)}`;
}

document.querySelectorAll('.table-sort').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.sortKey;
    if (!key) return;

    if (playerSort.key === key) {
      playerSort.direction = playerSort.direction === 'desc' ? 'asc' : 'desc';
    } else {
      playerSort.key = key;
      playerSort.direction = 'desc';
    }

    applyFilters();
  });
});

statsViewFilter?.addEventListener('change', applyFilters);

gamesBody?.addEventListener('click', async (event) => {
  const viewBtn = event.target.closest('.game-view');
  if (viewBtn) {
    renderBoxScore(viewBtn.dataset.gameId);
    return;
  }

  const deleteBtn = event.target.closest('.game-delete');
  if (deleteBtn) {
    await deleteGame(deleteBtn.dataset.gameId);
    return;
  }

  const editBtn = event.target.closest('.game-edit');
  if (editBtn) {
    editGame(editBtn.dataset.gameId);
  }
});

boxscoreCloseBtn?.addEventListener('click', () => boxscoreModal.close());
boxscoreModal?.addEventListener('click', (event) => {
  if (event.target === boxscoreModal) boxscoreModal.close();
});

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
