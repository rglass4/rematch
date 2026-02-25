import { supabase, getSession } from './supabaseClient.js';

const form = document.getElementById('add-game-form');
const playersWrap = document.getElementById('players-wrap');
const specialPlayersWrap = document.getElementById('special-players-wrap');
const msg = document.getElementById('form-message');
const submitBtn = document.getElementById('submit-btn');
const authGuard = document.getElementById('auth-guard');
const titleEl = document.getElementById('page-title');

const SPECIAL_PLAYERS = new Set(['4th Man', '5th Man']);
const EASTERN_TIMEZONE = 'America/New_York';
let previousPlayedByPlayer = new Map();
let editingGameId = null;
let latestGameDateValue = '';

function showMessage(text, isError = false) {
  msg.textContent = text;
  msg.className = isError ? 'message error' : 'message';
}

function dateValueInTimezone(dateInput, timeZone = EASTERN_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(dateInput));
}

function todayLocalDateValue() {
  return dateValueInTimezone(Date.now());
}

function clampToZero(value) {
  return Math.max(0, Number(value) || 0);
}

function updateInputValue(inputEl, delta) {
  const nextValue = clampToZero((Number(inputEl.value) || 0) + delta);
  inputEl.value = String(nextValue);
}

function attachSteppers(container) {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('.stepper-btn');
    if (!button) return;

    const targetId = button.dataset.target;
    const delta = Number(button.dataset.delta || 0);
    const targetInput = targetId
      ? document.getElementById(targetId)
      : button.closest('.number-stepper')?.querySelector('input[type="number"]');

    if (!targetInput) return;
    updateInputValue(targetInput, delta);
  });
}

async function checkAuth() {
  const session = await getSession();
  const allowed = Boolean(session);
  submitBtn.disabled = !allowed;
  authGuard.textContent = allowed ? '' : 'You must be logged in to add or edit a game.';
  authGuard.className = allowed ? 'message' : 'message error';
  return allowed;
}

function rowTemplate(player) {
  const played = previousPlayedByPlayer.get(player.id) ?? false;
  return `
    <div class="player-row" data-player-id="${player.id}">
      <div>${player.name}</div>
      <div class="number-stepper compact-stepper">
        <button type="button" class="stepper-btn" data-delta="-1">-</button>
        <input type="number" min="0" value="0" class="goals" />
        <button type="button" class="stepper-btn" data-delta="1">+</button>
      </div>
      <div class="number-stepper compact-stepper">
        <button type="button" class="stepper-btn" data-delta="-1">-</button>
        <input type="number" min="0" value="0" class="assists" />
        <button type="button" class="stepper-btn" data-delta="1">+</button>
      </div>
      <div class="player-flags">
        <label><input type="checkbox" class="played" ${played ? 'checked' : ''} /> Played</label>
        <label><input type="checkbox" class="goalie-start" /> GS</label>
      </div>
    </div>
  `;
}

function renderPlayers(players) {
  const mainPlayers = players.filter((p) => !SPECIAL_PLAYERS.has(p.name));
  const specialPlayers = players.filter((p) => SPECIAL_PLAYERS.has(p.name));

  playersWrap.innerHTML = `
    <div class="player-row head">
      <div>Player</div><div>G</div><div>A</div><div>Flags</div>
    </div>
    ${mainPlayers.map((p) => rowTemplate(p)).join('')}
  `;

  specialPlayersWrap.innerHTML = `
    <div class="player-row head">
      <div>Player</div><div>G</div><div>A</div><div>Flags</div>
    </div>
    ${specialPlayers.map((p) => rowTemplate(p)).join('')}
  `;
}

function setPlayerRowsFromLines(lines) {
  for (const line of lines) {
    const row = document.querySelector(`.player-row[data-player-id="${line.player_id}"]`);
    if (!row) continue;
    row.querySelector('.goals').value = String(clampToZero(line.goals));
    row.querySelector('.assists').value = String(clampToZero(line.assists));
    row.querySelector('.played').checked = line.played_in_game !== false;
    row.querySelector('.goalie-start').checked = Boolean(line.started_in_goal);
  }
}

async function loadPreviousPlayedMap() {
  const { data: latestGame, error: latestError } = await supabase
    .from('games')
    .select('id, game_date')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError || !latestGame) return;
  latestGameDateValue = dateValueInTimezone(latestGame.game_date);

  const { data: lines, error: linesError } = await supabase
    .from('player_game_stats')
    .select('player_id, played_in_game')
    .eq('game_id', latestGame.id);

  if (linesError) return;
  previousPlayedByPlayer = new Map(lines.map((line) => [line.player_id, line.played_in_game !== false]));
}

async function loadPlayers() {
  const { data, error } = await supabase.from('players').select('*').order('name');
  if (error) throw error;

  const missingSpecial = [...SPECIAL_PLAYERS].filter((name) => !data.some((player) => player.name === name));
  if (missingSpecial.length > 0) {
    await supabase.from('players').insert(missingSpecial.map((name) => ({ name })));
    const { data: refreshedPlayers, error: refreshedErr } = await supabase.from('players').select('*').order('name');
    if (refreshedErr) throw refreshedErr;
    renderPlayers(refreshedPlayers);
    return;
  }

  renderPlayers(data);
}

function buildPlayerLines(gameId) {
  const rows = [...document.querySelectorAll('.player-row[data-player-id]')];
  const lineByPlayerId = new Map();

  rows
    .map((row) => {
      const goals = clampToZero(row.querySelector('.goals').value);
      const assists = clampToZero(row.querySelector('.assists').value);
      const started = row.querySelector('.goalie-start').checked;
      const played = row.querySelector('.played').checked;
      return {
        game_id: gameId,
        player_id: Number(row.dataset.playerId),
        goals,
        assists,
        started_in_goal: started,
        played_in_game: played
      };
    })
    .filter((r) => r.played_in_game || r.goals > 0 || r.assists > 0 || r.started_in_goal)
    .forEach((line) => {
      lineByPlayerId.set(line.player_id, line);
    });

  return [...lineByPlayerId.values()];
}

function validate() {
  const date = document.getElementById('game-date').value;
  const result = document.getElementById('result').value;
  const gf = clampToZero(document.getElementById('goals-for').value);
  const ga = clampToZero(document.getElementById('goals-against').value);

  if (!date || !['W', 'L'].includes(result)) {
    throw new Error('Please fill game date and result.');
  }

  return {
    game_date: new Date(`${date}T12:00:00Z`).toISOString(),
    result,
    goals_for: gf,
    goals_against: ga,
    overtime: document.getElementById('overtime').checked
  };
}

async function populateEditModeIfNeeded() {
  const editId = new URLSearchParams(window.location.search).get('editId');
  if (!editId) return;
  editingGameId = Number(editId);
  if (!Number.isFinite(editingGameId)) return;

  titleEl.textContent = 'Edit Game';
  submitBtn.textContent = 'Save Changes';

  const [{ data: game, error: gameErr }, { data: lines, error: linesErr }] = await Promise.all([
    supabase.from('games').select('*').eq('id', editingGameId).maybeSingle(),
    supabase.from('player_game_stats').select('*').eq('game_id', editingGameId)
  ]);

  if (gameErr || !game) throw gameErr || new Error('Game not found.');
  if (linesErr) throw linesErr;

  document.getElementById('game-date').value = dateValueInTimezone(game.game_date);
  document.getElementById('result').value = game.result;
  document.getElementById('goals-for').value = String(clampToZero(game.goals_for));
  document.getElementById('goals-against').value = String(clampToZero(game.goals_against));
  document.getElementById('overtime').checked = Boolean(game.overtime);
  setPlayerRowsFromLines(lines || []);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');

  try {
    const authed = await checkAuth();
    if (!authed) return;

    const gamePayload = validate();
    let gameId = editingGameId;

    if (editingGameId) {
      const { error: updateErr } = await supabase.from('games').update(gamePayload).eq('id', editingGameId);
      if (updateErr) throw updateErr;
      const { error: deleteErr } = await supabase.from('player_game_stats').delete().eq('game_id', editingGameId);
      if (deleteErr) throw deleteErr;
    } else {
      const { data: gameRow, error: gameErr } = await supabase.from('games').insert(gamePayload).select('id').single();
      if (gameErr) throw gameErr;
      gameId = gameRow.id;
    }

    const lines = buildPlayerLines(gameId);
    if (lines.length > 0) {
      const { error: linesErr } = await supabase
        .from('player_game_stats')
        .insert(lines);
      if (linesErr) throw linesErr;
    }

    showMessage(editingGameId ? 'Game updated. Redirecting...' : 'Game added. Redirecting...');
    setTimeout(() => {
      window.location.href = './index.html';
    }, 700);
  } catch (err) {
    showMessage(err.message || 'Could not save game.', true);
  }
});

(async function init() {
  document.getElementById('game-date').value = todayLocalDateValue();
  attachSteppers(form);
  try {
    await loadPreviousPlayedMap();
    if (!editingGameId && latestGameDateValue) {
      document.getElementById('game-date').value = latestGameDateValue;
    }
    await loadPlayers();
    await populateEditModeIfNeeded();
    await checkAuth();
  } catch (err) {
    showMessage(`Load error: ${err.message}`, true);
  }
})();
