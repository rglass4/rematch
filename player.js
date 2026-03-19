import { supabase } from './supabaseClient.js';

const titleEl = document.getElementById('player-title');
const messageEl = document.getElementById('profile-message');
const summaryCard = document.getElementById('player-summary-card');
const summaryGrid = document.getElementById('player-summary-grid');
const lastTenCard = document.getElementById('player-last10-card');
const lastTenGrid = document.getElementById('player-last10-grid');
const gamesCard = document.getElementById('player-games-card');
const gamesBody = document.getElementById('player-games-body');
const chemistryCard = document.getElementById('player-chemistry-card');
const chemistryBody = document.getElementById('chemistry-body');

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.className = isError ? 'message error' : 'message';
}

function formatDate(value) {
  return new Date(value).toLocaleDateString();
}

function statCard(label, value) {
  return `<div class="stat"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function didPlayerParticipate(line) {
  return Boolean(line) && (line.played_in_game !== false || line.goals > 0 || line.assists > 0 || line.started_in_goal);
}

function computeTotals(lines, gamesById) {
  const gpLines = lines.filter(didPlayerParticipate);
  const goals = lines.reduce((sum, line) => sum + line.goals, 0);
  const assists = lines.reduce((sum, line) => sum + line.assists, 0);
  const points = goals + assists;
  const goalieStarts = lines.filter((line) => line.started_in_goal).length;
  const wins = gpLines.filter((line) => gamesById.get(line.game_id)?.result === 'W').length;
  const losses = gpLines.filter((line) => gamesById.get(line.game_id)?.result === 'L').length;

  return {
    gp: gpLines.length,
    goals,
    assists,
    points,
    ppg: gpLines.length ? points / gpLines.length : 0,
    goalieStarts,
    wins,
    losses
  };
}

function renderSummary(playerName, totals) {
  titleEl.textContent = `${playerName} Profile`;
  summaryGrid.innerHTML = [
    statCard('GP', totals.gp),
    statCard('Goals', totals.goals),
    statCard('Assists', totals.assists),
    statCard('Points', totals.points),
    statCard('PPG', totals.ppg.toFixed(2)),
    statCard('Goalie Starts', totals.goalieStarts),
    statCard('Record When Playing', `${totals.wins}-${totals.losses}`)
  ].join('');
  summaryCard.hidden = false;
}

function renderLastTen(sortedLines, gamesById) {
  const lastTen = sortedLines.slice(0, 10);
  const totals = computeTotals(lastTen, gamesById);

  lastTenGrid.innerHTML = [
    statCard('Games', lastTen.length),
    statCard('Goals', totals.goals),
    statCard('Assists', totals.assists),
    statCard('Points', totals.points),
    statCard('PPG', totals.ppg.toFixed(2)),
    statCard('Record', `${totals.wins}-${totals.losses}`)
  ].join('');
  lastTenCard.hidden = false;
}

function renderGames(sortedLines, gamesById) {
  gamesBody.innerHTML = '';

  for (const line of sortedLines) {
    const game = gamesById.get(line.game_id);
    if (!game) continue;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(game.game_date)}</td>
      <td>${game.result}</td>
      <td>${game.goals_for}-${game.goals_against}${game.overtime ? ' OT' : ''}</td>
      <td>${line.goals}</td>
      <td>${line.assists}</td>
      <td>${line.goals + line.assists}</td>
      <td>${line.started_in_goal ? 'Yes' : ''}</td>
    `;
    gamesBody.appendChild(tr);
  }

  gamesCard.hidden = false;
}

function renderChemistry(selectedPlayerId, sortedLines, linesByGameId, playersById, gamesById) {
  const shared = new Map();

  for (const line of sortedLines) {
    const sameGameLines = linesByGameId.get(line.game_id) || [];
    for (const teammateLine of sameGameLines) {
      if (teammateLine.player_id === selectedPlayerId) continue;
      if (!didPlayerParticipate(teammateLine)) continue;

      const existing = shared.get(teammateLine.player_id) || {
        teammateId: teammateLine.player_id,
        gp: 0,
        wins: 0,
        losses: 0,
        points: 0
      };

      existing.gp += 1;
      existing.points += line.goals + line.assists;
      const result = gamesById.get(line.game_id)?.result;
      if (result === 'W') existing.wins += 1;
      if (result === 'L') existing.losses += 1;

      shared.set(teammateLine.player_id, existing);
    }
  }

  const rows = [...shared.values()]
    .filter((row) => row.gp > 0)
    .sort((a, b) => b.gp - a.gp || (b.points / b.gp) - (a.points / a.gp))
    .slice(0, 8);

  chemistryBody.innerHTML = rows.map((row) => {
    const name = playersById.get(row.teammateId)?.name || `Player #${row.teammateId}`;
    return `<tr>
      <td>${name}</td>
      <td>${row.gp}</td>
      <td>${row.wins}-${row.losses}</td>
      <td>${(row.points / row.gp).toFixed(2)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">No teammate overlap data yet.</td></tr>';

  chemistryCard.hidden = false;
}

async function init() {
  const playerIdParam = new URLSearchParams(window.location.search).get('id');
  const playerId = Number(playerIdParam);

  if (!Number.isFinite(playerId)) {
    showMessage('Invalid player id.', true);
    return;
  }

  const [{ data: player, error: playerErr }, { data: players, error: playersErr }, { data: lines, error: linesErr }, { data: games, error: gamesErr }] = await Promise.all([
    supabase.from('players').select('*').eq('id', playerId).maybeSingle(),
    supabase.from('players').select('*'),
    supabase.from('player_game_stats').select('*'),
    supabase.from('games').select('*')
  ]);

  if (playerErr || playersErr || linesErr || gamesErr) {
    showMessage(playerErr?.message || playersErr?.message || linesErr?.message || gamesErr?.message || 'Could not load player profile.', true);
    return;
  }

  if (!player) {
    showMessage('Player not found.', true);
    return;
  }

  const allGames = games || [];
  const allLines = lines || [];
  const gamesById = new Map(allGames.map((game) => [game.id, game]));
  const playersById = new Map((players || []).map((entry) => [entry.id, entry]));
  const linesByGameId = new Map();

  for (const line of allLines) {
    const current = linesByGameId.get(line.game_id) || [];
    current.push(line);
    linesByGameId.set(line.game_id, current);
  }

  const playerLines = allLines
    .filter((line) => line.player_id === playerId)
    .filter(didPlayerParticipate)
    .sort((a, b) => {
      const aDate = new Date(gamesById.get(a.game_id)?.game_date || 0).getTime();
      const bDate = new Date(gamesById.get(b.game_id)?.game_date || 0).getTime();
      return bDate - aDate || b.game_id - a.game_id;
    });

  if (playerLines.length === 0) {
    titleEl.textContent = `${player.name} Profile`;
    showMessage('No games recorded yet for this player.');
    return;
  }

  const totals = computeTotals(playerLines, gamesById);

  renderSummary(player.name, totals);
  renderLastTen(playerLines, gamesById);
  renderGames(playerLines, gamesById);
  renderChemistry(playerId, playerLines, linesByGameId, playersById, gamesById);
}

init();
