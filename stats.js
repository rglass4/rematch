import { supabase, signInWithPassword, signOut, getSession } from './supabaseClient.js';

const statusEl = document.getElementById('auth-status');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMsg = document.getElementById('auth-message');
const statsViewFilter = document.getElementById('stats-view-filter');
const statsErrorEl = document.getElementById('stats-error');

const summaryIds = {
  games: document.getElementById('total-games'),
  wl: document.getElementById('wl-record'),
  winPct: document.getElementById('win-pct'),
  streak: document.getElementById('current-streak'),
  ot: document.getElementById('ot-games'),
  gf: document.getElementById('goals-for'),
  ga: document.getElementById('goals-against'),
  gfPerGame: document.getElementById('goals-for-per-game'),
  gaPerGame: document.getElementById('goals-against-per-game'),
  gd: document.getElementById('goal-diff')
};

const leaderboardBody = document.getElementById('player-stats-body');
const gamesBody = document.getElementById('games-body');
const boxscoreModal = document.getElementById('boxscore-modal');
const boxscoreTitle = document.getElementById('boxscore-title');
const boxscoreMeta = document.getElementById('boxscore-meta');
const boxscoreBody = document.getElementById('boxscore-body');
const boxscoreCloseBtn = document.getElementById('boxscore-close');
const gamesSection = gamesBody?.closest('section');

let allGames = [];
let allPlayers = [];
let isAuthed = false;
let playerSort = { key: 'points', direction: 'desc' };
const missingElementWarnings = new Set();
const PLAYER_LINES_PAGE_SIZE = 500;
const HOST_ROTATION = new Map([
  ['Bobs', 'Mac'],
  ['Mac', 'TDot'],
  ['TDot', 'Joe'],
  ['Joe', 'Pton'],
  ['Pton', 'Bobs']
]);
let currentVisibleLines = [];
let currentFilterRequestId = 0;

function getRequiredElementById(id) {
  const element = document.getElementById(id);
  if (!element && !missingElementWarnings.has(id)) {
    console.warn(`Missing expected element #${id}; skipping dependent UI updates.`);
    missingElementWarnings.add(id);
  }
  return element;
}

function showAuthMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.className = isError ? 'message error' : 'message';
}

function showStatsError(text = '') {
  if (statsErrorEl) statsErrorEl.textContent = text;
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

  refreshFilteredView();
}

function calcSummary(games) {
  const totalGames = games.length;
  const wins = games.filter((g) => g.result === 'W').length;
  const losses = games.filter((g) => g.result === 'L').length;
  const otGames = games.filter((g) => g.overtime).length;
  const gf = games.reduce((sum, g) => sum + g.goals_for, 0);
  const ga = games.reduce((sum, g) => sum + g.goals_against, 0);
  const winPct = totalGames ? (wins / totalGames) * 100 : 0;
  const gfPerGame = totalGames ? gf / totalGames : 0;
  const gaPerGame = totalGames ? ga / totalGames : 0;

  const latestFirstGames = [...games].sort((a, b) => {
    const dateDiff = new Date(b.game_date) - new Date(a.game_date);
    if (dateDiff !== 0) return dateDiff;
    return b.id - a.id;
  });

  let streakResult = '';
  let streakCount = 0;

  for (const game of latestFirstGames) {
    if (!streakResult) {
      streakResult = game.result;
      streakCount = 1;
      continue;
    }

    if (game.result !== streakResult) break;
    streakCount += 1;
  }

  const streak = streakCount ? `${streakResult}${streakCount}` : 'N/A';

  return { totalGames, wins, losses, otGames, gf, ga, gd: gf - ga, winPct, streak, gfPerGame, gaPerGame };
}

function didPlayerParticipate(line) {
  return Boolean(line) && (line.played_in_game !== false || line.goals > 0 || line.assists > 0 || line.started_in_goal);
}

function calcPlayerTotals(players, lines) {
  const totals = players.map((p) => ({
    player_id: p.id,
    name: p.name,
    gp: 0,
    goals: 0,
    assists: 0,
    points: 0,
    goalie_starts: 0,
    ppg: 0,
    hosted: false
  }));

  const map = new Map(totals.map((t) => [t.player_id, t]));

  for (const line of lines) {
    const t = map.get(line.player_id);
    if (!t) continue;
    if (didPlayerParticipate(line)) t.gp += 1;
    t.goals += line.goals;
    t.assists += line.assists;
    t.points = t.goals + t.assists;
    t.ppg = t.gp ? t.points / t.gp : 0;
    if (line.started_in_goal) t.goalie_starts += 1;
    if (line.host) t.hosted = true;
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
  return (row.ppg || 0).toFixed(2);
}

function getCurrentHostName(lines, gamesById) {
  const hostedLines = (lines || []).filter((line) => line.host);
  if (!hostedLines.length) return null;

  hostedLines.sort((a, b) => {
    const gameA = gamesById.get(a.game_id);
    const gameB = gamesById.get(b.game_id);
    const dateDiff = new Date(gameB?.game_date || 0) - new Date(gameA?.game_date || 0);
    if (dateDiff !== 0) return dateDiff;
    return Number(gameB?.id || 0) - Number(gameA?.id || 0);
  });

  const latestHostLine = hostedLines[0];
  return allPlayers.find((player) => player.id === latestHostLine.player_id)?.name || null;
}

function renderSummary(summary) {
  if (!summaryIds.games || !summaryIds.wl || !summaryIds.winPct || !summaryIds.streak || !summaryIds.ot || !summaryIds.gf || !summaryIds.ga || !summaryIds.gfPerGame || !summaryIds.gaPerGame || !summaryIds.gd) return;
  summaryIds.games.textContent = summary.totalGames;
  summaryIds.wl.textContent = `${summary.wins}-${summary.losses}`;
  summaryIds.winPct.textContent = `${summary.winPct.toFixed(1)}%`;
  summaryIds.streak.textContent = summary.streak;
  summaryIds.ot.textContent = summary.otGames;
  summaryIds.gf.textContent = summary.gf;
  summaryIds.ga.textContent = summary.ga;
  summaryIds.gfPerGame.textContent = summary.gfPerGame.toFixed(2);
  summaryIds.gaPerGame.textContent = summary.gaPerGame.toFixed(2);
  summaryIds.gd.textContent = summary.gd;
}

function renderLeaderboard(tableBody, rows, { showHostText = false, nextHostName = null } = {}) {
  const resolvedTableBody = tableBody || getRequiredElementById('player-stats-body');
  if (!resolvedTableBody) return;

  resolvedTableBody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="leaderboard-player-cell">
          <img class="leaderboard-player-avatar" src="img/${row.player_id}.png" alt="${row.name}" width="32" height="32" />
          <a class="player-profile-link" href="./player.html?id=${encodeURIComponent(row.player_id)}">${row.name}${nextHostName === row.name ? ' *' : ''}${showHostText && row.hosted ? ' (Host)' : ''}</a>
        </div>
      </td>
      <td>${row.gp}</td>
      <td>${row.goals}</td>
      <td>${row.assists}</td>
      <td>${row.points}</td>
      <td>${calculatePpg(row)}</td>
      <td>${row.goalie_starts}</td>
    `;
    resolvedTableBody.appendChild(tr);
  }
}

function getGamesForSelection() {
  if (!statsViewFilter) return [...(allGames || [])];
  const selectedValue = statsViewFilter.value;
  if (!selectedValue || selectedValue === 'total') return [...(allGames || [])];
  return allGames.filter((g) => dateOnlyString(g.game_date) === selectedValue);
}

function renderGames(games) {
  const resolvedGamesBody = gamesBody || getRequiredElementById('games-body');
  if (!resolvedGamesBody) return;
  resolvedGamesBody.innerHTML = '';

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
    resolvedGamesBody.appendChild(tr);
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

async function fetchPlayerLinesForGameIds(gameIds) {
  if (!Array.isArray(gameIds) || gameIds.length === 0) return [];

  const lines = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('player_game_stats')
      .select('*')
      .in('game_id', gameIds)
      .order('id', { ascending: true })
      .range(from, from + PLAYER_LINES_PAGE_SIZE - 1);

    if (error) throw error;

    const nextBatch = data || [];
    lines.push(...nextBatch);

    if (nextBatch.length < PLAYER_LINES_PAGE_SIZE) break;
    from += PLAYER_LINES_PAGE_SIZE;
  }

  return lines;
}

async function loadVisibleLines() {
  const visibleGames = getGamesForSelection();
  const visibleGameIds = visibleGames.map((g) => g.id);
  currentVisibleLines = await fetchPlayerLinesForGameIds(visibleGameIds);
  return { visibleGames, visibleLines: currentVisibleLines };
}

async function applyFilters() {
  const requestId = ++currentFilterRequestId;
  const selectedValue = statsViewFilter?.value || 'total';
  const showGames = selectedValue !== 'total';
  if (gamesSection) gamesSection.hidden = !showGames;

  const { visibleGames, visibleLines } = await loadVisibleLines();
  if (requestId !== currentFilterRequestId) return;

  renderSummary(calcSummary(visibleGames));

  const totals = calcPlayerTotals(allPlayers, visibleLines)
    .filter((row) => row.gp > 0);

  const gamesById = new Map(visibleGames.map((game) => [game.id, game]));
  const currentHostName = getCurrentHostName(visibleLines, gamesById);
  const nextHostName = currentHostName ? (HOST_ROTATION.get(currentHostName) || null) : null;

  renderLeaderboard(leaderboardBody, sortPlayerRows(totals), {
    showHostText: selectedValue !== 'total',
    nextHostName
  });
  if (showGames) {
    renderGames(visibleGames);
  } else if (gamesBody) {
    gamesBody.innerHTML = '';
  }
}

async function refreshFilteredView() {
  showStatsError('');

  try {
    await applyFilters();
  } catch (err) {
    showStatsError(`Could not load stats: ${err.message}`);
  }
}

async function renderBoxScore(gameId) {
  const game = allGames.find((g) => String(g.id) === String(gameId));
  if (!game) return;

  const playerMap = new Map(allPlayers.map((p) => [p.id, p.name]));
  const lines = (await fetchPlayerLinesForGameIds([Number(gameId)]))
    .filter(didPlayerParticipate)
    .sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists));

  boxscoreTitle.textContent = `Box Score • ${formatGameDate(game.game_date)}`;
  boxscoreMeta.textContent = `Result: ${game.result} (${game.goals_for}-${game.goals_against})${game.overtime ? ' OT' : ''}`;

  boxscoreBody.innerHTML = lines
    .map((line) => {
      const name = playerMap.get(line.player_id) || `Player #${line.player_id}`;
      const displayName = `${name}${line.host ? ' (Host)' : ''}`;
      return `<tr>
        <td>${displayName}</td>
        <td>${line.goals}</td>
        <td>${line.assists}</td>
        <td>${line.goals + line.assists}</td>
        <td>${line.started_in_goal ? 'Yes' : ''}</td>
      </tr>`;
    })
    .join('') || '<tr><td colspan="5">No player stats were saved for this game.</td></tr>';

  boxscoreModal.showModal();
}

async function loadStats() {
  const [{ data: games, error: gamesErr }, { data: players, error: playersErr }] = await Promise.all([
    supabase.from('games').select('*'),
    supabase.from('players').select('*').order('name')
  ]);

  if (gamesErr || playersErr) {
    const message = gamesErr?.message || playersErr?.message || 'Unknown data error.';
    throw new Error(message);
  }

  allGames = games || [];
  allPlayers = players || [];
  populateViewFilter();
  await refreshFilteredView();
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

    refreshFilteredView();
  });
});

statsViewFilter?.addEventListener('change', refreshFilteredView);

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
  await refreshAuthUi();
});

logoutBtn?.addEventListener('click', async () => {
  const { error } = await signOut();
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }
  showAuthMessage('Logged out.');
  await refreshAuthUi();
});

supabase.auth.onAuthStateChange(() => {
  refreshAuthUi();
});

(async function init() {
  await refreshAuthUi();
  try {
    await loadStats();
  } catch (err) {
    showStatsError(`Could not load stats: ${err.message}`);
  }
})();
