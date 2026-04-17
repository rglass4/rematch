import { supabase } from './supabaseClient.js';

const messageEl = document.getElementById('records-message');
const teamBody = document.getElementById('team-records-body');
const teamDayBody = document.getElementById('team-day-records-body');
const playerGameBody = document.getElementById('player-game-records-body');
const playerTotalBody = document.getElementById('player-total-records-body');

const SPECIAL_PLAYER_NAMES = new Set(['4th Man', '5th Man']);

function formatDate(dateInput) {
  return new Date(dateInput).toLocaleDateString();
}

function didPlayerParticipate(line) {
  return Boolean(line) && (line.played_in_game !== false || line.goals > 0 || line.assists > 0 || line.started_in_goal);
}

function gameSortAsc(a, b) {
  const dateDiff = new Date(a.game_date) - new Date(b.game_date);
  if (dateDiff !== 0) return dateDiff;
  return a.id - b.id;
}

function formatValue(value, decimals = 2) {
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(decimals);
  return value;
}

async function fetchAllRows(table, { pageSize = 200, orderBy = 'id' } = {}) {
  const allRows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending: true }).range(from, to);
    if (error) throw error;

    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function selectTopRows(rows, valueSelector, limit = 5, mode = 'max') {
  if (!rows.length) return [];

  const sorted = [...rows].sort((a, b) => {
    const aValue = valueSelector(a);
    const bValue = valueSelector(b);
    if (aValue !== bValue) return mode === 'max' ? bValue - aValue : aValue - bValue;

    const aDate = new Date(a.game_date || a.date || 0).getTime();
    const bDate = new Date(b.game_date || b.date || 0).getTime();
    if (aDate !== bDate) return aDate - bDate;

    const aId = a.game_id ?? a.id ?? a.player_id ?? 0;
    const bId = b.game_id ?? b.id ?? b.player_id ?? 0;
    return aId - bId;
  });

  const topValue = valueSelector(sorted[0]);
  const tiedForFirst = sorted.filter((row) => valueSelector(row) === topValue);
  if (tiedForFirst.length > limit) return tiedForFirst;

  return sorted.slice(0, limit);
}

function renderTopItems(items) {
  if (!items.length) return '—';
  return `<ol class="record-top-list">${items.map((item) => `<li>${item}</li>`).join('')}</ol>`;
}

function renderRecordRows(tableBody, records) {
  tableBody.innerHTML = '';
  for (const record of records) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${record.label}</td>
      <td>${formatValue(record.value)}</td>
      <td>${renderTopItems(record.topItems || [])}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function buildTeamRecords(games) {
  if (!games.length) return [];

  const marginRows = games.map((g) => ({ ...g, value: g.goals_for - g.goals_against }));

  const winRuns = [];
  const lossRuns = [];
  const sorted = [...games].sort(gameSortAsc);

  let run = null;
  for (const game of sorted) {
    if (!run || run.result !== game.result) {
      run = { result: game.result, count: 1, startGame: game, endGame: game, game_date: game.game_date, id: game.id };
      if (game.result === 'W') winRuns.push(run);
      if (game.result === 'L') lossRuns.push(run);
    } else {
      run.count += 1;
      run.endGame = game;
      run.game_date = game.game_date;
      run.id = game.id;
    }
  }

  const teamRecords = [
    {
      label: 'Most Goals For (Game)',
      rows: selectTopRows(games, (g) => g.goals_for),
      value: Math.max(...games.map((g) => g.goals_for)),
      mapItem: (g) => `${formatDate(g.game_date)} · ${g.result} ${g.goals_for}-${g.goals_against}${g.overtime ? ' OT' : ''}`
    },
    {
      label: 'Largest Margin of Victory',
      rows: selectTopRows(marginRows, (g) => g.value),
      value: Math.max(...marginRows.map((g) => g.value)),
      mapItem: (g) => `${formatDate(g.game_date)} · ${g.result} ${g.goals_for}-${g.goals_against}${g.overtime ? ' OT' : ''} (Margin ${g.value})`
    },
    {
      label: 'Longest Winning Streak',
      rows: selectTopRows(winRuns, (r) => r.count),
      value: Math.max(0, ...winRuns.map((r) => r.count)),
      mapItem: (r) => `${r.count} games · ${formatDate(r.startGame.game_date)} → ${formatDate(r.endGame.game_date)}`
    },
    {
      label: 'Longest Losing Streak',
      rows: selectTopRows(lossRuns, (r) => r.count),
      value: Math.max(0, ...lossRuns.map((r) => r.count)),
      mapItem: (r) => `${r.count} games · ${formatDate(r.startGame.game_date)} → ${formatDate(r.endGame.game_date)}`
    }
  ];

  return teamRecords.map((record) => ({
    label: record.label,
    value: record.value,
    topItems: record.rows.map(record.mapItem)
  }));
}

function buildTeamDayRecords(games) {
  if (!games.length) return [];

  const byDate = new Map();
  for (const game of games) {
    const key = game.game_date;
    const row = byDate.get(key) || {
      game_date: key,
      games: 0,
      wins: 0,
      losses: 0,
      overtime_games: 0,
      goals_for: 0,
      goals_against: 0
    };

    row.games += 1;
    if (game.result === 'W') row.wins += 1;
    if (game.result === 'L') row.losses += 1;
    if (game.overtime) row.overtime_games += 1;
    row.goals_for += game.goals_for;
    row.goals_against += game.goals_against;

    byDate.set(key, row);
  }

  const dayRows = [...byDate.values()].map((row) => ({
    ...row,
    winning_percentage: row.games ? row.wins / row.games : 0,
    goals_for_per_game: row.games ? row.goals_for / row.games : 0,
    goals_against_per_game: row.games ? row.goals_against / row.games : 0,
    goal_diff: row.goals_for - row.goals_against
  }));

  const dayMetrics = [
    { key: 'wins', label: 'Most Wins', mode: 'max' },
    { key: 'losses', label: 'Most Losses', mode: 'max' },
    { key: 'winning_percentage', label: 'Best Winning Percentage', mode: 'max', decimals: 3 },
    { key: 'overtime_games', label: 'Most Overtime Games', mode: 'max' },
    { key: 'goals_for', label: 'Most Goals For', mode: 'max' },
    { key: 'goals_for', label: 'Least Goals For', mode: 'min' },
    { key: 'goals_against', label: 'Most Goals Against', mode: 'max' },
    { key: 'goals_against', label: 'Least Goals Against', mode: 'min' },
    { key: 'goals_for_per_game', label: 'Most Goals For/Game', mode: 'max' },
    { key: 'goals_for_per_game', label: 'Least Goals For/Game', mode: 'min' },
    { key: 'goals_against_per_game', label: 'Least Goals Against/Game', mode: 'min' },
    { key: 'goals_against_per_game', label: 'Most Goals Against/Game', mode: 'max' },
    { key: 'goal_diff', label: 'Best Goal Diff', mode: 'max' },
    { key: 'goal_diff', label: 'Worst Goal Diff', mode: 'min' }
  ];

  return dayMetrics.map((metric) => {
    const topRows = selectTopRows(dayRows, (row) => row[metric.key], 5, metric.mode);
    return {
      label: metric.label,
      value: topRows.length ? formatValue(topRows[0][metric.key], metric.decimals ?? 2) : 'N/A',
      topItems: topRows.map((row) => {
        const value = formatValue(row[metric.key], metric.decimals ?? 2);
        return `${formatDate(row.game_date)} · ${value} (${row.wins}-${row.losses}, GF ${row.goals_for}, GA ${row.goals_against}, GP ${row.games})`;
      })
    };
  });
}

function buildPlayerInGameRecords(lines, playersById, gamesById, eligiblePlayerIds) {
  const eligibleLines = lines
    .filter((line) => eligiblePlayerIds.has(line.player_id))
    .map((line) => ({
      ...line,
      points: line.goals + line.assists,
      player_name: playersById.get(line.player_id)?.name || `Player #${line.player_id}`,
      game_date: gamesById.get(line.game_id)?.game_date || null,
      game: gamesById.get(line.game_id)
    }))
    .filter((line) => line.game_date);

  const byPlayerNight = new Map();
  for (const line of eligibleLines) {
    const key = `${line.player_id}::${line.game_date}`;
    const row = byPlayerNight.get(key) || {
      player_id: line.player_id,
      player_name: line.player_name,
      game_date: line.game_date,
      goals: 0,
      assists: 0,
      points: 0,
      goalie_starts: 0,
      gp: 0
    };

    row.goals += line.goals;
    row.assists += line.assists;
    row.points = row.goals + row.assists;
    if (line.started_in_goal) row.goalie_starts += 1;
    if (didPlayerParticipate(line)) row.gp += 1;

    byPlayerNight.set(key, row);
  }

  const nightRows = [...byPlayerNight.values()];

  const inGameRecords = [
    { key: 'goals', label: 'Most Goals in a Game' },
    { key: 'assists', label: 'Most Assists in a Game' },
    { key: 'points', label: 'Most Points in a Game' }
  ].map((metric) => {
    const topRows = selectTopRows(eligibleLines, (line) => line[metric.key] || 0);
    return {
      label: metric.label,
      value: topRows.length ? topRows[0][metric.key] || 0 : 0,
      topItems: topRows.map((line) => {
        const game = line.game;
        return `${line.player_name} · ${formatDate(line.game_date)} · ${game?.result || ''} ${game?.goals_for ?? '?'}-${game?.goals_against ?? '?'} (${line[metric.key] || 0})`;
      })
    };
  });

  const nightRecords = [
    { key: 'goals', label: 'Most Goals in a Night' },
    { key: 'assists', label: 'Most Assists in a Night' },
    { key: 'points', label: 'Most Points in a Night' },
    { key: 'goalie_starts', label: 'Most Goalie Starts in a Night' }
  ].map((metric) => {
    const topRows = selectTopRows(nightRows, (row) => row[metric.key] || 0);
    return {
      label: metric.label,
      value: topRows.length ? topRows[0][metric.key] || 0 : 0,
      topItems: topRows.map((row) => `${row.player_name} · ${formatDate(row.game_date)} (${row[metric.key] || 0})`)
    };
  });

  const nightPerGameRecords = [
    { key: 'goals', label: 'Most Goals per Game in a Night' },
    { key: 'assists', label: 'Most Assists per Game in a Night' },
    { key: 'points', label: 'Most Points per Game in a Night' }
  ].map((metric) => {
    const rows = nightRows
      .filter((row) => row.gp >= 5)
      .map((row) => ({ ...row, value: row.gp ? row[metric.key] / row.gp : 0 }));

    const topRows = selectTopRows(rows, (row) => row.value);
    return {
      label: metric.label,
      value: topRows.length ? topRows[0].value : 'N/A',
      topItems: topRows.length
        ? topRows.map((row) => `${row.player_name} · ${formatDate(row.game_date)} (${row.value.toFixed(2)})`)
        : []
    };
  });

  return [...inGameRecords, ...nightRecords, ...nightPerGameRecords];
}

function buildPlayerTotalsRecords(players, lines, eligiblePlayerIds) {
  const eligiblePlayers = players.filter((p) => eligiblePlayerIds.has(p.id));

  const totals = eligiblePlayers.map((p) => ({
    player_id: p.id,
    name: p.name,
    gp: 0,
    goals: 0,
    assists: 0,
    points: 0,
    goalie_starts: 0,
    goals_per_game: 0,
    assists_per_game: 0,
    points_per_game: 0,
    goalie_starts_per_game: 0
  }));

  const totalsByPlayer = new Map(totals.map((t) => [t.player_id, t]));
  for (const line of lines) {
    if (!eligiblePlayerIds.has(line.player_id)) continue;

    const row = totalsByPlayer.get(line.player_id);
    if (!row) continue;
    if (didPlayerParticipate(line)) row.gp += 1;
    row.goals += line.goals;
    row.assists += line.assists;
    row.points = row.goals + row.assists;
    if (line.started_in_goal) row.goalie_starts += 1;
  }

  for (const row of totals) {
    row.goals_per_game = row.gp > 0 ? row.goals / row.gp : 0;
    row.assists_per_game = row.gp > 0 ? row.assists / row.gp : 0;
    row.points_per_game = row.gp > 0 ? row.points / row.gp : 0;
    row.goalie_starts_per_game = row.gp > 0 ? row.goalie_starts / row.gp : 0;
  }

  const metrics = [
    { key: 'gp', label: 'Most Games Played', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'goals', label: 'Most Goals', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'assists', label: 'Most Assists', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'points', label: 'Most Points', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'goalie_starts', label: 'Most Goalie Starts', mode: 'max', eligible: (row) => row.goalie_starts > 0 },
    { key: 'goalie_starts', label: 'Fewest Goalie Starts', mode: 'min', eligible: (row) => row.goalie_starts > 0 },
    { key: 'goals_per_game', label: 'Most Goals Per Game', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'assists_per_game', label: 'Most Assists Per Game', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'points_per_game', label: 'Most Points Per Game', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'goalie_starts_per_game', label: 'Most Goalie Starts Per Game', mode: 'max', eligible: (row) => row.goalie_starts > 0 },
    { key: 'goalie_starts_per_game', label: 'Fewest Goalie Starts Per Game', mode: 'min', eligible: (row) => row.goalie_starts > 0 }
  ];

  return metrics.map((metric) => {
    const eligibleRows = totals.filter(metric.eligible);
    if (!eligibleRows.length) {
      return {
        label: metric.label,
        value: 'N/A',
        topItems: []
      };
    }

    const topRows = selectTopRows(eligibleRows, (row) => row[metric.key], 5, metric.mode);
    return {
      label: metric.label,
      value: topRows[0][metric.key],
      topItems: topRows.map((row) => `${row.name} (${formatValue(row[metric.key])})`)
    };
  });
}

async function loadRecords() {
  const [allGames, allLines, allPlayers] = await Promise.all([
    fetchAllRows('games'),
    fetchAllRows('player_game_stats'),
    fetchAllRows('players')
  ]);
  const playersById = new Map(allPlayers.map((p) => [p.id, p]));
  const gamesById = new Map(allGames.map((g) => [g.id, g]));
  const eligiblePlayers = allPlayers.filter((p) => !SPECIAL_PLAYER_NAMES.has(p.name));
  const eligiblePlayerIds = new Set(eligiblePlayers.map((p) => p.id));

  renderRecordRows(teamBody, buildTeamRecords(allGames));
  renderRecordRows(teamDayBody, buildTeamDayRecords(allGames));
  renderRecordRows(playerGameBody, buildPlayerInGameRecords(allLines, playersById, gamesById, eligiblePlayerIds));
  renderRecordRows(playerTotalBody, buildPlayerTotalsRecords(allPlayers, allLines, eligiblePlayerIds));
}

(async function init() {
  messageEl.textContent = 'Loading records...';
  try {
    await loadRecords();
    messageEl.textContent = '';
  } catch (err) {
    messageEl.textContent = `Could not load records: ${err.message}`;
    messageEl.className = 'message error';
  }
})();
