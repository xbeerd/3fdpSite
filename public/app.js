const state = {
  user: null,
  config: {},
  schedule: { entries: [], activeContest: false },
  notes: [],
  events: [],
  subRequests: [],
  weights: [],
  leaderboard: [],
  graphSeries: [],
  adminUsers: [],
  adminSetupOpen: false,
  pushConfigured: false,
  pushSubscribed: false,
  boardMode: "main",
  showAllWeights: false,
  scoreRecaps: [],
  bowlerStats: [],
  editingScoreRecapId: "",
  scorePhotoDataUrl: "",
  editingCalendarEventId: "",
  calendarCursor: new Date().toISOString().slice(0, 7),
  selectedCalendarEventId: null,
  lastImportId: "",
  view: "home"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  setTimeout(() => node.classList.add("hidden"), 3500);
}

function setActionStatus(selector, message) {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("hidden", !message);
}

function updateUndoImportButton() {
  const button = $("#undoCsvImport");
  if (!button) return;
  button.classList.toggle("hidden", !state.lastImportId);
}

function importSummary(data) {
  const parts = [`${data.importedCount || 0} added`];
  if (data.skippedDuplicateCount) parts.push(`${data.skippedDuplicateCount} duplicate${data.skippedDuplicateCount === 1 ? "" : "s"} skipped`);
  if (data.invalidCount) parts.push(`${data.invalidCount} invalid row${data.invalidCount === 1 ? "" : "s"} skipped`);
  return `Schedule upload complete: ${parts.join(", ")}.`;
}

function calendarEventKey(eventItem) {
  return [
    eventItem.date,
    eventItem.lane,
    eventItem.opponent,
    eventItem.startTime || state.config.bowlingStartTime,
    eventItem.practiceTime || state.config.practiceStartTime,
    eventItem.location
  ].map((value) => String(value || "").trim().toLowerCase()).join("|");
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function setView(view) {
  state.view = state.user ? view : "login";
  $$(".view").forEach((node) => node.classList.add("hidden"));
  const active = $(`#${state.view}View`);
  if (active) active.classList.remove("hidden");
  $("#menu").classList.add("hidden");
  if (state.view === "login") showRegisterForm(false);
}

function showCalendarEvent(eventId) {
  const eventItem = state.events.find((item) => item.id === eventId);
  if (!eventItem) return toast("Calendar event not found.");
  state.selectedCalendarEventId = eventId;
  state.calendarCursor = String(eventItem.date || "").slice(0, 7) || state.calendarCursor;
  setView("calendar");
  renderCalendar();
  $("#calendarList").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openViewFromHash() {
  const view = viewFromHash();
  if (!view) return;
  if (state.user) await refreshBootstrap();
  setView(view);
}

function viewFromHash() {
  const value = window.location.hash.replace("#", "");
  return ["home", "calendar", "scores", "loser", "options", "admin"].includes(value) ? value : "";
}

function renderShell() {
  const needsSetup = Boolean(state.user?.passwordSetupRequired);
  $$(".user-only").forEach((node) => node.classList.toggle("hidden", !state.user));
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", state.user?.role !== "admin"));
  $("#menuAuthBtn").textContent = state.user ? "Log out" : "Login";
  $("#adminSetupCodeField").classList.toggle("hidden", !state.adminSetupOpen);
  if (!state.user) setView("login");
  else if (needsSetup) setView("passwordSetup");
  else setView(state.view === "login" || state.view === "passwordSetup" ? "home" : state.view);
}

function showRegisterForm(show) {
  $("#loginForm").classList.toggle("hidden", show);
  $("#showRegister").classList.toggle("hidden", show);
  $("#registerForm").classList.toggle("hidden", !show);
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  state.pushConfigured = false;
  state.pushSubscribed = false;
  renderShell();
  renderPushControls();
}

function weekLabel(week) {
  return Number(week) === 0 ? "Start" : `Week ${week}`;
}

function formatPercent(value) {
  return value === null || value === undefined ? "Waiting" : `${Number(value).toFixed(2)}%`;
}

function formatDate(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}-${match[3]}-${match[1]}` : text;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  const day = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${date.getFullYear()}`;
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function localYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthLabel(cursor) {
  const [year, month] = cursor.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dateInRange(date, fromDate, toDate) {
  if (!date) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function mainBoardRangeParams() {
  const entries = state.schedule.entries || [];
  if (!entries.length) return { fromWeek: 0, toWeek: "" };
  if (!state.schedule.activeContest) return { fromWeek: 0, toWeek: "" };
  const today = state.schedule.todayYmd || todayYmd();
  const currentIndex = entries.findIndex((entry, index) => {
    const next = entries[index + 1];
    return entry.date <= today && (!next || today < next.date);
  });
  const toEntry = entries[Math.max(currentIndex, 0)] || entries[0];
  const fromEntry = entries[Math.max((toEntry.week || 0) - 1, 0)] || entries[0];
  return { fromWeek: fromEntry.week, toWeek: toEntry.week };
}

function boardRangeLabel() {
  const entries = state.schedule.entries || [];
  if (!entries.length) return "";
  if (!state.schedule.activeContest) return "Full contest range";
  const { fromWeek, toWeek } = mainBoardRangeParams();
  return `${weekLabel(fromWeek)} to ${weekLabel(toWeek)}`;
}

function moveCalendarMonth(delta) {
  const [year, month] = state.calendarCursor.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  state.calendarCursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  renderCalendar();
}

function selectedCalendarEvent() {
  return state.events.find((eventItem) => eventItem.id === state.selectedCalendarEventId) || null;
}

function scoreRecapForDate(date) {
  return state.scoreRecaps.find((recap) => recap.date === date) || null;
}

function showScoreRecap(recapId) {
  const recap = state.scoreRecaps.find((item) => item.id === recapId);
  if (!recap) return toast("Score recap not found.");
  setView("scores");
  renderScores();
  const node = document.querySelector(`[data-score-recap-id="${CSS.escape(recapId)}"]`);
  if (node) {
    node.classList.add("is-highlighted");
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => node.classList.remove("is-highlighted"), 2800);
  }
}

function ensureSelectedCalendarEvent() {
  if (selectedCalendarEvent()) return;
  const today = todayYmd();
  const eventsInMonth = state.events
    .filter((eventItem) => String(eventItem.date || "").startsWith(state.calendarCursor))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  state.selectedCalendarEventId = (
    eventsInMonth.find((eventItem) => eventItem.date >= today) ||
    eventsInMonth[0] ||
    [...state.events].sort((a, b) => String(a.date).localeCompare(String(b.date))).find((eventItem) => eventItem.date >= today) ||
    state.events[0] ||
    null
  )?.id || null;
}

async function refreshBootstrap() {
  const data = await api("/api/bootstrap");
  state.config = data.config;
  state.schedule = data.schedule;
  state.notes = data.notes;
  state.events = data.events;
  state.subRequests = data.subRequests;
  state.adminSetupOpen = Boolean(data.adminSetupOpen);
  renderHome();
  renderCalendar();
  renderContestHeader();
  renderProfileOptions();
  if (state.user) await refreshWeightsAndBoard();
  if (state.user) await refreshScores();
  if (state.user) await refreshPushState();
  if (state.user?.role === "admin") await refreshAdmin();
}

async function refreshWeightsAndBoard() {
  const weights = await api("/api/weights");
  state.weights = weights.weights;
  state.schedule = weights.schedule;
  await refreshBoardOnly();
  renderWeights();
}

async function refreshBoardOnly() {
  const { fromWeek, toWeek } = mainBoardRangeParams();
  const dashboard = await api(`/api/biggest-loser/dashboard?fromWeek=${fromWeek}&toWeek=${toWeek}`);
  state.leaderboard = dashboard.leaderboard;
  state.graphSeries = dashboard.graphSeries;
  state.schedule = dashboard.schedule;
  renderContestHeader();
  renderBoard();
}

async function refreshScores() {
  if (!state.user) return;
  const data = await api("/api/scores/dashboard");
  state.scoreRecaps = data.recaps;
  state.bowlerStats = data.bowlers;
  renderScores();
}

async function refreshAdmin() {
  const data = await api("/api/admin/users");
  state.adminUsers = data.users;
  renderAdmin();
}

async function refreshNotes() {
  const data = await api("/api/notes");
  state.notes = data.notes;
  renderHome();
}

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function renderPushControls(message = "") {
  const controls = $("#pushControls");
  if (!controls) return;
  const visible = Boolean(state.user) && pushSupported();
  controls.classList.toggle("hidden", !visible);
  if (!visible) return;
  $("#enablePush").classList.toggle("hidden", state.pushSubscribed);
  $("#disablePush").classList.toggle("hidden", !state.pushSubscribed);
  $("#pushStatus").textContent = message || (state.pushSubscribed ? "Sub alerts enabled." : "Sub alerts off.");
}

function renderProfileOptions() {
  const form = $("#profileForm");
  if (!form || !state.user) return;
  form.elements.recapName.value = state.user.recapName || "";
}

async function pushRegistration() {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js");
}

async function refreshPushState() {
  if (!pushSupported() || !state.user) {
    renderPushControls();
    return;
  }
  try {
    const key = await api("/api/push/public-key");
    state.pushConfigured = Boolean(key.configured && key.publicKey);
    const registration = await pushRegistration();
    const subscription = await registration.pushManager.getSubscription();
    state.pushSubscribed = Boolean(subscription);
    renderPushControls(state.pushConfigured ? "" : "Sub alerts need server setup.");
  } catch {
    state.pushConfigured = false;
    state.pushSubscribed = false;
    renderPushControls("Sub alerts unavailable.");
  }
}

async function enablePushAlerts() {
  if (!pushSupported()) return toast("This browser does not support push alerts.");
  const key = await api("/api/push/public-key");
  if (!key.configured || !key.publicKey) return renderPushControls("Sub alerts need server setup.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return renderPushControls("Sub alerts blocked.");
  const registration = await pushRegistration();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key.publicKey)
  });
  await api("/api/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription }) });
  state.pushSubscribed = true;
  renderPushControls("Sub alerts enabled.");
  toast("Sub alerts enabled.");
}

async function disablePushAlerts() {
  const previousSubscribed = state.pushSubscribed;
  state.pushSubscribed = false;
  renderPushControls("Sub alerts off.");
  const registration = await pushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  try {
    if (subscription) {
      await api("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe();
    }
    toast("Sub alerts disabled.");
  } catch (error) {
    state.pushSubscribed = previousSubscribed;
    renderPushControls("Sub alerts still enabled.");
    throw error;
  }
}

function renderHome() {
  $("#subSummary").innerHTML = state.subRequests.length
    ? state.subRequests.map((request) => `
      <article class="summary-item">
        <strong>Sub needed:</strong> ${escapeHtml(request.event?.title || "Bowling")}
        <span>${escapeHtml(formatDate(request.event?.date || ""))}</span>
        <button class="small ghost" type="button" data-open-sub-event="${request.eventId}">View on calendar</button>
      </article>
    `).join("")
    : `<p class="hint">No open sub requests right now.</p>`;

  $("#notesList").innerHTML = state.notes.length
    ? state.notes.map(renderNote).join("")
    : `<p class="empty">No notes yet.</p>`;
  renderPushControls();
}

function renderNote(note) {
  const adminControls = state.user?.role === "admin"
    ? `
      <div class="row-actions note-actions">
        <button class="small ghost" type="button" data-edit-note="${note.id}">Edit</button>
        <button class="small danger" type="button" data-delete-note="${note.id}">Delete</button>
      </div>
    `
    : "";
  const comments = note.comments?.length
    ? note.comments.map((comment) => `
      <article class="comment-item">
        <strong>${escapeHtml(comment.username)}</strong>
        <p>${escapeHtml(comment.text)}</p>
        <span>${formatDateTime(comment.createdAt)}</span>
      </article>
    `).join("")
    : `<p class="hint">No replies yet.</p>`;

  return `
    <article class="feed-item" data-note-id="${note.id}">
      <div class="feed-heading">
        <div>
          <strong>${escapeHtml(note.username)}</strong>
          <span>${formatDateTime(note.createdAt)}${note.updatedAt ? " - edited" : ""}</span>
        </div>
        ${adminControls}
      </div>
      <p>${escapeHtml(note.text)}</p>
      <div class="comments">
        ${comments}
        <form class="comment-form" data-comment-form="${note.id}">
          <label>Reply <textarea name="text" rows="2" placeholder="Write a reply..."></textarea></label>
          <button class="small" type="submit">Post reply</button>
        </form>
      </div>
    </article>
  `;
}

function renderCalendar() {
  ensureSelectedCalendarEvent();
  renderCalendarGrid();
  const quickForm = $("#quickEventForm");
  if (quickForm && !quickForm.elements.date.value) {
    quickForm.elements.date.value = todayYmd();
    quickForm.elements.startTime.value = state.config.bowlingStartTime || "";
    quickForm.elements.practiceTime.value = state.config.practiceStartTime || "";
  }

  $("#calendarList").innerHTML = renderSelectedCalendarEvent();
}

function resetCalendarEventForm() {
  const form = $("#quickEventForm");
  if (!form) return;
  state.editingCalendarEventId = "";
  form.reset();
  form.elements.date.value = todayYmd();
  form.elements.startTime.value = state.config.bowlingStartTime || "";
  form.elements.practiceTime.value = state.config.practiceStartTime || "";
  form.querySelector("button[type='submit']").textContent = "Add event";
  $("#cancelEventEdit")?.classList.add("hidden");
}

function editCalendarEvent(eventId) {
  const eventItem = state.events.find((item) => item.id === eventId);
  const form = $("#quickEventForm");
  if (!eventItem || !form) return toast("Calendar event not found.");
  state.editingCalendarEventId = eventId;
  form.elements.date.value = eventItem.date || "";
  form.elements.title.value = eventItem.title || "";
  form.elements.location.value = eventItem.location || "";
  form.elements.lane.value = eventItem.lane || "";
  form.elements.opponent.value = eventItem.opponent || "";
  form.elements.startTime.value = eventItem.startTime || "";
  form.elements.practiceTime.value = eventItem.practiceTime || "";
  form.querySelector("button[type='submit']").textContent = "Save event";
  $("#cancelEventEdit")?.classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSelectedCalendarEvent() {
  const eventItem = selectedCalendarEvent();
  if (!state.events.length) return `<p class="empty">No schedule loaded yet.</p>`;
  if (!eventItem) return `<p class="empty">Select an event on the calendar to view details.</p>`;
  const request = state.subRequests.find((item) => item.eventId === eventItem.id);
  const recap = scoreRecapForDate(eventItem.date);
  const adminControls = state.user?.role === "admin"
    ? `
      <button class="small ghost" type="button" data-edit-event="${eventItem.id}">Edit event</button>
      <button class="small danger" type="button" data-delete-event="${eventItem.id}">Remove event</button>
    `
    : "";
  return `
    <article id="event-${eventItem.id}" class="event-card">
      <div>
        <p class="eyebrow">Selected event</p>
        <h3>${escapeHtml(eventItem.title || "Bowling")}</h3>
        <p>${escapeHtml(formatDate(eventItem.date))} - practice ${escapeHtml(eventItem.practiceTime || "")}</p>
        <p>Start ${escapeHtml(eventItem.startTime || "")} - Lane ${escapeHtml(eventItem.lane || "TBD")} - ${escapeHtml(eventItem.opponent || "Opponent TBD")}</p>
        ${eventItem.location ? `<p>Location: ${escapeHtml(eventItem.location)}</p>` : ""}
      </div>
      <div class="row-actions">
        <button class="small ghost" type="button" data-ics="${eventItem.id}">Add to Calendar</button>
        ${recap ? `<button class="small ghost" type="button" data-view-score-recap="${recap.id}">View recap</button>` : ""}
        <button class="small" type="button" data-sub-request="${eventItem.id}">Need a sub</button>
        ${adminControls}
      </div>
      ${request ? renderSubRequest(request) : ""}
    </article>
  `;
}

function renderCalendarGrid() {
  const [year, month] = state.calendarCursor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const eventsByDate = state.events.reduce((map, eventItem) => {
    map.set(eventItem.date, [...(map.get(eventItem.date) || []), eventItem]);
    return map;
  }, new Map());

  $("#calendarMonthLabel").textContent = monthLabel(state.calendarCursor);
  $("#calendarGrid").innerHTML = `
    ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-day-name">${day}</div>`).join("")}
    ${days.map((date) => {
      const ymd = localYmd(date);
      const events = eventsByDate.get(ymd) || [];
      return `
        <article class="calendar-day ${date.getMonth() === month - 1 ? "" : "is-muted"} ${ymd === todayYmd() ? "is-today" : ""}">
          <strong>${date.getDate()}</strong>
          ${events.map((eventItem) => {
            const request = state.subRequests.find((item) => item.eventId === eventItem.id);
            return `
              <button class="calendar-event ${eventItem.id === state.selectedCalendarEventId ? "is-selected" : ""}" type="button" data-select-event="${eventItem.id}">
                ${escapeHtml(eventItem.opponent || eventItem.title || "Bowling")}
                ${request ? `<span>Sub needed</span>` : ""}
              </button>
            `;
          }).join("")}
        </article>
      `;
    }).join("")}
  `;
}

function renderSubRequest(request) {
  const yes = request.responses.filter((item) => item.response === "can").map((item) => item.username).join(", ") || "No one yet";
  const no = request.responses.filter((item) => item.response === "cant").map((item) => item.username).join(", ") || "No one yet";
  const canManage = state.user?.id === request.requestedByUserId || state.user?.role === "admin";
  const ownerControls = canManage
    ? `
      <button class="small ghost" type="button" data-edit-sub-request="${request.id}">Edit request</button>
      <button class="small danger" type="button" data-delete-sub-request="${request.id}">Cancel request</button>
    `
    : "";
  return `
    <div class="sub-box">
      <strong>${escapeHtml(request.requestedBy)} needs a sub</strong>
      <p>${escapeHtml(request.note || "")}${request.updatedAt ? ` <span class="muted">(edited)</span>` : ""}</p>
      <p><b>Can:</b> ${escapeHtml(yes)}</p>
      <p><b>Can't:</b> ${escapeHtml(no)}</p>
      <div class="row-actions">
        <button class="small" type="button" data-sub-response="${request.id}" data-response="can">I can sub</button>
        <button class="small ghost" type="button" data-sub-response="${request.id}" data-response="cant">I can't sub</button>
        ${ownerControls}
      </div>
    </div>
  `;
}

function renderContestHeader() {
  $("#contestWindow").textContent = state.config.contestStartDate && state.config.contestEndDate
    ? `${formatDate(state.config.contestStartDate)} to ${formatDate(state.config.contestEndDate)}`
    : "Not configured";
  $("#contestStatus").textContent = state.schedule.activeContest
    ? "Contest active. Latest entry by Thursday 6pm Central counts for each week."
    : "No active contest. Showing your personal graph.";

  const progress = calculatePersonalProgress();
  $("#myProgress").textContent = progress === null ? "No entries yet" : formatPercent(progress);
}

function calculatePersonalProgress() {
  if (!state.weights.length) return null;
  const first = state.weights[0];
  const latest = state.weights[state.weights.length - 1];
  if (!first || !latest || first.weight <= 0) return null;
  return ((latest.weight - first.weight) / first.weight) * 100;
}

function renderWeights() {
  const sorted = [...state.weights].sort((a, b) => String(b.entryDate || b.date).localeCompare(String(a.entryDate || a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const visible = state.showAllWeights ? sorted : sorted.slice(0, 8);
  $("#myWeights").innerHTML = visible.length
    ? visible.map((entry) => `
      <tr>
        <td>${escapeHtml(formatDate(entry.entryDate || entry.date))}</td>
        <td>${escapeHtml(entry.weight)}</td>
        <td>${formatDateTime(entry.createdAt)}</td>
        <td class="row-actions">
          <button class="small ghost" type="button" data-edit-weight="${entry.id}">Edit</button>
          <button class="small danger" type="button" data-delete-weight="${entry.id}">Delete</button>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="4" class="empty">No weights entered yet.</td></tr>`;
  const toggle = $("#toggleWeightLog");
  toggle.classList.toggle("hidden", sorted.length <= 8);
  toggle.textContent = state.showAllWeights ? "Show fewer entries" : `Show all ${sorted.length} entries`;
}

function renderBoard() {
  const isPersonal = state.boardMode === "personal";
  $("#boardModeControls [data-board-mode='main']").classList.toggle("is-active", !isPersonal);
  $("#boardModeControls [data-board-mode='personal']").classList.toggle("is-active", isPersonal);
  $("#personalRangeForm").classList.toggle("hidden", !isPersonal);
  $("#boardEyebrow").textContent = isPersonal ? "Personal Board" : "Main Board";
  $("#boardTitle").textContent = isPersonal ? "Your percent change" : "Percentage change";
  $("#boardSubtitle").textContent = isPersonal
    ? "Only you can see your personal board."
    : (state.schedule.activeContest ? `Week-to-week: ${boardRangeLabel()}` : "Contest date range only.");

  if (isPersonal) {
    renderPersonalBoard();
    return;
  }
  $("#boardHead").innerHTML = `<tr><th>Rank</th><th>User</th><th>% Change</th><th>Through</th></tr>`;
  $("#leaderboard").innerHTML = state.leaderboard.length
    ? state.leaderboard.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.user.username)}</td>
        <td>${formatPercent(row.progress?.percentLost)}</td>
        <td>${row.progress?.date ? escapeHtml(formatDate(row.progress.date)) : "Waiting"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4" class="empty">No contest data yet.</td></tr>`;
  renderGraph(state.graphSeries);
}

function filteredPersonalWeights() {
  const form = $("#personalRangeForm");
  const fromDate = form.elements.fromDate.value;
  const toDate = form.elements.toDate.value;
  return state.weights.filter((entry) => dateInRange(entry.entryDate || entry.date, fromDate, toDate));
}

function personalPoints(weights) {
  if (!weights.length) return [];
  const first = weights[0];
  if (!first || first.weight <= 0) return [];
  return weights.map((entry, index) => ({
    week: index,
    label: formatDate(entry.entryDate || entry.date),
    date: entry.entryDate || entry.date,
    weight: entry.weight,
    percentLost: Number((((entry.weight - first.weight) / first.weight) * 100).toFixed(2))
  }));
}

function renderPersonalBoard() {
  const weights = filteredPersonalWeights();
  const points = personalPoints(weights);
  $("#boardHead").innerHTML = `<tr><th>Date</th><th>Weight</th><th>% Change</th><th>Logged</th></tr>`;
  $("#leaderboard").innerHTML = points.length
    ? points.map((point, index) => `
      <tr>
        <td>${escapeHtml(formatDate(point.date))}</td>
        <td>${escapeHtml(point.weight)}</td>
        <td>${formatPercent(point.percentLost)}</td>
        <td>${formatDateTime(weights[index].createdAt)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4" class="empty">No personal entries in this range.</td></tr>`;
  if (!points.length) {
    $("#chart").innerHTML = `<p class="empty">Enter weights to see your graph.</p>`;
    return;
  }
  renderGraph([{
    user: { username: state.user?.username || "You" },
    points
  }]);
}

function renderGraph(series) {
  const active = (series || []).filter((row) => row.points.length);
  if (!active.length) {
    $("#chart").innerHTML = `<p class="empty">Graph appears after weight entries.</p>`;
    return;
  }
  const allPoints = active.flatMap((row) => row.points);
  const weeks = [...new Set(allPoints.map((point) => point.week))].sort((a, b) => a - b);
  const percents = allPoints.map((point) => point.percentLost);
  const min = Math.min(0, ...percents);
  const max = Math.max(1, ...percents);
  const colors = ["#f47b20", "#3f3f46", "#8f8f8f", "#111111", "#c95f11", "#5f6368"];
  const width = 900;
  const height = 340;
  const pad = { top: 24, right: 28, bottom: 42, left: 54 };
  const x = (week) => pad.left + ((week - weeks[0]) / Math.max(weeks[weeks.length - 1] - weeks[0], 1)) * (width - pad.left - pad.right);
  const y = (percent) => pad.top + ((max - percent) / Math.max(max - min, 1)) * (height - pad.top - pad.bottom);
  const grid = [max, (max + min) / 2, min].map((tick) => `
    <line x1="${pad.left}" y1="${y(tick)}" x2="${width - pad.right}" y2="${y(tick)}" class="grid-line"></line>
    <text x="${pad.left - 10}" y="${y(tick) + 4}" class="axis-label" text-anchor="end">${tick.toFixed(1)}%</text>
  `).join("");
  const labels = weeks.map((week) => {
    const point = allPoints.find((candidate) => candidate.week === week);
    return `<text x="${x(week)}" y="${height - 16}" class="axis-label" text-anchor="middle">${escapeHtml(point?.label || weekLabel(week))}</text>`;
  }).join("");
  const lines = active.map((row, index) => {
    const color = colors[index % colors.length];
    const points = row.points.map((point) => `${x(point.week)},${y(point.percentLost)}`).join(" ");
    const dots = row.points.map((point) => `<circle cx="${x(point.week)}" cy="${y(point.percentLost)}" r="5" fill="${color}"><title>${escapeHtml(row.user.username)} ${escapeHtml(formatDate(point.date) || point.label || weekLabel(point.week))}: ${formatPercent(point.percentLost)}</title></circle>`).join("");
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>${dots}`;
  }).join("");
  const legend = active.map((row, index) => `<span class="legend-item"><span class="legend-dot" style="background:${colors[index % colors.length]}"></span>${escapeHtml(row.user.username)} <strong>${formatPercent(row.points.at(-1).percentLost)}</strong></span>`).join("");
  $("#chart").innerHTML = `
    <div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="img">${grid}${labels}${lines}</svg></div>
    <div class="legend">${legend}</div>
  `;
}

function renderScorePhotoPreview() {
  const preview = $("#scorePhotoPreview");
  const scanButton = $("#scanScorePhoto");
  if (!preview) return;
  preview.classList.toggle("hidden", !state.scorePhotoDataUrl);
  preview.innerHTML = state.scorePhotoDataUrl
    ? `
      <img src="${state.scorePhotoDataUrl}" alt="Uploaded recap photo preview">
      <button class="small danger" type="button" data-clear-score-photo>Remove photo</button>
    `
    : "";
  if (scanButton) scanButton.disabled = !state.scorePhotoDataUrl;
}

function resizeScorePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not load that photo."));
      image.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function blankScoreLine(isSub = false) {
  return { bowlerName: "", game1: "", game2: "", game3: "", isSub, paid: !isSub };
}

function scoreLineFields(line, team, index) {
  return `
    <div class="score-line" data-score-team="${team}">
      <label>Bowler <input name="bowlerName" type="text" value="${escapeHtml(line.bowlerName || "")}" placeholder="Bowler"></label>
      <label>1st <input name="game1" type="number" min="0" max="300" value="${escapeHtml(line.game1 ?? "")}"></label>
      <label>2nd <input name="game2" type="number" min="0" max="300" value="${escapeHtml(line.game2 ?? "")}"></label>
      <label>3rd <input name="game3" type="number" min="0" max="300" value="${escapeHtml(line.game3 ?? "")}"></label>
      <label>HDCP <input name="handicapOverride" type="number" min="0" max="300" value="${escapeHtml(line.handicapOverride ?? "")}" placeholder="Auto"></label>
      <label class="check-row compact-check"><input name="isSub" type="checkbox" ${line.isSub ? "checked" : ""}> Sub</label>
      <label class="check-row compact-check"><input name="paid" type="checkbox" ${line.paid === false ? "" : "checked"}> Paid</label>
      <button class="ghost small" type="button" data-remove-score-line="${team}-${index}">Remove</button>
    </div>
  `;
}

function setScoreFormLines(ourLines = [], opponentLines = []) {
  const our = ourLines.length ? ourLines : Array.from({ length: 5 }, () => blankScoreLine(false));
  const opponent = opponentLines.length ? opponentLines : Array.from({ length: 5 }, () => blankScoreLine(false));
  $("#ourScoreLines").innerHTML = our.map((line, index) => scoreLineFields(line, "our", index)).join("");
  $("#opponentScoreLines").innerHTML = opponent.map((line, index) => scoreLineFields(line, "opponent", index)).join("");
}

function mergeScannedLines(existing, scanned) {
  return scanned.length ? scanned : existing;
}

function showScoreForm(recap = null) {
  const form = $("#scoreRecapForm");
  form.classList.remove("hidden");
  state.editingScoreRecapId = recap?.id || "";
  form.elements.date.value = recap?.date || todayYmd();
  form.elements.week.value = recap?.week || "";
  form.elements.ourTeamName.value = recap?.ourTeamName || "3 Finger Death Punch";
  form.elements.opponentTeamName.value = recap?.opponentTeamName || "";
  form.elements.notes.value = recap?.notes || "";
  state.scorePhotoDataUrl = recap?.photoDataUrl || "";
  renderScorePhotoPreview();
  setScoreFormLines(recap?.ourTeamLines, recap?.opponentLines);
  $("#newScoreRecap").textContent = state.editingScoreRecapId ? "Editing recap" : "New recap";
}

function hideScoreForm() {
  state.editingScoreRecapId = "";
  $("#scoreRecapForm").classList.add("hidden");
  $("#scoreRecapForm").reset();
  state.scorePhotoDataUrl = "";
  renderScorePhotoPreview();
  setScoreFormLines();
  $("#newScoreRecap").textContent = "New recap";
}

function readScoreLines(team) {
  return $$(`[data-score-team="${team}"]`).map((line) => ({
    bowlerName: line.querySelector("[name='bowlerName']").value,
    game1: line.querySelector("[name='game1']").value,
    game2: line.querySelector("[name='game2']").value,
    game3: line.querySelector("[name='game3']").value,
    handicapOverride: line.querySelector("[name='handicapOverride']").value,
    isSub: line.querySelector("[name='isSub']").checked,
    paid: line.querySelector("[name='paid']").checked
  })).filter((line) => line.bowlerName || line.game1 || line.game2 || line.game3);
}

function scoreFormPayload(form) {
  const payload = Object.fromEntries(new FormData(form));
  payload.ourTeamLines = readScoreLines("our");
  payload.opponentLines = readScoreLines("opponent");
  payload.photoDataUrl = state.scorePhotoDataUrl;
  return payload;
}

function renderScores() {
  $("#bowlerStats").innerHTML = state.bowlerStats.length
    ? state.bowlerStats.map((bowler) => `
      <tr>
        <td>${escapeHtml(bowler.bowlerName)}</td>
        <td>${bowler.teamType === "our" ? "3FDP" : "Opponent"}</td>
        <td>${bowler.weeksBowled}</td>
        <td>${bowler.subWeeks}</td>
        <td>${bowler.paidSubWeeks}</td>
        <td>${bowler.prizeEligibleWeeks}</td>
        <td>${bowler.average === null ? "-" : bowler.average.toFixed(2)}</td>
        <td>${bowler.handicap === null ? "-" : bowler.handicap}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="8" class="empty">No score recaps entered yet.</td></tr>`;

  $("#scoreRecaps").innerHTML = state.scoreRecaps.length
    ? state.scoreRecaps.map(renderScoreRecap).join("")
    : `<p class="empty">No weekly recaps yet.</p>`;
}

function renderScoreTeam(lines, label) {
  return `
    <div class="score-card">
      <h3>${escapeHtml(label)}</h3>
      <div class="recap-grid recap-grid-head"><span>Bowler</span><span>1st</span><span>2nd</span><span>3rd</span><span>Total</span><span>Flags</span></div>
      ${lines.length ? lines.map((line) => `
        <div class="recap-grid">
          <span>${escapeHtml(line.bowlerName)}</span>
          <span>${line.game1}</span>
          <span>${line.game2}</span>
          <span>${line.game3}</span>
          <span>${line.series}</span>
          <span>${line.isSub ? `Sub${line.paid ? " paid" : " unpaid"}` : (line.paid ? "Paid" : "-")}</span>
        </div>
      `).join("") : `<p class="empty">No opponent scores captured.</p>`}
    </div>
  `;
}

function renderScoreRecap(recap) {
  const adminControls = state.user?.role === "admin"
    ? `
      <div class="row-actions">
        <button class="small ghost" type="button" data-edit-score-recap="${recap.id}">Edit</button>
        <button class="small danger" type="button" data-delete-score-recap="${recap.id}">Delete</button>
      </div>
    `
    : "";
  const totals = recap.totals;
  return `
    <article class="score-recap" data-score-recap-id="${recap.id}">
      <div class="score-recap-heading">
        <div>
          <p class="eyebrow">${escapeHtml(formatDate(recap.date))}${recap.week ? ` - Week ${escapeHtml(recap.week)}` : ""}</p>
          <h3>${escapeHtml(recap.ourTeamName || "3FDP")} vs ${escapeHtml(recap.opponentTeamName || "Opponent")}</h3>
          <p class="muted">Series ${totals.ourSeries}${totals.opponentSeries ? ` to ${totals.opponentSeries}` : ""}${totals.seriesMargin !== null ? ` (${totals.seriesMargin >= 0 ? "+" : ""}${totals.seriesMargin})` : ""}</p>
        </div>
        ${adminControls}
      </div>
      <div class="score-match-summary">
        <span>Game 1: ${totals.ourPins[0]}${totals.opponentPins[0] ? ` / ${totals.opponentPins[0]} (${totals.margins[0] >= 0 ? "+" : ""}${totals.margins[0]})` : ""}</span>
        <span>Game 2: ${totals.ourPins[1]}${totals.opponentPins[1] ? ` / ${totals.opponentPins[1]} (${totals.margins[1] >= 0 ? "+" : ""}${totals.margins[1]})` : ""}</span>
        <span>Game 3: ${totals.ourPins[2]}${totals.opponentPins[2] ? ` / ${totals.opponentPins[2]} (${totals.margins[2] >= 0 ? "+" : ""}${totals.margins[2]})` : ""}</span>
      </div>
      ${recap.notes ? `<p class="admin-note"><strong>Admin note:</strong> ${escapeHtml(recap.notes)}</p>` : ""}
      ${recap.photoDataUrl ? `<img class="score-photo" src="${recap.photoDataUrl}" alt="Recap photo for ${escapeHtml(formatDate(recap.date))}">` : ""}
      <div class="score-team-wrap">
        ${renderScoreTeam(recap.ourTeamLines, recap.ourTeamName || "3FDP")}
        ${renderScoreTeam(recap.opponentLines, recap.opponentTeamName || "Opponent")}
      </div>
    </article>
  `;
}

function renderAdmin() {
  $("#configForm input[name='bowlingStartTime']").value = state.config.bowlingStartTime || "";
  $("#configForm input[name='practiceStartTime']").value = state.config.practiceStartTime || "";
  $("#configForm input[name='contestStartDate']").value = state.config.contestStartDate || "";
  $("#configForm input[name='contestEndDate']").value = state.config.contestEndDate || "";
  $("#adminUsers").innerHTML = state.adminUsers.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.email)}${user.recapName ? `<span class="muted">Recap: ${escapeHtml(user.recapName)}</span>` : ""}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${user.weightsEntered.length}</td>
      <td class="row-actions">
        <button class="small ghost" type="button" data-reset-user="${user.id}">Reset</button>
        <button class="small danger" type="button" data-delete-user="${user.id}">Delete</button>
      </td>
    </tr>
  `).join("");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeCsvDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function csvToEvents(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift());
  const keyForHeader = (header) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      const value = values[index] || "";
      const key = keyForHeader(header);
      if (key === "date") row.date = normalizeCsvDate(value);
      if (key === "location" && value && !row.location) row.location = value;
      if (key === "leaguename") row.leagueName = value;
      if (key === "lane") row.lane = value;
      if (key === "opponent") row.opponent = value;
      if (key === "starttime") row.startTime = value;
      if (key === "practicetime") row.practiceTime = value;
    });
    row.title = row.leagueName
      ? `${row.leagueName}${row.opponent ? ` vs ${row.opponent}` : ""}`
      : `Bowling vs ${row.opponent || "TBD"}`;
    return row;
  });
}

function timeToIcs(time, fallback = "18:30") {
  const value = String(time || fallback).trim();
  const standard = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (standard) return `${standard[1].padStart(2, "0")}${standard[2]}00`;
  const amPm = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (!amPm) return timeToIcs(fallback);
  let hour = Number(amPm[1]);
  const minute = amPm[2] || "00";
  const suffix = amPm[3].toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}${minute}00`;
}

function addMinutesToIcsTime(icsTime, minutesToAdd) {
  const hour = Number(icsTime.slice(0, 2));
  const minute = Number(icsTime.slice(2, 4));
  const total = hour * 60 + minute + minutesToAdd;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}${String(total % 60).padStart(2, "0")}00`;
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function eventToIcsEntry(eventItem, method = "PUBLISH") {
  const date = eventItem.date.replaceAll("-", "");
  const practice = timeToIcs(eventItem.practiceTime || eventItem.startTime);
  const end = addMinutesToIcsTime(practice, 210);
  return [
    "BEGIN:VEVENT",
    `UID:${eventItem.id}@3fdp`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART:${date}T${practice}`,
    `DTEND:${date}T${end}`,
    method === "CANCEL" ? "STATUS:CANCELLED" : "",
    method === "CANCEL" ? "SEQUENCE:1" : "",
    `SUMMARY:${escapeIcs(eventItem.title || "Bowling")}`,
    eventItem.location ? `LOCATION:${escapeIcs(eventItem.location)}` : "",
    `DESCRIPTION:${escapeIcs(`Start ${eventItem.startTime || ""}; Lane ${eventItem.lane || ""}; Opponent ${eventItem.opponent || ""}${eventItem.location ? `; Location ${eventItem.location}` : ""}`)}`,
    "END:VEVENT"
  ].filter(Boolean).join("\r\n");
}

function eventsToIcs(events, method = "PUBLISH") {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//3FDP//Team Site//EN",
    `METHOD:${method}`,
    ...events.map((eventItem) => eventToIcsEntry(eventItem, method)),
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}

function downloadText(filename, text, type = "text/calendar") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const me = await api("/api/me");
  state.user = me.user;
  state.view = viewFromHash() || state.view;
  await refreshBootstrap();
  renderShell();
}

$("#menuBtn").addEventListener("click", () => $("#menu").classList.toggle("hidden"));
$("#refreshApp").addEventListener("click", () => window.location.reload());
$$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$("#showRegister").addEventListener("click", () => showRegisterForm(true));
$("#showLogin").addEventListener("click", () => showRegisterForm(false));
$("#menuAuthBtn").addEventListener("click", async () => {
  if (state.user) await logout();
  else setView("login");
});
window.addEventListener("hashchange", () => openViewFromHash().catch((error) => toast(error.message)));
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "notification-click") {
      openViewFromHash().catch((error) => toast(error.message));
    }
  });
}
$("#subSummary").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-open-sub-event]");
  if (!button) return;
  await refreshBootstrap();
  showCalendarEvent(button.dataset.openSubEvent);
});
$("#enablePush").addEventListener("click", () => enablePushAlerts().catch((error) => toast(error.message)));
$("#disablePush").addEventListener("click", () => disablePushAlerts().catch((error) => toast(error.message)));
$("#prevMonth").addEventListener("click", () => moveCalendarMonth(-1));
$("#nextMonth").addEventListener("click", () => moveCalendarMonth(1));

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/profile", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.user = data.user;
    renderProfileOptions();
    setActionStatus("#profileStatus", "Options saved.");
    toast("Options saved.");
  } catch (error) {
    setActionStatus("#profileStatus", error.message);
    toast(error.message);
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.user = data.user;
    state.view = "home";
    await refreshBootstrap();
    renderShell();
    toast("Logged in.");
  } catch (error) {
    toast(error.message);
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const enableSubAlerts = formData.get("enableSubAlerts") === "on";
  formData.delete("enableSubAlerts");
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    const data = await api("/api/login", { method: "POST", body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }) });
    state.user = data.user;
    state.view = "home";
    await refreshBootstrap();
    renderShell();
    showRegisterForm(false);
    toast("Account created.");
    if (enableSubAlerts) await enablePushAlerts();
  } catch (error) {
    toast(error.message);
  }
});

$("#passwordSetupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/set-password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.user = data.user;
    state.view = "home";
    await refreshBootstrap();
    renderShell();
  } catch (error) {
    toast(error.message);
  }
});

$("#noteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.disabled = true;
  try {
    await api("/api/notes", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    await refreshNotes();
    toast("Blog note saved.");
  } catch (error) {
    toast(error.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});

$("#notesList").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-note]");
  const del = event.target.closest("[data-delete-note]");
  const actionButton = edit || del;
  if (actionButton) actionButton.disabled = true;
  let previousNotes = null;
  try {
    if (edit) {
      const note = state.notes.find((item) => item.id === edit.dataset.editNote);
      if (!note) return;
      const text = prompt("Edit blog entry:", note.text);
      if (text === null) return;
      await api(`/api/notes/${edit.dataset.editNote}`, { method: "PUT", body: JSON.stringify({ text }) });
      await refreshNotes();
      toast("Blog entry updated.");
      return;
    }
    if (del && confirm("Delete this blog entry and its replies?")) {
      const noteId = del.dataset.deleteNote;
      previousNotes = [...state.notes];
      state.notes = state.notes.filter((note) => note.id !== noteId);
      renderHome();
      await api(`/api/notes/${noteId}`, { method: "DELETE" });
      await refreshNotes();
      state.notes = state.notes.filter((note) => note.id !== noteId);
      renderHome();
      toast("Blog entry deleted.");
    }
  } catch (error) {
    if (del && previousNotes) {
      state.notes = previousNotes;
      renderHome();
    }
    toast(error.message);
  } finally {
    if (actionButton?.isConnected) actionButton.disabled = false;
  }
});

$("#notesList").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comment-form]");
  if (!form) return;
  event.preventDefault();
  try {
    const data = await api(`/api/notes/${form.dataset.commentForm}/comments`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.notes = data.notes;
    form.reset();
    renderHome();
    toast("Reply posted.");
  } catch (error) {
    toast(error.message);
  }
});

$("#calendarList").addEventListener("click", async (event) => {
  const subButton = event.target.closest("[data-sub-request]");
  const responseButton = event.target.closest("[data-sub-response]");
  const icsButton = event.target.closest("[data-ics]");
  const viewRecapButton = event.target.closest("[data-view-score-recap]");
  const editEventButton = event.target.closest("[data-edit-event]");
  const deleteEventButton = event.target.closest("[data-delete-event]");
  const editSubButton = event.target.closest("[data-edit-sub-request]");
  const deleteSubButton = event.target.closest("[data-delete-sub-request]");
  const actionButton = subButton || responseButton || viewRecapButton || editEventButton || deleteEventButton || editSubButton || deleteSubButton;
  if (actionButton) actionButton.disabled = true;
  let previousEvents = null;
  let previousSubRequests = null;
  let previousSelection = null;
  try {
    if (icsButton) {
      const eventItem = state.events.find((item) => item.id === icsButton.dataset.ics);
      if (eventItem) downloadText(`${formatDate(eventItem.date)}-bowling.ics`, eventsToIcs([eventItem]));
    }
    if (viewRecapButton) {
      showScoreRecap(viewRecapButton.dataset.viewScoreRecap);
      return;
    }
    if (editEventButton) {
      editCalendarEvent(editEventButton.dataset.editEvent);
      return;
    }
    if (deleteEventButton && confirm("Remove this calendar event and any related sub requests?")) {
      const eventId = deleteEventButton.dataset.deleteEvent;
      previousEvents = [...state.events];
      previousSubRequests = [...state.subRequests];
      previousSelection = state.selectedCalendarEventId;
      state.events = state.events.filter((eventItem) => eventItem.id !== eventId);
      state.subRequests = state.subRequests.filter((request) => request.eventId !== eventId);
      if (state.selectedCalendarEventId === eventId) state.selectedCalendarEventId = null;
      renderHome();
      renderCalendar();
      const data = await api(`/api/calendar/events/${deleteEventButton.dataset.deleteEvent}`, { method: "DELETE" });
      state.events = data.events.filter((eventItem) => eventItem.id !== eventId);
      state.subRequests = data.subRequests.filter((request) => request.eventId !== eventId);
      renderHome();
      renderCalendar();
      toast(`${data.removedCount || 1} calendar event${data.removedCount === 1 ? "" : "s"} removed.`);
      return;
    }
    if (subButton) {
      const note = prompt("Anything people should know?");
      const data = await api("/api/sub-requests", { method: "POST", body: JSON.stringify({ eventId: subButton.dataset.subRequest, note }) });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
      return;
    }
    if (responseButton) {
      const data = await api(`/api/sub-requests/${responseButton.dataset.subResponse}/respond`, { method: "POST", body: JSON.stringify({ response: responseButton.dataset.response }) });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
      return;
    }
    if (editSubButton) {
      const request = state.subRequests.find((item) => item.id === editSubButton.dataset.editSubRequest);
      if (!request) return;
      const note = prompt("Edit sub request note:", request.note || "");
      if (note === null) return;
      const data = await api(`/api/sub-requests/${editSubButton.dataset.editSubRequest}`, { method: "PUT", body: JSON.stringify({ note }) });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
      toast("Sub request updated.");
      return;
    }
    if (deleteSubButton && confirm("Cancel this sub request?")) {
      const request = state.subRequests.find((item) => item.id === deleteSubButton.dataset.deleteSubRequest);
      previousSubRequests = [...state.subRequests];
      if (request) state.subRequests = state.subRequests.filter((item) => item.eventId !== request.eventId);
      else state.subRequests = state.subRequests.filter((item) => item.id !== deleteSubButton.dataset.deleteSubRequest);
      renderHome();
      renderCalendar();
      const data = await api(`/api/sub-requests/${deleteSubButton.dataset.deleteSubRequest}`, { method: "DELETE" });
      if (request) state.subRequests = state.subRequests.filter((item) => item.eventId !== request.eventId);
      else state.subRequests = state.subRequests.filter((item) => item.id !== deleteSubButton.dataset.deleteSubRequest);
      renderHome();
      renderCalendar();
      state.subRequests = request
        ? data.subRequests.filter((item) => item.eventId !== request.eventId)
        : data.subRequests.filter((item) => item.id !== deleteSubButton.dataset.deleteSubRequest);
      renderHome();
      renderCalendar();
      toast(`${data.removedCount || 1} sub request${data.removedCount === 1 ? "" : "s"} canceled.`);
    }
  } catch (error) {
    if (deleteEventButton && previousEvents && previousSubRequests) {
      state.events = previousEvents;
      state.subRequests = previousSubRequests;
      state.selectedCalendarEventId = previousSelection;
      renderHome();
      renderCalendar();
    }
    if (deleteSubButton && previousSubRequests) {
      state.subRequests = previousSubRequests;
      renderHome();
      renderCalendar();
    }
    toast(error.message);
  } finally {
    if (actionButton?.isConnected) actionButton.disabled = false;
  }
});

$("#calendarGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-event]");
  if (!button) return;
  state.selectedCalendarEventId = button.dataset.selectEvent;
  renderCalendar();
  $("#calendarList").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#downloadAllIcs").addEventListener("click", () => {
  if (!state.events.length) return toast("No events to download.");
  downloadText("3fdp-season.ics", eventsToIcs(state.events));
});

$("#downloadCancelIcs").addEventListener("click", () => {
  if (!state.events.length) return toast("No events to remove.");
  downloadText("3fdp-season-cancel.ics", eventsToIcs(state.events, "CANCEL"));
});

$("#cancelEventEdit").addEventListener("click", () => resetCalendarEventForm());

$("#quickEventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = Object.fromEntries(new FormData(form));
    const editingEventId = state.editingCalendarEventId;
    payload.title = String(payload.title || "").trim() || (payload.opponent ? `Bowling vs ${payload.opponent}` : "Bowling");
    if (editingEventId) payload.id = editingEventId;
    const data = await api("/api/calendar/events", { method: "POST", body: JSON.stringify(payload) });
    state.events = data.events;
    state.selectedCalendarEventId = editingEventId || [...state.events].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id || state.selectedCalendarEventId;
    if (editingEventId) state.calendarCursor = String(payload.date || "").slice(0, 7) || state.calendarCursor;
    resetCalendarEventForm();
    renderCalendar();
    toast(editingEventId ? "Calendar event updated." : (data.skippedDuplicateCount ? "Duplicate event skipped." : "Calendar event added."));
  } catch (error) {
    toast(error.message);
  }
});

$("#weightForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  if (!payload.date) payload.date = todayYmd();
  try {
    const data = await api("/api/weights", { method: "POST", body: JSON.stringify(payload) });
    state.weights = data.weights;
    form.reset();
    renderContestHeader();
    renderWeights();
    renderBoard();
    await refreshBoardOnly();
    toast("Weight saved.");
  } catch (error) {
    toast(error.message);
  }
});

$("#myWeights").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-weight]");
  const deleteButton = event.target.closest("[data-delete-weight]");
  if (!editButton && !deleteButton) return;
  const actionButton = editButton || deleteButton;
  const weightId = (editButton || deleteButton).dataset.editWeight || (editButton || deleteButton).dataset.deleteWeight;
  const entry = state.weights.find((item) => item.id === weightId);
  if (!entry) return toast("Weight entry not found.");
  const previousWeights = [...state.weights];
  actionButton.disabled = true;
  try {
    if (editButton) {
      const date = prompt("Entry date:", entry.entryDate || entry.date || todayYmd());
      if (!date) return;
      const weight = prompt("Weight:", entry.weight);
      if (!weight) return;
      const data = await api(`/api/weights/${weightId}`, { method: "PUT", body: JSON.stringify({ date, weight }) });
      state.weights = data.weights;
      renderContestHeader();
      renderWeights();
      renderBoard();
      await refreshBoardOnly();
      toast("Weight entry updated.");
    }
    if (deleteButton && confirm("Delete this weight entry?")) {
      state.weights = state.weights.filter((item) => item.id !== weightId);
      renderContestHeader();
      renderWeights();
      renderBoard();
      const data = await api(`/api/weights/${weightId}`, { method: "DELETE" });
      state.weights = data.weights.filter((item) => item.id !== weightId);
      renderContestHeader();
      renderWeights();
      renderBoard();
      await refreshBoardOnly();
      toast("Weight entry deleted.");
    }
  } catch (error) {
    if (deleteButton) {
      state.weights = previousWeights;
      renderContestHeader();
      renderWeights();
      renderBoard();
    }
    toast(error.message);
  } finally {
    if (actionButton.isConnected) actionButton.disabled = false;
  }
});

$("#boardModeControls").addEventListener("click", (event) => {
  const button = event.target.closest("[data-board-mode]");
  if (!button) return;
  state.boardMode = button.dataset.boardMode;
  renderBoard();
});

$("#personalRangeForm").addEventListener("change", renderBoard);

$("#clearPersonalRange").addEventListener("click", () => {
  const form = $("#personalRangeForm");
  form.reset();
  renderBoard();
});

$("#toggleWeightLog").addEventListener("click", () => {
  state.showAllWeights = !state.showAllWeights;
  renderWeights();
});

$("#newScoreRecap").addEventListener("click", () => showScoreForm());

$("#cancelScoreEdit").addEventListener("click", () => hideScoreForm());

$("#scoreRecapForm").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-score-line]");
  const remove = event.target.closest("[data-remove-score-line]");
  if (add) {
    const target = add.dataset.addScoreLine === "our" ? $("#ourScoreLines") : $("#opponentScoreLines");
    target.insertAdjacentHTML("beforeend", scoreLineFields(blankScoreLine(add.dataset.addScoreLine !== "our"), add.dataset.addScoreLine, target.children.length));
  }
  if (remove) {
    const line = remove.closest(".score-line");
    if (line) line.remove();
  }
  if (event.target.closest("[data-clear-score-photo]")) {
    state.scorePhotoDataUrl = "";
    const input = $("#scoreRecapForm input[name='recapPhoto']");
    if (input) input.value = "";
    renderScorePhotoPreview();
  }
});

$("#scoreRecapForm").addEventListener("change", (event) => {
  const fileInput = event.target.closest("[name='recapPhoto']");
  if (fileInput) {
    const file = fileInput.files[0];
    if (!file) return;
    resizeScorePhoto(file)
      .then((dataUrl) => {
        state.scorePhotoDataUrl = dataUrl;
        renderScorePhotoPreview();
        toast("Recap photo ready.");
      })
      .catch((error) => toast(error.message));
    return;
  }
  const checkbox = event.target.closest("[name='isSub']");
  if (!checkbox) return;
  const line = checkbox.closest(".score-line");
  const paid = line?.querySelector("[name='paid']");
  if (paid && checkbox.checked && paid.checked) paid.checked = false;
  if (paid && !checkbox.checked && !paid.checked) paid.checked = true;
});

$("#scanScorePhoto").addEventListener("click", async () => {
  if (!state.scorePhotoDataUrl) return toast("Upload a recap photo first.");
  const button = $("#scanScorePhoto");
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Scanning...";
  try {
    const existingOur = readScoreLines("our");
    const existingOpponent = readScoreLines("opponent");
    const data = await api("/api/scores/scan", { method: "POST", body: JSON.stringify({ photoDataUrl: state.scorePhotoDataUrl }) });
    if (data.ourTeamName) $("#scoreRecapForm").elements.ourTeamName.value = data.ourTeamName;
    if (data.opponentTeamName) $("#scoreRecapForm").elements.opponentTeamName.value = data.opponentTeamName;
    setScoreFormLines(
      mergeScannedLines(existingOur, data.ourTeamLines || []),
      mergeScannedLines(existingOpponent, data.opponentLines || [])
    );
    const warningText = data.warnings?.length ? ` ${data.warnings.join(" ")}` : "";
    toast(`Photo scanned. Review the scores before saving.${warningText}`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = originalText;
    button.disabled = !state.scorePhotoDataUrl;
  }
});

$("#scoreRecapForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.disabled = true;
  try {
    const payload = scoreFormPayload(form);
    if (!payload.ourTeamLines.length && state.scorePhotoDataUrl) {
      throw new Error("Scan the recap photo first, or manually add at least one 3FDP bowler row.");
    }
    const method = state.editingScoreRecapId ? "PUT" : "POST";
    const path = state.editingScoreRecapId ? `/api/scores/recaps/${state.editingScoreRecapId}` : "/api/scores/recaps";
    const data = await api(path, { method, body: JSON.stringify(payload) });
    state.scoreRecaps = data.recaps;
    state.bowlerStats = data.bowlers;
    hideScoreForm();
    renderScores();
    setActionStatus("#scoreStatus", "Score recap saved.");
    toast("Score recap saved.");
  } catch (error) {
    setActionStatus("#scoreStatus", error.message);
    toast(error.message);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});

$("#scoreRecaps").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-score-recap]");
  const del = event.target.closest("[data-delete-score-recap]");
  if (!edit && !del) return;
  const actionButton = edit || del;
  actionButton.disabled = true;
  const previousRecaps = [...state.scoreRecaps];
  const previousBowlers = [...state.bowlerStats];
  try {
    if (edit) {
      const recap = state.scoreRecaps.find((item) => item.id === edit.dataset.editScoreRecap);
      if (recap) showScoreForm(recap);
      return;
    }
    if (del && confirm("Delete this score recap?")) {
      const recapId = del.dataset.deleteScoreRecap;
      state.scoreRecaps = state.scoreRecaps.filter((recap) => recap.id !== recapId);
      renderScores();
      const data = await api(`/api/scores/recaps/${recapId}`, { method: "DELETE" });
      state.scoreRecaps = data.recaps;
      state.bowlerStats = data.bowlers;
      renderScores();
      setActionStatus("#scoreStatus", "Score recap deleted.");
      toast("Score recap deleted.");
    }
  } catch (error) {
    state.scoreRecaps = previousRecaps;
    state.bowlerStats = previousBowlers;
    renderScores();
    setActionStatus("#scoreStatus", error.message);
    toast(error.message);
  } finally {
    if (actionButton?.isConnected) actionButton.disabled = false;
  }
});

$("#configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/admin/config", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.config = data.config;
    state.schedule = data.schedule;
    renderContestHeader();
    renderBoard();
    setActionStatus("#configStatus", "Setup saved.");
    toast("Setup saved.");
  } catch (error) {
    setActionStatus("#configStatus", error.message);
    toast(error.message);
  }
});

$("#csvForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.csv.files[0];
  if (!file) return toast("Choose a CSV file.");
  const action = event.submitter?.value || "upload";
  if (action === "delete" && !confirm("Delete matching schedule events from this CSV?")) return;
  const submitter = event.submitter;
  if (submitter) submitter.disabled = true;
  const previousEvents = [...state.events];
  const previousSubRequests = [...state.subRequests];
  const previousImportId = state.lastImportId;
  try {
    const events = csvToEvents(await file.text());
    const deleteKeys = new Set(events.map(calendarEventKey));
    if (action === "delete") {
      state.events = state.events.filter((eventItem) => !deleteKeys.has(calendarEventKey(eventItem)));
      state.subRequests = state.subRequests.filter((request) => state.events.some((eventItem) => eventItem.id === request.eventId));
      state.lastImportId = "";
      updateUndoImportButton();
      renderHome();
      renderCalendar();
    }
    const data = action === "delete"
      ? await api("/api/calendar/events/delete-by-csv", { method: "POST", body: JSON.stringify({ events }) })
      : await api("/api/calendar/events", { method: "POST", body: JSON.stringify({ events }) });
    state.events = action === "delete"
      ? data.events.filter((eventItem) => !deleteKeys.has(calendarEventKey(eventItem)))
      : data.events;
    state.subRequests = (data.subRequests || state.subRequests).filter((request) => state.events.some((eventItem) => eventItem.id === request.eventId));
    state.lastImportId = action === "upload" ? (data.importId || "") : "";
    updateUndoImportButton();
    state.selectedCalendarEventId = selectedCalendarEvent() ? state.selectedCalendarEventId : null;
    renderHome();
    renderCalendar();
    const message = action === "delete"
      ? `Schedule CSV delete complete: ${data.removedCount || 0} event${data.removedCount === 1 ? "" : "s"} removed${data.invalidCount ? `, ${data.invalidCount} invalid row${data.invalidCount === 1 ? "" : "s"} skipped` : ""}.`
      : importSummary(data);
    setActionStatus("#csvStatus", message);
    form.reset();
    toast(message);
  } catch (error) {
    state.events = previousEvents;
    state.subRequests = previousSubRequests;
    state.lastImportId = previousImportId;
    updateUndoImportButton();
    renderHome();
    renderCalendar();
    setActionStatus("#csvStatus", error.message);
    toast(error.message);
  } finally {
    if (submitter?.isConnected) submitter.disabled = false;
  }
});

$("#undoCsvImport").addEventListener("click", async () => {
  if (!state.lastImportId) return;
  if (!confirm("Undo the last schedule CSV upload?")) return;
  const button = $("#undoCsvImport");
  const importId = state.lastImportId;
  const previousEvents = [...state.events];
  const previousSubRequests = [...state.subRequests];
  const previousImportId = state.lastImportId;
  button.disabled = true;
  try {
    state.events = state.events.filter((eventItem) => eventItem.importId !== importId);
    state.subRequests = state.subRequests.filter((request) => state.events.some((eventItem) => eventItem.id === request.eventId));
    state.lastImportId = "";
    updateUndoImportButton();
    renderHome();
    renderCalendar();
    const data = await api(`/api/calendar/imports/${importId}`, { method: "DELETE" });
    state.events = data.events.filter((eventItem) => eventItem.importId !== importId);
    state.subRequests = data.subRequests.filter((request) => state.events.some((eventItem) => eventItem.id === request.eventId));
    const message = `Last schedule upload undone: ${data.removedCount} event${data.removedCount === 1 ? "" : "s"} removed.`;
    setActionStatus("#csvStatus", message);
    toast(message);
  } catch (error) {
    state.events = previousEvents;
    state.subRequests = previousSubRequests;
    state.lastImportId = previousImportId;
    updateUndoImportButton();
    renderHome();
    renderCalendar();
    setActionStatus("#csvStatus", error.message);
    toast(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

$("#adminCreateUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    form.elements.password.value = "changeme123";
    await refreshAdmin();
    setActionStatus("#userAdminStatus", "User created.");
    toast("User created.");
  } catch (error) {
    setActionStatus("#userAdminStatus", error.message);
    toast(error.message);
  }
});

$("#adminUsers").addEventListener("click", async (event) => {
  const reset = event.target.closest("[data-reset-user]");
  const del = event.target.closest("[data-delete-user]");
  const actionButton = reset || del;
  if (actionButton) actionButton.disabled = true;
  let previousUsers = null;
  try {
    if (reset) {
      const password = prompt("Temporary password:", "changeme123");
      if (!password) return;
      await api(`/api/admin/users/${reset.dataset.resetUser}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
      setActionStatus("#userAdminStatus", "Password reset.");
      toast("Password reset.");
    }
    if (del && confirm("Delete this user and their weights?")) {
      const userId = del.dataset.deleteUser;
      previousUsers = [...state.adminUsers];
      state.adminUsers = state.adminUsers.filter((user) => user.id !== userId);
      renderAdmin();
      await api(`/api/admin/users/${del.dataset.deleteUser}`, { method: "DELETE" });
      await refreshAdmin();
      setActionStatus("#userAdminStatus", "User deleted.");
      toast("User deleted.");
    }
  } catch (error) {
    if (del && previousUsers) {
      state.adminUsers = previousUsers;
      renderAdmin();
    }
    setActionStatus("#userAdminStatus", error.message);
    toast(error.message);
  } finally {
    if (actionButton?.isConnected) actionButton.disabled = false;
  }
});

init().catch((error) => toast(error.message));
