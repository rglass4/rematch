import { supabase, getSession } from './supabaseClient.js';

const form = document.getElementById('add-game-form');
const playersWrap = document.getElementById('players-wrap');
const specialPlayersWrap = document.getElementById('special-players-wrap');
const msg = document.getElementById('form-message');
const submitBtn = document.getElementById('submit-btn');
const authGuard = document.getElementById('auth-guard');

const SPECIAL_PLAYERS = new Set(['4th Man', '5th Man']);
let previousPlayedByPlayer = new Map();

function showMessage(text, isError = false) {
  msg.textContent = text;
  msg.className = isError ? 'message error' : 'message';
}

function todayLocalDateValue() {
  return new Date().toISOString().slice(0, 10);
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
  authGuard.textContent = allowed ? '' : 'You must be logged in to add a game.';
  authGuard.className = allowed ? 'message' : 'message error';
  return allowed;
}

function rowTemplate(player) {
  const played = previousPlayedByPlayer.get(player.id) ?? true;
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

async function loadPreviousPlayedMap() {
  const { data: latestGame, error: latestError } = await supabase
    .from('games')
    .select('id')
    .order('game_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError || !latestGame) return;

  const { data: lines, error: linesError } = await supabase
    .from('player_game_stats')
    .select('player_id, played_in_game')
    .eq('game_id', latestGame.id);

  if (linesError) {
    const { data: fallbackLines, error: fallbackErr } = await supabase
      .from('player_game_stats')
      .select('player_id')
      .eq('game_id', latestGame.id);
    if (fallbackErr) return;
    previousPlayedByPlayer = new Map(fallbackLines.map((line) => [line.player_id, true]));
    return;
  }

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
  return rows
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
    .filter((r) => r.played_in_game || r.goals > 0 || r.assists > 0 || r.started_in_goal);
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
    game_date: new Date(`${date}T12:00:00`).toISOString(),
    result,
    goals_for: gf,
    goals_against: ga,
    overtime: document.getElementById('overtime').checked
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');

  try {
    const isAuthed = await checkAuth();
    if (!isAuthed) return;

    const gamePayload = validate();

    const { data: gameRow, error: gameErr } = await supabase
      .from('games')
      .insert(gamePayload)
      .select('id')
      .single();

    if (gameErr) throw gameErr;

    const lines = buildPlayerLines(gameRow.id);
    if (lines.length > 0) {
      const { error: linesErr } = await supabase.from('player_game_stats').insert(lines);
      if (linesErr) throw linesErr;
    }

    showMessage('Game added. Redirecting...');
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
    await loadPlayers();
    await checkAuth();
  } catch (err) {
    showMessage(`Load error: ${err.message}`, true);
  }
})();
