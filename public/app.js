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
  calendarCursor: new Date().toISOString().slice(0, 7),
  selectedCalendarEventId: null,
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
}

function renderShell() {
  const needsSetup = Boolean(state.user?.passwordSetupRequired);
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", state.user?.role !== "admin"));
  $("#menuAuthBtn").textContent = state.user ? "Log out" : "Login";
  $("#adminSetupCodeField").classList.toggle("hidden", !state.adminSetupOpen);
  if (!state.user) setView("login");
  else if (needsSetup) setView("passwordSetup");
  else setView(state.view === "login" || state.view === "passwordSetup" ? "home" : state.view);
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  renderShell();
}

function weekLabel(week) {
  return Number(week) === 0 ? "Start" : `Week ${week}`;
}

function formatPercent(value) {
  return value === null || value === undefined ? "Waiting" : `${Number(value).toFixed(2)}%`;
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

function moveCalendarMonth(delta) {
  const [year, month] = state.calendarCursor.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  state.calendarCursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  renderCalendar();
}

function selectedCalendarEvent() {
  return state.events.find((eventItem) => eventItem.id === state.selectedCalendarEventId) || null;
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
  renderRangeOptions();
  if (state.user) await refreshWeightsAndBoard();
  if (state.user?.role === "admin") await refreshAdmin();
}

async function refreshWeightsAndBoard() {
  const weights = await api("/api/weights");
  state.weights = weights.weights;
  state.schedule = weights.schedule;
  const fromWeek = $("#rangeForm select[name='fromWeek']").value || 0;
  const toWeek = $("#rangeForm select[name='toWeek']").value || "";
  const dashboard = await api(`/api/biggest-loser/dashboard?fromWeek=${fromWeek}&toWeek=${toWeek}`);
  state.leaderboard = dashboard.leaderboard;
  state.graphSeries = dashboard.graphSeries;
  state.schedule = dashboard.schedule;
  renderContestHeader();
  renderWeights();
  renderRangeOptions();
  renderBoard();
}

async function refreshAdmin() {
  const data = await api("/api/admin/users");
  state.adminUsers = data.users;
  renderAdmin();
}

function renderHome() {
  $("#subSummary").innerHTML = state.subRequests.length
    ? state.subRequests.map((request) => `
      <article class="summary-item">
        <strong>Sub needed:</strong> ${escapeHtml(request.event?.title || "Bowling")}
        <span>${escapeHtml(request.event?.date || "")}</span>
      </article>
    `).join("")
    : `<p class="hint">No open sub requests right now.</p>`;

  $("#notesList").innerHTML = state.notes.length
    ? state.notes.map(renderNote).join("")
    : `<p class="empty">No notes yet.</p>`;
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
        <span>${new Date(comment.createdAt).toLocaleString()}</span>
      </article>
    `).join("")
    : `<p class="hint">No replies yet.</p>`;

  return `
    <article class="feed-item" data-note-id="${note.id}">
      <div class="feed-heading">
        <div>
          <strong>${escapeHtml(note.username)}</strong>
          <span>${new Date(note.createdAt).toLocaleString()}${note.updatedAt ? " - edited" : ""}</span>
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

function renderSelectedCalendarEvent() {
  const eventItem = selectedCalendarEvent();
  if (!state.events.length) return `<p class="empty">No schedule loaded yet.</p>`;
  if (!eventItem) return `<p class="empty">Select an event on the calendar to view details.</p>`;
  const request = state.subRequests.find((item) => item.eventId === eventItem.id);
  const adminControls = state.user?.role === "admin"
    ? `<button class="small danger" type="button" data-delete-event="${eventItem.id}">Remove event</button>`
    : "";
  return `
    <article id="event-${eventItem.id}" class="event-card">
      <div>
        <p class="eyebrow">Selected event</p>
        <h3>${escapeHtml(eventItem.title || "Bowling")}</h3>
        <p>${escapeHtml(eventItem.date)} - practice ${escapeHtml(eventItem.practiceTime || "")}</p>
        <p>Start ${escapeHtml(eventItem.startTime || "")} - Lane ${escapeHtml(eventItem.lane || "TBD")} - ${escapeHtml(eventItem.opponent || "Opponent TBD")}</p>
        ${eventItem.location ? `<p>Location: ${escapeHtml(eventItem.location)}</p>` : ""}
      </div>
      <div class="row-actions">
        <button class="small ghost" type="button" data-ics="${eventItem.id}">Add to Calendar</button>
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
    ? `${state.config.contestStartDate} to ${state.config.contestEndDate}`
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
  return ((first.weight - latest.weight) / first.weight) * 100;
}

function renderWeights() {
  $("#myWeights").innerHTML = state.weights.length
    ? state.weights.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.entryDate || entry.date)}</td>
        <td>${escapeHtml(entry.weight)}</td>
        <td>${new Date(entry.createdAt).toLocaleString()}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3" class="empty">No weights entered yet.</td></tr>`;
}

function renderRangeOptions() {
  const from = $("#rangeForm select[name='fromWeek']");
  const to = $("#rangeForm select[name='toWeek']");
  const currentFrom = from.value || "0";
  const currentTo = to.value || "";
  from.innerHTML = state.schedule.entries.map((entry) => `<option value="${entry.week}">${weekLabel(entry.week)}</option>`).join("");
  to.innerHTML = `<option value="">Latest</option>` + state.schedule.entries.map((entry) => `<option value="${entry.week}">${weekLabel(entry.week)}</option>`).join("");
  from.value = currentFrom;
  to.value = currentTo;
}

function renderBoard() {
  if (!state.schedule.activeContest) {
    $("#leaderboard").innerHTML = `<tr><td colspan="4" class="empty">No active contest.</td></tr>`;
    renderPersonalGraph();
    return;
  }
  $("#leaderboard").innerHTML = state.leaderboard.length
    ? state.leaderboard.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.user.username)}</td>
        <td>${formatPercent(row.progress?.percentLost)}</td>
        <td>${escapeHtml(row.progress?.date || "Waiting")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4" class="empty">No contest data yet.</td></tr>`;
  renderGraph(state.graphSeries);
}

function renderPersonalGraph() {
  if (!state.weights.length) {
    $("#chart").innerHTML = `<p class="empty">Enter weights to see your graph.</p>`;
    return;
  }
  const first = state.weights[0];
  renderGraph([{
    user: { username: state.user?.username || "You" },
    points: state.weights.map((entry, index) => ({
      week: index,
      label: entry.entryDate || entry.date,
      percentLost: Number((((first.weight - entry.weight) / first.weight) * 100).toFixed(2))
    }))
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
  const labels = weeks.map((week) => `<text x="${x(week)}" y="${height - 16}" class="axis-label" text-anchor="middle">${weekLabel(week)}</text>`).join("");
  const lines = active.map((row, index) => {
    const color = colors[index % colors.length];
    const points = row.points.map((point) => `${x(point.week)},${y(point.percentLost)}`).join(" ");
    const dots = row.points.map((point) => `<circle cx="${x(point.week)}" cy="${y(point.percentLost)}" r="5" fill="${color}"><title>${escapeHtml(row.user.username)} ${escapeHtml(point.date || point.label || weekLabel(point.week))}: ${formatPercent(point.percentLost)}</title></circle>`).join("");
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>${dots}`;
  }).join("");
  const legend = active.map((row, index) => `<span class="legend-item"><span class="legend-dot" style="background:${colors[index % colors.length]}"></span>${escapeHtml(row.user.username)} <strong>${formatPercent(row.points.at(-1).percentLost)}</strong></span>`).join("");
  $("#chart").innerHTML = `
    <div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="img">${grid}${labels}${lines}</svg></div>
    <div class="legend">${legend}</div>
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
      <td>${escapeHtml(user.email)}</td>
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

function eventToIcs(eventItem) {
  const date = eventItem.date.replaceAll("-", "");
  const practice = timeToIcs(eventItem.practiceTime || eventItem.startTime);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//3FDP//Team Site//EN",
    "BEGIN:VEVENT",
    `UID:${eventItem.id}@3fdp`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART:${date}T${practice}`,
    `SUMMARY:${eventItem.title || "Bowling"}`,
    eventItem.location ? `LOCATION:${eventItem.location}` : "",
    `DESCRIPTION:Start ${eventItem.startTime || ""}; Lane ${eventItem.lane || ""}; Opponent ${eventItem.opponent || ""}${eventItem.location ? `; Location ${eventItem.location}` : ""}`,
    "END:VEVENT",
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
  await refreshBootstrap();
  renderShell();
}

$("#menuBtn").addEventListener("click", () => $("#menu").classList.toggle("hidden"));
$$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$("#menuAuthBtn").addEventListener("click", async () => {
  if (state.user) await logout();
  else setView("login");
});
$("#prevMonth").addEventListener("click", () => moveCalendarMonth(-1));
$("#nextMonth").addEventListener("click", () => moveCalendarMonth(1));

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
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    const data = await api("/api/login", { method: "POST", body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }) });
    state.user = data.user;
    state.view = "home";
    await refreshBootstrap();
    renderShell();
    toast("Account created.");
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
  try {
    const data = await api("/api/notes", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.notes = data.notes;
    form.reset();
    renderHome();
  } catch (error) {
    toast(error.message);
  }
});

$("#notesList").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-note]");
  const del = event.target.closest("[data-delete-note]");
  try {
    if (edit) {
      const note = state.notes.find((item) => item.id === edit.dataset.editNote);
      if (!note) return;
      const text = prompt("Edit blog entry:", note.text);
      if (text === null) return;
      const data = await api(`/api/notes/${edit.dataset.editNote}`, { method: "PUT", body: JSON.stringify({ text }) });
      state.notes = data.notes;
      renderHome();
      toast("Blog entry updated.");
    }
    if (del && confirm("Delete this blog entry and its replies?")) {
      const data = await api(`/api/notes/${del.dataset.deleteNote}`, { method: "DELETE" });
      state.notes = data.notes;
      renderHome();
      toast("Blog entry deleted.");
    }
  } catch (error) {
    toast(error.message);
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
  const deleteEventButton = event.target.closest("[data-delete-event]");
  const editSubButton = event.target.closest("[data-edit-sub-request]");
  const deleteSubButton = event.target.closest("[data-delete-sub-request]");
  if (icsButton) {
    const eventItem = state.events.find((item) => item.id === icsButton.dataset.ics);
    if (eventItem) downloadText(`${eventItem.date}-bowling.ics`, eventToIcs(eventItem));
  }
  if (deleteEventButton && confirm("Remove this calendar event and any related sub requests?")) {
    try {
      const data = await api(`/api/calendar/events/${deleteEventButton.dataset.deleteEvent}`, { method: "DELETE" });
      state.events = data.events;
      state.subRequests = data.subRequests;
      if (state.selectedCalendarEventId === deleteEventButton.dataset.deleteEvent) state.selectedCalendarEventId = null;
      renderHome();
      renderCalendar();
      toast("Calendar event removed.");
    } catch (error) {
      toast(error.message);
    }
  }
  if (subButton) {
    const note = prompt("Anything people should know?");
    try {
      const data = await api("/api/sub-requests", { method: "POST", body: JSON.stringify({ eventId: subButton.dataset.subRequest, note }) });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
    } catch (error) {
      toast(error.message);
    }
  }
  if (responseButton) {
    try {
      const data = await api(`/api/sub-requests/${responseButton.dataset.subResponse}/respond`, { method: "POST", body: JSON.stringify({ response: responseButton.dataset.response }) });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
    } catch (error) {
      toast(error.message);
    }
  }
  if (editSubButton) {
    const request = state.subRequests.find((item) => item.id === editSubButton.dataset.editSubRequest);
    if (!request) return;
    const note = prompt("Edit sub request note:", request.note || "");
    if (note === null) return;
    try {
      const data = await api(`/api/sub-requests/${editSubButton.dataset.editSubRequest}`, { method: "PUT", body: JSON.stringify({ note }) });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
      toast("Sub request updated.");
    } catch (error) {
      toast(error.message);
    }
  }
  if (deleteSubButton && confirm("Cancel this sub request?")) {
    try {
      const data = await api(`/api/sub-requests/${deleteSubButton.dataset.deleteSubRequest}`, { method: "DELETE" });
      state.subRequests = data.subRequests;
      renderHome();
      renderCalendar();
      toast("Sub request canceled.");
    } catch (error) {
      toast(error.message);
    }
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
  downloadText("3fdp-season.ics", state.events.map(eventToIcs).join("\r\n"));
});

$("#quickEventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = Object.fromEntries(new FormData(form));
    payload.title = payload.opponent ? `Bowling vs ${payload.opponent}` : "Test bowling night";
    const data = await api("/api/calendar/events", { method: "POST", body: JSON.stringify(payload) });
    state.events = data.events;
    state.selectedCalendarEventId = [...state.events].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id || state.selectedCalendarEventId;
    renderCalendar();
    toast("Calendar event added.");
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
    await api("/api/weights", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    await refreshWeightsAndBoard();
    toast("Weight saved.");
  } catch (error) {
    toast(error.message);
  }
});

$("#rangeForm").addEventListener("change", refreshWeightsAndBoard);

$("#configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/admin/config", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.config = data.config;
    state.schedule = data.schedule;
    renderContestHeader();
    renderRangeOptions();
    toast("Setup saved.");
  } catch (error) {
    toast(error.message);
  }
});

$("#csvForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.csv.files[0];
  if (!file) return toast("Choose a CSV file.");
  try {
    const events = csvToEvents(await file.text());
    const data = await api("/api/calendar/events", { method: "POST", body: JSON.stringify({ events }) });
    state.events = data.events;
    renderCalendar();
    toast("Schedule uploaded.");
  } catch (error) {
    toast(error.message);
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
    toast("User created.");
  } catch (error) {
    toast(error.message);
  }
});

$("#adminUsers").addEventListener("click", async (event) => {
  const reset = event.target.closest("[data-reset-user]");
  const del = event.target.closest("[data-delete-user]");
  try {
    if (reset) {
      const password = prompt("Temporary password:", "changeme123");
      if (!password) return;
      await api(`/api/admin/users/${reset.dataset.resetUser}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
      toast("Password reset.");
    }
    if (del && confirm("Delete this user and their weights?")) {
      await api(`/api/admin/users/${del.dataset.deleteUser}`, { method: "DELETE" });
      await refreshAdmin();
      toast("User deleted.");
    }
  } catch (error) {
    toast(error.message);
  }
});

init().catch((error) => toast(error.message));
