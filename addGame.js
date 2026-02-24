import { supabase, getSession } from './supabaseClient.js';

const form = document.getElementById('add-game-form');
const playersWrap = document.getElementById('players-wrap');
const msg = document.getElementById('form-message');
const submitBtn = document.getElementById('submit-btn');
const authGuard = document.getElementById('auth-guard');

function showMessage(text, isError = false) {
  msg.textContent = text;
  msg.className = isError ? 'message error' : 'message';
}

function nowLocalDateTimeValue() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0, 16);
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
      <input type="number" min="0" value="0" class="goals" />
      <input type="number" min="0" value="0" class="assists" />
      <label><input type="checkbox" class="goalie-start" /> GS</label>
    </div>
  `;
}

async function loadPlayers() {
  const { data, error } = await supabase.from('players').select('*').order('name');
  if (error) throw error;

  playersWrap.innerHTML = `
    <div class="player-row head">
      <div>Player</div><div>G</div><div>A</div><div>Goalie Start</div>
    </div>
    ${data.map((p) => rowTemplate(p)).join('')}
  `;
}

function buildPlayerLines(gameId) {
  const rows = [...playersWrap.querySelectorAll('.player-row[data-player-id]')];
  return rows
    .map((row) => {
      const goals = Number(row.querySelector('.goals').value || 0);
      const assists = Number(row.querySelector('.assists').value || 0);
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
  const gf = Number(document.getElementById('goals-for').value);
  const ga = Number(document.getElementById('goals-against').value);

  if (!date || !['W', 'L'].includes(result) || gf < 0 || ga < 0) {
    throw new Error('Please fill game date, result, and non-negative goals.');
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
  try {
    await loadPlayers();
    await checkAuth();
  } catch (err) {
    showMessage(`Load error: ${err.message}`, true);
  }
})();
