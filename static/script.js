let currentOpponentId = null;
let currentDeckId = null;
let currentGameId = null;
let seatAssignments = [];
let chartPerPlayer = null;
let chartByType = null;
let chartTopTrackers = null;

// -------- Opponents --------
async function loadOpponents() {
  const res = await fetch("/api/opponents");
  const opponents = await res.json();

  const select = document.getElementById("opponents-select");
  select.innerHTML = "";

  opponents.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.name;
    select.appendChild(opt);
  });

  if (opponents.length) {
    currentOpponentId = opponents[0].id;
    await loadDecksForOpponent();
  } else {
    currentOpponentId = null;
    document.getElementById("decks-select").innerHTML = "";
  }
}

async function addOpponent() {
  const input = document.getElementById("opponent-name");
  const name = input.value.trim();
  if (!name) return;

  try {
    const res = await fetch("/api/opponents", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name})
    });
    if (!res.ok) {
      const txt = await res.text();
      alert('Failed to add opponent: ' + txt);
      return;
    }
  } catch (err) {
    console.error('addOpponent error', err);
    alert('Network error when adding opponent');
    return;
  }

  input.value = "";
  await loadOpponents();
}


// -------- Decks --------
async function loadDecksForOpponent() {
  const selectOpp = document.getElementById("opponents-select");
  if (!selectOpp || !selectOpp.value) {
    currentOpponentId = null;
    return;
  }

  currentOpponentId = Number(selectOpp.value);

  const res = await fetch(`/api/opponents/${currentOpponentId}/decks`);
  const decks = await res.json();

  const selectDecks = document.getElementById("decks-select");
  selectDecks.innerHTML = "";

  decks.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    selectDecks.appendChild(opt);
  });

  currentDeckId = decks.length ? decks[0].id : null;
}

async function addDeck() {
  if (!currentOpponentId) return;

  const input = document.getElementById("deck-name");
  const name = input.value.trim();
  if (!name) return;

  await fetch(`/api/opponents/${currentOpponentId}/decks`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({name})
  });

  input.value = "";
  await loadDecksForOpponent();
}


async function startGame() {
  const seatOpps = document.querySelectorAll("select.seat-opponent");
  const seatDecks = document.querySelectorAll("select.seat-deck");

  if (!seatOpps.length || seatOpps.length !== seatDecks.length) {
    alert("Set the number of players and assign opponents first.");
    return;
  }

  const players = [];
  for (let i = 0; i < seatOpps.length; i++) {
    const seat = Number(seatOpps[i].dataset.seat);
    const opponentId = Number(seatOpps[i].value);
    const deckId = Number(seatDecks[i].value);
    if (!opponentId || !deckId) {
      alert(`Seat ${seat} is missing an opponent or deck.`);
      return;
    }
    players.push({ seat, opponent_id: opponentId, deck_id: deckId });
  }

  const res = await fetch("/api/games", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ players })
  });

  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }

  currentGameId = data.id;

  // Show a summary of players (fresh from API)
  const resPlayers = await fetch(`/api/games/${currentGameId}/players`);
  const gamePlayers = await resPlayers.json();   // <— use different name

  const currentGameDiv = document.getElementById("current-game");
  currentGameDiv.innerHTML =
    "Players: " +
    gamePlayers.map(p => `Seat ${p.seat}: ${p.opponent} (${p.deck})`).join(" | ");

  const area = document.getElementById("trackers-area");
  area.innerHTML = trackerControlsHtml(gamePlayers);
  onTrackerTypeChange();
    await loadManagedTrackers();

  await loadGames();
  await loadTrackers();
  // On mobile, switch view to the Table column after starting a game
  try {
    if (window.innerWidth <= 960 && typeof switchMobileTab === 'function') {
      switchMobileTab('table');
    }
  } catch (e) {}
}
function toggleTheme() {
  document.body.classList.toggle("light-theme");
}

function trackerControlsHtml(playersForGame) {
  const optionsHtml = playersForGame.map(
    p => `<option value="${p.seat}">Seat ${p.seat}: ${p.opponent} (${p.deck})</option>`
  ).join("");

  return `
    <div class="row">
      <select id="managed-tracker-select" class="select" onchange="onManagedTrackerChange(this)">
        <option value="">Select tracker...</option>
      </select>
      <select id="tracker-type" class="select" onchange="onTrackerTypeChange()">
        <option value="player">Player</option>
        <option value="yesno">Yes/No</option>
        <option value="number">Number</option>
      </select>
      <select id="tracker-player" class="select">
        ${optionsHtml}
      </select>
      <input id="tracker-number" class="input input-small" type="number" value="0" style="display:none;">
      <button class="btn primary" onclick="addTracker()">Add / update</button>
    </div>
    <div id="trackers-list"></div>
  `;
}

async function loadManagedTrackers() {
  const res = await fetch('/api/managed_trackers');
  const list = await res.json();
  const sel = document.getElementById('managed-tracker-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select tracker...</option>' + list.map(t => `<option value="${t.tracker}" data-type="${t.type}">${t.tracker} (${t.type})</option>`).join('');
  if (current) sel.value = current;
}

function onManagedTrackerChange(el) {
  const opt = el.options[el.selectedIndex];
  const typeSelect = document.getElementById('tracker-type');
  if (!typeSelect) return;
  if (opt && opt.dataset && opt.dataset.type) {
    typeSelect.value = opt.dataset.type;
    typeSelect.disabled = true;
  } else {
    typeSelect.disabled = false;
  }
  onTrackerTypeChange();
}

async function showTrackerUI() {
  const oppName =
    document.querySelector("#opponents-select option:checked")?.textContent || "";
  const deckName =
    document.querySelector("#decks-select option:checked")?.textContent || "";

  const currentGameDiv = document.getElementById("current-game");
  currentGameDiv.innerHTML =
    `Tracking game vs <b>${oppName}</b> using deck <b>${deckName}</b>`;

  const area = document.getElementById("trackers-area");
  area.innerHTML = trackerControlsHtml();
  await loadManagedTrackers();
}

async function loadGames() {
  const res = await fetch("/api/games");
  const games = await res.json();

  const ul = document.getElementById("games-list");
  ul.innerHTML = "";

  games.forEach(g => {
    const li = document.createElement("li");
    li.textContent = `${g.timestamp} — ${g.opponent} (${g.deck})`;
    li.onclick = () => selectGame(g.id, g.opponent, g.deck);
    ul.appendChild(li);
  });
}

async function selectGame(gameId, opponentName, deckName) {
  currentGameId = gameId;

  const players = await (await fetch(`/api/games/${gameId}/players`)).json();
  const currentGameDiv = document.getElementById("current-game");
  currentGameDiv.innerHTML =
    "Players: " + players.map(p => `Seat ${p.seat}: ${p.opponent} (${p.deck})`).join(" | ");

  const area = document.getElementById("trackers-area");
  area.innerHTML = trackerControlsHtml(players);
  onTrackerTypeChange();
  await loadManagedTrackers();
  await loadTrackers();
await updateStats();        // if you still use per-game stats somewhere
await updateOverallStats(); // new global stats

}


// -------- Trackers --------
async function loadTrackers() {
  if (!currentGameId) return;

  const res = await fetch(`/api/games/${currentGameId}/trackers`);
  const trackers = await res.json();

  const container = document.getElementById("trackers-list");
  if (!container) return;
  container.innerHTML = "";

  trackers.forEach(t => {
    const span = document.createElement("span");
    span.className = "tracker-pill";

    const typeLabel =
      t.type === "yesno" ? "YN" :
      t.type === "number" ? "#" :
      "P";

    let label = `[${typeLabel}] ${t.tracker}`;
    if (t.type === "player" && t.player_name) {
      label += ` (${t.player_name})`;
    }
    // For yes/no trackers show Yes/No instead of a number
    if (t.type === 'yesno') {
      label += `: ${t.count ? 'Yes' : 'No'}`;
    } else {
      label += `: ${t.count}`;
    }

    span.innerHTML = `
      <span class="tracker-label">${label}</span>
      <button onclick="incrementTracker(${t.id})">+</button>
      <button onclick="decrementTracker(${t.id})">-</button>
      ${
        t.type === "number"
          ? `<button onclick="setNumberTracker(${t.id}, ${t.count})">set</button>`
          : ""
      }
      <button onclick="deleteTracker(${t.id})">x</button>
    `;
    container.appendChild(span);
  });
}
async function setNumberTracker(id, currentValue) {
  const next = prompt("Set value", String(currentValue ?? 0));
  if (next === null) return;
  const value = Number(next);
  if (Number.isNaN(value)) return;

  await fetch(`/api/games/${currentGameId}/trackers`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ id, action: "set_value", value })
  });
  await loadTrackers();
  await updateStats();
}

async function decrementTracker(id) {
  await fetch(`/api/games/${currentGameId}/trackers`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ id, action: "decrement" })
  });
  await loadTrackers();
await updateStats();        // if you still use per-game stats somewhere
await updateOverallStats(); // new global stats

}

function trackerControlsHtml(playersForGame) {
  const optionsHtml = playersForGame.map(
    p => `<option value="${p.seat}">Seat ${p.seat}: ${p.opponent} (${p.deck})</option>`
  ).join("");

  return `
    <div class="row">
      <select id="managed-tracker-select" class="select" onchange="onManagedTrackerChange(this)">
        <option value="">Select tracker...</option>
      </select>
      <select id="tracker-type" class="select" onchange="onTrackerTypeChange()">
        <option value="player">Player</option>
        <option value="yesno">Yes/No</option>
        <option value="number">Number</option>
      </select>
      <select id="tracker-player" class="select">
        ${optionsHtml}
      </select>
      <input id="tracker-number" class="input input-small" type="number" value="0" style="display:none;">
      <button class="btn primary" onclick="addTracker()">Add / update</button>
    </div>
    <div id="trackers-list"></div>
  `;
}

function onTrackerTypeChange() {
  const typeSelect = document.getElementById("tracker-type");
  const playerSelect = document.getElementById("tracker-player");
  const numberInput = document.getElementById("tracker-number");
  if (!typeSelect) return;

  const type = typeSelect.value;
  if (playerSelect) {
    playerSelect.style.display = (type === "player") ? "inline-block" : "none";
  }
  if (numberInput) {
    numberInput.style.display = (type === "number") ? "inline-block" : "none";
  }
}

async function addTracker() {
  if (!currentGameId) return;

  const sel = document.getElementById('managed-tracker-select');
  const typeSelect = document.getElementById('tracker-type');
  const playerSelect = document.getElementById('tracker-player');
  const numberInput = document.getElementById('tracker-number');
  if (!sel || !typeSelect) return;

  const name = sel.value.trim();
  const trackerType = typeSelect.value || 'player';
  if (!name) {
    alert('Please select a tracker from the managed list.');
    return;
  }

  const payload = { tracker: name, type: trackerType };

  if (trackerType === "player" && playerSelect) {
    payload.player_seat = Number(playerSelect.value);
  } else if (trackerType === "number" && numberInput) {
    payload.value = Number(numberInput.value);
  }

  await fetch(`/api/games/${currentGameId}/trackers`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });

await loadTrackers();
await updateStats();        // if you still use per-game stats somewhere
await updateOverallStats(); // new global stats

}



async function incrementTracker(id) {
  await fetch(`/api/games/${currentGameId}/trackers`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({id})
  });
await loadTrackers();
await updateStats();        // if you still use per-game stats somewhere
await updateOverallStats(); // new global stats
}

async function deleteTracker(id) {
  await fetch(`/api/games/${currentGameId}/trackers`, {
    method: "DELETE",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({id})
  });
  await loadTrackers();
await updateStats();        // if you still use per-game stats somewhere
await updateOverallStats(); // new global stats
}
async function buildSeats() {
  const countInput = document.getElementById("player-count");
  const seatsArea = document.getElementById("seats-area");
  const opponents = await (await fetch("/api/opponents")).json();

  const num = Math.max(2, Math.min(6, Number(countInput.value) || 4));
  countInput.value = num;

  seatsArea.innerHTML = "";
  seatAssignments = [];

  for (let seat = 1; seat <= num; seat++) {
    const wrapper = document.createElement("div");
    wrapper.className = "row";

    const label = document.createElement("span");
    label.textContent = `Seat ${seat}: `;

    const oppSelect = document.createElement("select");
    oppSelect.className = "seat-opponent";
    oppSelect.dataset.seat = seat;

    opponents.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.name;
      oppSelect.appendChild(opt);
    });

    const deckSelect = document.createElement("select");
    deckSelect.className = "seat-deck";
    deckSelect.dataset.seat = seat;

    oppSelect.onchange = () => loadDecksForSeat(seat);

    wrapper.appendChild(label);
    wrapper.appendChild(oppSelect);
    wrapper.appendChild(deckSelect);
    seatsArea.appendChild(wrapper);

    // Initialize deck list for this seat
    await loadDecksForSeat(seat);
  }
}
async function loadDecksForSeat(seat) {
  const oppSelect = document.querySelector(`select.seat-opponent[data-seat="${seat}"]`);
  const deckSelect = document.querySelector(`select.seat-deck[data-seat="${seat}"]`);
  if (!oppSelect || !deckSelect) return;

  const opponentId = Number(oppSelect.value);
  if (!opponentId) {
    deckSelect.innerHTML = "";
    return;
  }

  const res = await fetch(`/api/opponents/${opponentId}/decks`);
  const decks = await res.json();

  deckSelect.innerHTML = "";
  decks.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    deckSelect.appendChild(opt);
  });
}

function switchTab(tab) {
  const items = document.querySelectorAll(".nav-item");
  items.forEach(el => el.classList.toggle("active", el.dataset.tab === tab));

  document.getElementById("tab-table").classList.toggle("active", tab === "table");
  document.getElementById("tab-stats").classList.toggle("active", tab === "stats");

  if (tab === "stats") {
    updateOverallStats();
  }
}

// Mobile: switch which main column is visible (setup/table/recent)
function switchMobileTab(tab) {
  const tabs = document.querySelectorAll('.mobile-tab-btn');
  tabs.forEach(b => {
    const is = b.dataset.tab === tab;
    b.classList.toggle('active', is);
    b.setAttribute('aria-pressed', is ? 'true' : 'false');
  });

  const left = document.querySelector('.panel-left');
  const center = document.querySelector('.panel-center');
  const right = document.querySelector('.panel-right');
  if (!left || !center || !right) return;

  left.classList.toggle('mobile-hidden', tab !== 'setup');
  center.classList.toggle('mobile-hidden', tab !== 'table');
  right.classList.toggle('mobile-hidden', tab !== 'recent');
}
async function updateOverallStats() {
  const res = await fetch("/api/stats/overall");
  const stats = await res.json();

  renderPerPlayerChart(stats.per_player || []);
  renderByTypeChart(stats.by_type || []);
  renderTopTrackersChart(stats.top_trackers || []);
}
function renderPerPlayerChart(data) {
  const ctx = document.getElementById("chart-per-player");
  if (!ctx) return;

  if (chartPerPlayer) chartPerPlayer.destroy();

  const labels = data.map(d => d.player_name);
  const values = data.map(d => d.total_hits);

  chartPerPlayer = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total hits",
        data: values,
        backgroundColor: "rgba(111, 140, 255, 0.6)",
        borderColor: "rgba(111, 140, 255, 1)",
        borderWidth: 1
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      responsive: true,
      scales: {
        x: { ticks: { color: "#a4a7c2" } },
        y: { ticks: { color: "#a4a7c2" }, beginAtZero: true }
      }
    }
  });
}

function renderByTypeChart(data) {
  const ctx = document.getElementById("chart-by-type");
  if (!ctx) return;

  if (chartByType) chartByType.destroy();

  const labels = data.map(d => d.type);
  const values = data.map(d => d.total_hits);

  chartByType = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [
          "rgba(31, 204, 143, 0.7)",   // player
          "rgba(255, 157, 77, 0.7)",   // yes/no
          "rgba(111, 140, 255, 0.7)"   // number
        ]
      }]
    },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { color: "#a4a7c2" } }
      },
      cutout: "60%"
    }
  });
}

function renderTopTrackersChart(data) {
  const ctx = document.getElementById("chart-top-trackers");
  if (!ctx) return;

  if (chartTopTrackers) chartTopTrackers.destroy();

  const labels = data.map(d => d.tracker);
  const values = data.map(d => d.total_hits);

  chartTopTrackers = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total hits",
        data: values,
        backgroundColor: "rgba(255, 99, 132, 0.7)",
        borderColor: "rgba(255, 99, 132, 1)",
        borderWidth: 1
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      responsive: true,
      indexAxis: "y",
      scales: {
        x: { ticks: { color: "#a4a7c2" }, beginAtZero: true },
        y: { ticks: { color: "#a4a7c2" } }
      }
    }
  });
}


async function updateStats() {
  const statsDiv = document.getElementById("stats-content");
  if (!statsDiv) return; // stats panel not present on this page
  if (!currentGameId) {
    statsDiv.innerHTML = '<p class="stats-placeholder">Start a game to see stats.</p>';
    return;
  }

  const res = await fetch(`/api/games/${currentGameId}/stats`);
  const stats = await res.json();
  
  const byType = stats.by_type || [];
  const perPlayer = stats.per_player || [];
  const topTrackers = stats.top_trackers || [];

  statsDiv.innerHTML = `
    <div>
      <div class="stats-section-title">Overview</div>
      ${byType.map(t => `
        <div class="stats-row">
          <span>${t.type === 'player' ? 'Player trackers' : 'Yes/No trackers'}</span>
          <span class="stats-highlight">${t.total_hits}</span>
        </div>
      `).join("") || '<p class="stats-placeholder">No trackers yet.</p>'}
    </div>

    <div style="margin-top:12px;">
      <div class="stats-section-title">Hits per player</div>
      ${perPlayer.map(p => `
        <div class="stats-row">
          <span>${p.player_name}</span>
          <span>${p.total_hits}</span>
        </div>
      `).join("") || '<p class="stats-placeholder">No player trackers yet.</p>'}
    </div>

    <div style="margin-top:12px;">
      <div class="stats-section-title">Top trackers</div>
      ${topTrackers.map(t => `
        <div class="stats-row">
          <span>${t.tracker} <span class="stats-badge">${t.type}</span></span>
          <span>${t.total_hits}</span>
        </div>
      `).join("") || '<p class="stats-placeholder">No trackers yet.</p>'}
    </div>
  `;
}



// -------- Init --------
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadOpponents();
  } catch (err) {
    console.error('loadOpponents failed', err);
  }
  try {
    await loadGames();
  } catch (err) {
    console.error('loadGames failed', err);
  }
  try {
    await loadManagedTrackers();
  } catch (err) {
    console.error('loadManagedTrackers failed', err);
  }
  try {
    // onboarding banner removed from templates; nothing to do here
  } catch (e) {
    // ignore if banner not present
  }
  // Mobile tab behavior: wire up mobile tab buttons and set default on small screens
  try {
    const mobileTabs = document.querySelectorAll('.mobile-tab-btn');
    if (mobileTabs.length) {
      mobileTabs.forEach(b => b.addEventListener('click', () => switchMobileTab(b.dataset.tab)));
      if (window.innerWidth <= 960) {
        // default to table view on mobile
        switchMobileTab('setup');
      }
    }
  } catch (e){}
});
// onboarding helpers removed

