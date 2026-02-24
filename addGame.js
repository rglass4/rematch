import { supabase, getSession } from './supabaseClient.js';

const form = document.getElementById('add-game-form');
const playersWrap = document.getElementById('players-wrap');
const specialPlayersWrap = document.getElementById('special-players-wrap');
const msg = document.getElementById('form-message');
const submitBtn = document.getElementById('submit-btn');
const authGuard = document.getElementById('auth-guard');

const SPECIAL_PLAYERS = new Set(['4th Man', '5th Man']);

function showMessage(text, isError = false) {
  msg.textContent = text;
  msg.className = isError ? 'message error' : 'message';
}

function nowLocalDateTimeValue() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0, 16);
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
  return `
    <div class="player-row" data-player-id="${player.id}">
      <div>${player.name}</div>
      <div class="number-stepper">
        <button type="button" class="stepper-btn" data-delta="-1">-</button>
        <input type="number" min="0" value="0" class="goals" />
        <button type="button" class="stepper-btn" data-delta="1">+</button>
      </div>
      <div class="number-stepper">
        <button type="button" class="stepper-btn" data-delta="-1">-</button>
        <input type="number" min="0" value="0" class="assists" />
        <button type="button" class="stepper-btn" data-delta="1">+</button>
      </div>
      <label><input type="checkbox" class="goalie-start" /> GS</label>
    </div>
  `;
}

function renderPlayers(players) {
  const mainPlayers = players.filter((p) => !SPECIAL_PLAYERS.has(p.name));
  const specialPlayers = players.filter((p) => SPECIAL_PLAYERS.has(p.name));

  playersWrap.innerHTML = `
    <div class="player-row head">
      <div>Player</div><div>G</div><div>A</div><div>Goalie Start</div>
    </div>
    ${mainPlayers.map((p) => rowTemplate(p)).join('')}
  `;

  specialPlayersWrap.innerHTML = `
    <div class="player-row head">
      <div>Player</div><div>G</div><div>A</div><div>Goalie Start</div>
    </div>
    ${specialPlayers.map((p) => rowTemplate(p)).join('')}
  `;
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
      return {
        game_id: gameId,
        player_id: Number(row.dataset.playerId),
        goals,
        assists,
        started_in_goal: started
      };
    })
    .filter((r) => r.goals > 0 || r.assists > 0 || r.started_in_goal);
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
    game_date: new Date(date).toISOString(),
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
  document.getElementById('game-date').value = nowLocalDateTimeValue();
  attachSteppers(form);
  try {
    await loadPlayers();
    await checkAuth();
  } catch (err) {
    showMessage(`Load error: ${err.message}`, true);
  }
})();
