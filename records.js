import { supabase } from './supabaseClient.js';

const messageEl = document.getElementById('records-message');
const teamBody = document.getElementById('team-records-body');
const playerGameBody = document.getElementById('player-game-records-body');
const playerTotalBody = document.getElementById('player-total-records-body');

function formatDate(dateInput) {
  return new Date(dateInput).toLocaleDateString();
}

function gameSortAsc(a, b) {
  const dateDiff = new Date(a.game_date) - new Date(b.game_date);
  if (dateDiff !== 0) return dateDiff;
  return a.id - b.id;
}

function gameContext(game) {
  if (!game) return null;
  return {
    id: game.id,
    game_date: game.game_date,
    result: `${game.result} ${game.goals_for}-${game.goals_against}${game.overtime ? ' OT' : ''}`
  };
}

function formatOccurrence(occurrence) {
  if (!occurrence) return '—';
  return `${formatDate(occurrence.game_date)} · Game #${occurrence.id} · ${occurrence.result}`;
}

function formatHolders(holders) {
  if (!holders || !holders.length) return '—';
  return holders.join(', ');
}

function renderRecordRows(tableBody, records) {
  tableBody.innerHTML = '';
  for (const record of records) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${record.label}</td>
      <td>${record.value}</td>
      <td>${formatHolders(record.holders)}</td>
      <td>${formatOccurrence(record.firstOccurrence)}</td>
      <td>${formatOccurrence(record.lastOccurrence)}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function buildTeamRecords(games) {
  if (!games.length) return [];

  const maxGoals = Math.max(...games.map((g) => g.goals_for));
  const goalsOccurrences = games.filter((g) => g.goals_for === maxGoals).sort(gameSortAsc);

  const maxMargin = Math.max(...games.map((g) => g.goals_for - g.goals_against));
  const marginOccurrences = games
    .filter((g) => g.goals_for - g.goals_against === maxMargin)
    .sort(gameSortAsc);

  const sorted = [...games].sort(gameSortAsc);
  const streakRuns = [];

  let run = null;
  for (const game of sorted) {
    if (!run || run.result !== game.result) {
      run = { result: game.result, count: 1, startGame: game, endGame: game };
      streakRuns.push(run);
    } else {
      run.count += 1;
      run.endGame = game;
    }
  }

  const maxWinStreak = Math.max(0, ...streakRuns.filter((r) => r.result === 'W').map((r) => r.count));
  const maxLossStreak = Math.max(0, ...streakRuns.filter((r) => r.result === 'L').map((r) => r.count));

  const winRuns = streakRuns.filter((r) => r.result === 'W' && r.count === maxWinStreak);
  const lossRuns = streakRuns.filter((r) => r.result === 'L' && r.count === maxLossStreak);

  const winFirst = winRuns[0] ? gameContext(winRuns[0].endGame) : null;
  const winLast = winRuns.length > 1 ? gameContext(winRuns[winRuns.length - 1].endGame) : null;
  const lossFirst = lossRuns[0] ? gameContext(lossRuns[0].endGame) : null;
  const lossLast = lossRuns.length > 1 ? gameContext(lossRuns[lossRuns.length - 1].endGame) : null;

  return [
    {
      label: 'Most Goals For (Game)',
      value: maxGoals,
      holders: ['Team'],
      firstOccurrence: gameContext(goalsOccurrences[0]),
      lastOccurrence: goalsOccurrences.length > 1 ? gameContext(goalsOccurrences[goalsOccurrences.length - 1]) : null
    },
    {
      label: 'Largest Margin of Victory',
      value: maxMargin,
      holders: ['Team'],
      firstOccurrence: gameContext(marginOccurrences[0]),
      lastOccurrence: marginOccurrences.length > 1 ? gameContext(marginOccurrences[marginOccurrences.length - 1]) : null
    },
    {
      label: 'Longest Winning Streak',
      value: maxWinStreak,
      holders: ['Team'],
      firstOccurrence: winFirst,
      lastOccurrence: winLast
    },
    {
      label: 'Longest Losing Streak',
      value: maxLossStreak,
      holders: ['Team'],
      firstOccurrence: lossFirst,
      lastOccurrence: lossLast
    }
  ];
}

function buildPlayerInGameRecords(lines, playersById, gamesById) {
  const metrics = [
    { key: 'goals', label: 'Most Goals in a Game' },
    { key: 'assists', label: 'Most Assists in a Game' },
    { key: 'points', label: 'Most Points in a Game' }
  ];

  return metrics.map((metric) => {
    const enriched = lines.map((line) => ({
      ...line,
      points: line.goals + line.assists
    }));

    const maxValue = Math.max(0, ...enriched.map((line) => line[metric.key] || 0));
    const matching = enriched.filter((line) => (line[metric.key] || 0) === maxValue);

    const holderNames = [...new Set(matching.map((line) => playersById.get(line.player_id)?.name).filter(Boolean))].sort();

    const occurrences = matching
      .map((line) => gamesById.get(line.game_id))
      .filter(Boolean)
      .sort(gameSortAsc);

    return {
      label: metric.label,
      value: maxValue,
      holders: holderNames,
      firstOccurrence: gameContext(occurrences[0]),
      lastOccurrence: occurrences.length > 1 ? gameContext(occurrences[occurrences.length - 1]) : null
    };
  });
}

function findLatestGameForPlayer(playerId, lines, gamesById) {
  const playerGames = lines
    .filter((line) => line.player_id === playerId && line.played_in_game !== false)
    .map((line) => gamesById.get(line.game_id))
    .filter(Boolean)
    .sort(gameSortAsc);
  return playerGames[playerGames.length - 1] || null;
}

function buildPlayerTotalsRecords(players, lines, gamesById) {
  const totals = players.map((p) => ({
    player_id: p.id,
    name: p.name,
    gp: 0,
    goals: 0,
    assists: 0,
    points: 0,
    goalie_starts: 0
  }));

  const totalsByPlayer = new Map(totals.map((t) => [t.player_id, t]));
  for (const line of lines) {
    const row = totalsByPlayer.get(line.player_id);
    if (!row) continue;
    if (line.played_in_game !== false) row.gp += 1;
    row.goals += line.goals;
    row.assists += line.assists;
    row.points = row.goals + row.assists;
    if (line.started_in_goal) row.goalie_starts += 1;
  }

  const metrics = [
    { key: 'gp', label: 'Most Games Played', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'goals', label: 'Most Goals', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'assists', label: 'Most Assists', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'points', label: 'Most Points', mode: 'max', eligible: (row) => row.gp > 0 },
    { key: 'goalie_starts', label: 'Most Goalie Starts', mode: 'max', eligible: (row) => row.goalie_starts > 0 },
    { key: 'goalie_starts', label: 'Fewest Goalie Starts', mode: 'min', eligible: (row) => row.goalie_starts > 0 }
  ];

  return metrics.map((metric) => {
    const eligibleRows = totals.filter(metric.eligible);
    if (!eligibleRows.length) {
      return {
        label: metric.label,
        value: 'N/A',
        holders: [],
        firstOccurrence: null,
        lastOccurrence: null
      };
    }

    const values = eligibleRows.map((row) => row[metric.key]);
    const bestValue = metric.mode === 'max' ? Math.max(...values) : Math.min(...values);
    const holders = eligibleRows.filter((row) => row[metric.key] === bestValue).sort((a, b) => a.name.localeCompare(b.name));

    const holderGames = holders
      .map((holder) => findLatestGameForPlayer(holder.player_id, lines, gamesById))
      .filter(Boolean)
      .sort(gameSortAsc);

    return {
      label: metric.label,
      value: bestValue,
      holders: holders.map((holder) => holder.name),
      firstOccurrence: holderGames[0] ? gameContext(holderGames[0]) : null,
      lastOccurrence: holderGames.length > 1 ? gameContext(holderGames[holderGames.length - 1]) : null
    };
  });
}

async function loadRecords() {
  const [{ data: games, error: gamesErr }, { data: lines, error: linesErr }, { data: players, error: playersErr }] = await Promise.all([
    supabase.from('games').select('*'),
    supabase.from('player_game_stats').select('*'),
    supabase.from('players').select('*').order('name')
  ]);

  if (gamesErr || linesErr || playersErr) {
    throw new Error(gamesErr?.message || linesErr?.message || playersErr?.message || 'Could not load records data.');
  }

  const allGames = games || [];
  const allLines = lines || [];
  const allPlayers = players || [];
  const playersById = new Map(allPlayers.map((p) => [p.id, p]));
  const gamesById = new Map(allGames.map((g) => [g.id, g]));

  renderRecordRows(teamBody, buildTeamRecords(allGames));
  renderRecordRows(playerGameBody, buildPlayerInGameRecords(allLines, playersById, gamesById));
  renderRecordRows(playerTotalBody, buildPlayerTotalsRecords(allPlayers, allLines, gamesById));
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
