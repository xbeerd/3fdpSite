const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const webPush = require("web-push");

const DATA_FILE = path.join(process.cwd(), "data.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-change-me";
const TIME_ZONE = "America/Chicago";
const DEFAULT_TEMP_PASSWORD = "changeme123";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@3fdp.local";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const defaultData = {
  config: {
    appName: "3FDP",
    bowlingStartTime: "18:30",
    practiceStartTime: "18:15",
    contestStartDate: "",
    contestEndDate: "",
    weighInHour: 18,
    timeZone: TIME_ZONE
  },
  users: [],
  notes: [],
  calendarEvents: [],
  subRequests: [],
  pushSubscriptions: [],
  weights: []
};

function connectNetlifyBlobs(event) {
  try {
    const { connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
  } catch {
  }
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

async function getBlobStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    return getStore("3fdp-site-data");
  } catch {
    return null;
  }
}

async function loadData() {
  const store = await getBlobStore();
  let stored = null;
  if (store) {
    stored = await store.get("data", { type: "json" });
  } else if (fs.existsSync(DATA_FILE)) {
    stored = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }

  const data = {
    ...structuredClone(defaultData),
    ...(stored || {}),
    config: { ...defaultData.config, ...((stored || {}).config || {}) },
    users: (stored || {}).users || [],
    notes: (stored || {}).notes || [],
    calendarEvents: (stored || {}).calendarEvents || [],
    subRequests: (stored || {}).subRequests || [],
    pushSubscriptions: (stored || {}).pushSubscriptions || [],
    weights: (stored || {}).weights || []
  };

  return data;
}

async function saveData(data) {
  const store = await getBlobStore();
  if (store) {
    await store.setJSON("data", data);
  } else {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY || process.env.CONTEXT) {
      throw new Error("Hosted data store is unavailable. Check that @netlify/blobs installed during deploy.");
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.passwordSalt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(headers) {
  const cookies = {};
  const header = headers.cookie || headers.Cookie || "";
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(value.join("="));
  }
  return cookies;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    passwordSetupRequired: Boolean(user.passwordSetupRequired),
    createdAt: user.createdAt
  };
}

function loginMatchesUser(user, login) {
  const normalized = String(login || "").trim().toLowerCase();
  return (
    user.email?.toLowerCase() === normalized ||
    user.loginName?.toLowerCase() === normalized ||
    user.username?.toLowerCase() === normalized ||
    (normalized === "admin" && user.role === "admin")
  );
}

function currentUser(event, data) {
  const token = parseCookies(event.headers || {}).session;
  const payload = verifyToken(token);
  return payload ? data.users.find((user) => user.id === payload.userId) || null : null;
}

function requireUser(event, data) {
  const user = currentUser(event, data);
  if (!user) throw Object.assign(new Error("Please log in first."), { statusCode: 401 });
  return user;
}

function requireAdmin(event, data) {
  const user = requireUser(event, data);
  if (user.role !== "admin") throw Object.assign(new Error("Admin access required."), { statusCode: 403 });
  return user;
}

function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

function ymdToDateParts(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
}

function utcDateFromYmd(ymd) {
  const parts = ymdToDateParts(ymd);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDays(ymd, days) {
  const date = utcDateFromYmd(ymd);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(ymd) {
  const date = utcDateFromYmd(ymd);
  return date ? date.getUTCDay() : null;
}

function firstThursdayAfter(ymd) {
  const day = dayOfWeek(ymd);
  if (day === null) return "";
  const daysUntilThursday = (4 - day + 7) % 7 || 7;
  return addDays(ymd, daysUntilThursday);
}

function centralParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function buildSchedule(data, now = new Date()) {
  const nowParts = centralParts(now);
  const configured = Boolean(data.config.contestStartDate && data.config.contestEndDate);
  if (!configured) return { configured: false, entries: [], activeContest: false, todayYmd: nowParts.ymd };
  const entries = [{ week: 0, label: "Starting weight", date: data.config.contestStartDate, type: "start" }];
  let week = 1;
  let date = firstThursdayAfter(data.config.contestStartDate);
  while (date && date <= data.config.contestEndDate) {
    entries.push({ week, label: `Week ${week} Thursday cutoff`, date, type: "weekly" });
    date = addDays(date, 7);
    week += 1;
  }
  return {
    configured: true,
    entries,
    activeContest: nowParts.ymd >= data.config.contestStartDate && nowParts.ymd <= data.config.contestEndDate,
    todayYmd: nowParts.ymd,
    deadlineText: `Thursday ${data.config.weighInHour}:00 Central`
  };
}

function getEntryDate(entry) {
  return entry.entryDate || entry.date || "";
}

function getUserWeights(data, userId) {
  return data.weights
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => getEntryDate(a).localeCompare(getEntryDate(b)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function entryCountsForCutoff(data, entry, cutoffDate) {
  const entryDate = getEntryDate(entry);
  if (!entryDate || entryDate > cutoffDate) return false;
  if (entry.createdByAdmin || entryDate < cutoffDate) return true;
  const created = entry.createdAt ? centralParts(new Date(entry.createdAt)) : null;
  return !created || created.ymd < cutoffDate || (created.ymd === cutoffDate && created.hour < data.config.weighInHour);
}

function checkpointWeight(data, userId, checkpoint) {
  return getUserWeights(data, userId).filter((entry) => entryCountsForCutoff(data, entry, checkpoint.date)).at(-1) || null;
}

function calculateContestProgress(data, userId, fromWeek = 0, toWeek = null) {
  const schedule = buildSchedule(data);
  const from = schedule.entries.find((entry) => entry.week === Number(fromWeek)) || schedule.entries[0];
  const endEntry = toWeek === null
    ? [...schedule.entries].reverse().find((entry) => checkpointWeight(data, userId, entry))
    : schedule.entries.find((entry) => entry.week === Number(toWeek));
  const start = from ? checkpointWeight(data, userId, from) : null;
  const end = endEntry ? checkpointWeight(data, userId, endEntry) : null;
  if (!start || !end || start.weight <= 0) return null;
  return {
    fromWeek: from.week,
    toWeek: endEntry.week,
    percentLost: Number((((start.weight - end.weight) / start.weight) * 100).toFixed(2)),
    date: endEntry.date
  };
}

function contestGraph(data, fromWeek = 0, toWeek = null) {
  const schedule = buildSchedule(data);
  return data.users.map((user) => {
    const baselineWeek = Number(fromWeek);
    const baselineEntry = schedule.entries.find((entry) => entry.week === baselineWeek) || schedule.entries[0];
    const baseline = baselineEntry ? checkpointWeight(data, user.id, baselineEntry) : null;
    const maxWeek = toWeek === null ? Math.max(...schedule.entries.map((entry) => entry.week), baselineWeek) : Number(toWeek);
    const points = baseline && baseline.weight > 0
      ? schedule.entries
        .filter((entry) => entry.week >= baselineWeek && entry.week <= maxWeek)
        .map((entry) => ({ checkpoint: entry, weight: checkpointWeight(data, user.id, entry) }))
        .filter((entry) => entry.weight)
        .map(({ checkpoint, weight }) => ({
          week: checkpoint.week,
          date: checkpoint.date,
          percentLost: Number((((baseline.weight - weight.weight) / baseline.weight) * 100).toFixed(2))
        }))
      : [];
    return { user: { id: user.id, username: user.username }, points };
  });
}

function validateWeight(weight) {
  const value = Number(weight);
  return Number.isFinite(value) && value > 0 && value < 1500 ? value : null;
}

function normalizeNote(note) {
  return {
    ...note,
    comments: (note.comments || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  };
}

function sortedNotes(data) {
  return [...data.notes]
    .map(normalizeNote)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
}

function findNote(data, noteId) {
  return data.notes.find((note) => note.id === noteId);
}

function visibleSubRequests(data) {
  return data.subRequests
    .map((request) => ({
      ...request,
      event: data.calendarEvents.find((event) => event.id === request.eventId) || null
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function findSubRequest(data, requestId) {
  return data.subRequests.find((request) => request.id === requestId);
}

function eventDuplicateKey(row) {
  return [
    row.date,
    row.lane,
    row.opponent,
    row.startTime,
    row.practiceTime,
    row.location
  ].map((value) => String(value || "").trim().toLowerCase()).join("|");
}

function normalizedCalendarRow(row, data) {
  return {
    date: row.date,
    startTime: row.startTime || data.config.bowlingStartTime,
    practiceTime: row.practiceTime || data.config.practiceStartTime,
    lane: row.lane || "",
    location: row.location || "",
    leagueName: row.leagueName || "",
    opponent: row.opponent || "",
    title: row.title || (row.leagueName ? `${row.leagueName}${row.opponent ? ` vs ${row.opponent}` : ""}` : `Bowling vs ${row.opponent || "TBD"}`)
  };
}

function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

function publicPushSubscription(subscription) {
  return {
    id: subscription.id,
    userId: subscription.userId,
    username: subscription.username,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt
  };
}

function normalizePushSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const endpoint = String(value.endpoint || "").trim();
  const p256dh = String(value.keys?.p256dh || "").trim();
  const auth = String(value.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, expirationTime: value.expirationTime || null, keys: { p256dh, auth } };
}

async function sendSubRequestNotifications(data, request, eventItem) {
  if (!pushConfigured() || !data.pushSubscriptions.length) return;
  const payload = JSON.stringify({
    title: "3FDP sub needed",
    body: `${request.requestedBy} needs a sub${eventItem?.date ? ` on ${eventItem.date}` : ""}${eventItem?.opponent ? ` vs ${eventItem.opponent}` : ""}.`,
    url: "/#calendar",
    tag: `sub-request-${request.id}`
  });
  const expired = new Set();
  await Promise.all(data.pushSubscriptions.map(async (saved) => {
    try {
      await webPush.sendNotification(saved.subscription, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) expired.add(saved.id);
      else console.error("Push notification failed:", error.message || error);
    }
  }));
  if (expired.size) {
    data.pushSubscriptions = data.pushSubscriptions.filter((subscription) => !expired.has(subscription.id));
    await saveData(data);
  }
}

exports.handler = async (event) => {
  connectNetlifyBlobs(event);
  const data = await loadData();
  const method = event.httpMethod;
  const route = `/${(event.path || "").replace(/^\/api\/?/, "")}`.replace(/\/$/, "") || "/";

  try {
    if (method === "GET" && route === "/me") {
      const user = currentUser(event, data);
      return json(200, { user: user ? publicUser(user) : null });
    }

    if (method === "POST" && route === "/login") {
      const body = parseBody(event);
      const login = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = data.users.find((candidate) => loginMatchesUser(candidate, login));
      if (!user || !verifyPassword(password, user)) return json(401, { error: "Invalid login or password." });
      const token = sign({ userId: user.id, issuedAt: Date.now() });
      return json(200, { user: publicUser(user) }, {
        "Set-Cookie": `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
      });
    }

    if (method === "POST" && route === "/logout") {
      return json(200, { ok: true }, { "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }

    if (method === "POST" && route === "/set-password") {
      const user = requireUser(event, data);
      const body = parseBody(event);
      const password = String(body.password || "");
      const email = String(body.email || "").trim().toLowerCase();
      if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });
      if (email && !email.includes("@")) return json(400, { error: "Use a valid email." });
      const { salt, hash } = hashPassword(password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      user.passwordSetupRequired = false;
      if (email) user.email = email;
      await saveData(data);
      return json(200, { user: publicUser(user) });
    }

    if (method === "POST" && route === "/register") {
      const body = parseBody(event);
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const isFirstUser = data.users.length === 0;
      const setupCode = String(body.setupCode || "");
      if (!email.includes("@") || username.length < 2 || password.length < 8) return json(400, { error: "Use a valid email, username, and password." });
      if (isFirstUser && process.env.ADMIN_SETUP_CODE && setupCode !== process.env.ADMIN_SETUP_CODE) return json(403, { error: "Admin setup code is required." });
      if (data.users.some((user) => user.email === email || user.username.toLowerCase() === username.toLowerCase())) return json(409, { error: "That email or username is already registered." });
      const { salt, hash } = hashPassword(password);
      data.users.push({ id: crypto.randomUUID(), email, username, passwordSalt: salt, passwordHash: hash, role: isFirstUser ? "admin" : "user", createdAt: new Date().toISOString() });
      await saveData(data);
      return json(201, { ok: true });
    }

    if (method === "GET" && route === "/bootstrap") {
      return json(200, {
        adminSetupOpen: data.users.length === 0,
        config: data.config,
        schedule: buildSchedule(data),
        notes: sortedNotes(data),
        events: data.calendarEvents,
        subRequests: visibleSubRequests(data)
      });
    }

    if (method === "GET" && route === "/push/public-key") {
      return json(200, { publicKey: VAPID_PUBLIC_KEY, configured: pushConfigured() });
    }

    if (method === "POST" && route === "/push/subscriptions") {
      const user = requireUser(event, data);
      if (!pushConfigured()) return json(503, { error: "Push notifications are not configured yet." });
      const subscription = normalizePushSubscription(parseBody(event).subscription);
      if (!subscription) return json(400, { error: "Push subscription is invalid." });
      const existing = data.pushSubscriptions.find((item) => item.subscription.endpoint === subscription.endpoint);
      if (existing) {
        existing.userId = user.id;
        existing.username = user.username;
        existing.subscription = subscription;
        existing.updatedAt = new Date().toISOString();
      } else {
        data.pushSubscriptions.push({
          id: crypto.randomUUID(),
          userId: user.id,
          username: user.username,
          subscription,
          createdAt: new Date().toISOString()
        });
      }
      await saveData(data);
      return json(201, { subscriptions: data.pushSubscriptions.filter((item) => item.userId === user.id).map(publicPushSubscription) });
    }

    if (method === "DELETE" && route === "/push/subscriptions") {
      const user = requireUser(event, data);
      const endpoint = String(parseBody(event).endpoint || "").trim();
      data.pushSubscriptions = data.pushSubscriptions.filter((item) => item.userId !== user.id || (endpoint && item.subscription.endpoint !== endpoint));
      await saveData(data);
      return json(200, { subscriptions: data.pushSubscriptions.filter((item) => item.userId === user.id).map(publicPushSubscription) });
    }

    if (method === "PUT" && route === "/admin/config") {
      requireAdmin(event, data);
      data.config = { ...data.config, ...parseBody(event) };
      await saveData(data);
      return json(200, { config: data.config, schedule: buildSchedule(data) });
    }

    if (method === "GET" && route === "/admin/users") {
      requireAdmin(event, data);
      return json(200, {
        users: data.users.map((user) => ({
          ...publicUser(user),
          weightsEntered: getUserWeights(data, user.id).map((entry) => ({ date: getEntryDate(entry), createdAt: entry.createdAt }))
        }))
      });
    }

    if (method === "POST" && route === "/admin/users") {
      requireAdmin(event, data);
      const body = parseBody(event);
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || DEFAULT_TEMP_PASSWORD);
      if (!email.includes("@") || username.length < 2 || password.length < 8) return json(400, { error: "Use a valid email, username, and temporary password." });
      if (data.users.some((user) => user.email === email || user.username.toLowerCase() === username.toLowerCase())) return json(409, { error: "That account already exists." });
      const { salt, hash } = hashPassword(password);
      data.users.push({ id: crypto.randomUUID(), email, username, passwordSalt: salt, passwordHash: hash, passwordSetupRequired: true, role: "user", createdAt: new Date().toISOString() });
      await saveData(data);
      return json(201, { ok: true });
    }

    if (method === "DELETE" && /^\/admin\/users\/[^/]+$/.test(route)) {
      const admin = requireAdmin(event, data);
      const userId = decodeURIComponent(route.split("/")[3]);
      if (userId === admin.id) return json(400, { error: "You cannot delete your current admin account." });
      data.users = data.users.filter((user) => user.id !== userId);
      data.weights = data.weights.filter((entry) => entry.userId !== userId);
      await saveData(data);
      return json(200, { ok: true });
    }

    if (method === "POST" && /^\/admin\/users\/[^/]+\/reset-password$/.test(route)) {
      requireAdmin(event, data);
      const userId = decodeURIComponent(route.split("/")[3]);
      const user = data.users.find((candidate) => candidate.id === userId);
      const password = String(parseBody(event).password || DEFAULT_TEMP_PASSWORD);
      if (!user) return json(404, { error: "User not found." });
      const { salt, hash } = hashPassword(password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      user.passwordSetupRequired = true;
      await saveData(data);
      return json(200, { ok: true });
    }

    if (method === "GET" && route === "/notes") return json(200, { notes: sortedNotes(data) });

    if (method === "POST" && route === "/notes") {
      const user = requireUser(event, data);
      const body = parseBody(event);
      const text = String(body.text || "").trim();
      if (!text) return json(400, { error: "Note cannot be blank." });
      data.notes.push({ id: crypto.randomUUID(), userId: user.id, username: user.username, text, comments: [], createdAt: new Date().toISOString() });
      await saveData(data);
      return json(201, { notes: sortedNotes(data) });
    }

    if (method === "PUT" && /^\/notes\/[^/]+$/.test(route)) {
      requireAdmin(event, data);
      const note = findNote(data, decodeURIComponent(route.split("/")[2]));
      const text = String(parseBody(event).text || "").trim();
      if (!note) return json(404, { error: "Blog entry not found." });
      if (!text) return json(400, { error: "Blog entry cannot be blank." });
      note.text = text;
      note.updatedAt = new Date().toISOString();
      await saveData(data);
      return json(200, { notes: sortedNotes(data) });
    }

    if (method === "DELETE" && /^\/notes\/[^/]+$/.test(route)) {
      requireAdmin(event, data);
      const noteId = decodeURIComponent(route.split("/")[2]);
      const beforeCount = data.notes.length;
      data.notes = data.notes.filter((note) => note.id !== noteId);
      if (data.notes.length === beforeCount) return json(404, { error: "Blog entry not found." });
      await saveData(data);
      return json(200, { notes: sortedNotes(data) });
    }

    if (method === "POST" && /^\/notes\/[^/]+\/comments$/.test(route)) {
      const user = requireUser(event, data);
      const note = findNote(data, decodeURIComponent(route.split("/")[2]));
      const text = String(parseBody(event).text || "").trim();
      if (!note) return json(404, { error: "Blog entry not found." });
      if (!text) return json(400, { error: "Comment cannot be blank." });
      note.comments = note.comments || [];
      note.comments.push({ id: crypto.randomUUID(), userId: user.id, username: user.username, text, createdAt: new Date().toISOString() });
      await saveData(data);
      return json(201, { notes: sortedNotes(data) });
    }

    if (method === "GET" && route === "/calendar/events") return json(200, { events: data.calendarEvents });

    if (method === "POST" && route === "/calendar/events") {
      requireAdmin(event, data);
      const body = parseBody(event);
      const rows = Array.isArray(body.events) ? body.events : [body];
      const importId = Array.isArray(body.events) ? crypto.randomUUID() : "";
      const existingKeys = new Set(data.calendarEvents.map(eventDuplicateKey));
      let importedCount = 0;
      let skippedDuplicateCount = 0;
      let invalidCount = 0;
      for (const row of rows) {
        if (!ymdToDateParts(row.date)) {
          invalidCount += 1;
          continue;
        }
        const existing = row.id ? data.calendarEvents.find((eventItem) => eventItem.id === row.id) : null;
        const eventItem = existing || { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
        Object.assign(eventItem, normalizedCalendarRow(row, data));
        if (!existing) {
          const key = eventDuplicateKey(eventItem);
          if (existingKeys.has(key)) {
            skippedDuplicateCount += 1;
            continue;
          }
          if (importId) eventItem.importId = importId;
          existingKeys.add(key);
          data.calendarEvents.push(eventItem);
          importedCount += 1;
        }
      }
      await saveData(data);
      return json(200, {
        events: data.calendarEvents,
        importId: importedCount ? importId : "",
        importedCount,
        skippedDuplicateCount,
        invalidCount
      });
    }

    if (method === "POST" && route === "/calendar/events/delete-by-csv") {
      requireAdmin(event, data);
      const body = parseBody(event);
      const rows = Array.isArray(body.events) ? body.events : [];
      const deleteKeys = new Set();
      let invalidCount = 0;
      for (const row of rows) {
        if (!ymdToDateParts(row.date)) {
          invalidCount += 1;
          continue;
        }
        deleteKeys.add(eventDuplicateKey(normalizedCalendarRow(row, data)));
      }
      const removedEventIds = new Set(data.calendarEvents.filter((eventItem) => deleteKeys.has(eventDuplicateKey(eventItem))).map((eventItem) => eventItem.id));
      data.calendarEvents = data.calendarEvents.filter((eventItem) => !removedEventIds.has(eventItem.id));
      data.subRequests = data.subRequests.filter((request) => !removedEventIds.has(request.eventId));
      await saveData(data);
      return json(200, {
        events: data.calendarEvents,
        subRequests: visibleSubRequests(data),
        removedCount: removedEventIds.size,
        invalidCount
      });
    }

    if (method === "DELETE" && /^\/calendar\/imports\/[^/]+$/.test(route)) {
      requireAdmin(event, data);
      const importId = decodeURIComponent(route.split("/")[3]);
      const removedEventIds = new Set(data.calendarEvents.filter((eventItem) => eventItem.importId === importId).map((eventItem) => eventItem.id));
      if (!removedEventIds.size) return json(404, { error: "Imported schedule batch not found." });
      data.calendarEvents = data.calendarEvents.filter((eventItem) => eventItem.importId !== importId);
      data.subRequests = data.subRequests.filter((request) => !removedEventIds.has(request.eventId));
      await saveData(data);
      return json(200, {
        events: data.calendarEvents,
        subRequests: visibleSubRequests(data),
        removedCount: removedEventIds.size
      });
    }

    if (method === "DELETE" && /^\/calendar\/events\/[^/]+$/.test(route)) {
      requireAdmin(event, data);
      const eventId = decodeURIComponent(route.split("/")[3]);
      const target = data.calendarEvents.find((eventItem) => eventItem.id === eventId);
      if (!target) return json(404, { error: "Calendar event not found." });
      const targetKey = eventDuplicateKey(target);
      const removedEventIds = new Set(data.calendarEvents.filter((eventItem) => eventDuplicateKey(eventItem) === targetKey).map((eventItem) => eventItem.id));
      data.calendarEvents = data.calendarEvents.filter((eventItem) => !removedEventIds.has(eventItem.id));
      data.subRequests = data.subRequests.filter((request) => !removedEventIds.has(request.eventId));
      await saveData(data);
      return json(200, { events: data.calendarEvents, subRequests: visibleSubRequests(data), removedCount: removedEventIds.size });
    }

    if (method === "POST" && route === "/sub-requests") {
      const user = requireUser(event, data);
      const body = parseBody(event);
      const eventId = String(body.eventId || "");
      const eventItem = data.calendarEvents.find((candidate) => candidate.id === eventId);
      if (!eventItem) return json(404, { error: "Calendar event not found." });
      const request = {
        id: crypto.randomUUID(),
        eventId,
        requestedByUserId: user.id,
        requestedBy: user.username,
        note: String(body.note || ""),
        responses: [],
        status: "open",
        createdAt: new Date().toISOString()
      };
      data.subRequests.push(request);
      await saveData(data);
      await sendSubRequestNotifications(data, request, eventItem);
      return json(201, { subRequests: visibleSubRequests(data) });
    }

    if (method === "POST" && /^\/sub-requests\/[^/]+\/respond$/.test(route)) {
      const user = requireUser(event, data);
      const request = findSubRequest(data, decodeURIComponent(route.split("/")[2]));
      if (!request) return json(404, { error: "Sub request not found." });
      const response = String(parseBody(event).response || "");
      request.responses = request.responses.filter((item) => item.userId !== user.id);
      request.responses.push({ userId: user.id, username: user.username, response, createdAt: new Date().toISOString() });
      await saveData(data);
      return json(200, { subRequests: visibleSubRequests(data) });
    }

    if (method === "PUT" && /^\/sub-requests\/[^/]+$/.test(route)) {
      const user = requireUser(event, data);
      const request = findSubRequest(data, decodeURIComponent(route.split("/")[2]));
      if (!request) return json(404, { error: "Sub request not found." });
      if (request.requestedByUserId !== user.id && user.role !== "admin") return json(403, { error: "Only the request owner or admin can edit this sub request." });
      request.note = String(parseBody(event).note || "");
      request.updatedAt = new Date().toISOString();
      await saveData(data);
      return json(200, { subRequests: visibleSubRequests(data) });
    }

    if (method === "DELETE" && /^\/sub-requests\/[^/]+$/.test(route)) {
      const user = requireUser(event, data);
      const requestId = decodeURIComponent(route.split("/")[2]);
      const request = findSubRequest(data, requestId);
      if (!request) return json(404, { error: "Sub request not found." });
      if (request.requestedByUserId !== user.id && user.role !== "admin") return json(403, { error: "Only the request owner or admin can remove this sub request." });
      data.subRequests = data.subRequests.filter((candidate) => candidate.id !== requestId);
      await saveData(data);
      return json(200, { subRequests: visibleSubRequests(data) });
    }

    if (method === "GET" && route === "/weights") {
      const user = requireUser(event, data);
      return json(200, { weights: getUserWeights(data, user.id), schedule: buildSchedule(data) });
    }

    if (method === "POST" && route === "/weights") {
      const user = requireUser(event, data);
      const body = parseBody(event);
      const weight = validateWeight(body.weight);
      if (!weight) return json(400, { error: "Enter a valid weight." });
      const now = new Date();
      data.weights.push({ id: crypto.randomUUID(), userId: user.id, weight, entryDate: body.date || centralParts(now).ymd, date: body.date || centralParts(now).ymd, createdAt: now.toISOString() });
      await saveData(data);
      return json(201, { weights: getUserWeights(data, user.id) });
    }

    if (method === "PUT" && /^\/weights\/[^/]+$/.test(route)) {
      const user = requireUser(event, data);
      const weightId = decodeURIComponent(route.split("/")[2]);
      const entry = data.weights.find((candidate) => candidate.id === weightId);
      const body = parseBody(event);
      const weight = validateWeight(body.weight);
      if (!entry) return json(404, { error: "Weight entry not found." });
      if (entry.userId !== user.id && user.role !== "admin") return json(403, { error: "You can only edit your own weight entries." });
      if (!weight || !ymdToDateParts(body.date)) return json(400, { error: "Enter a valid date and weight." });
      entry.weight = weight;
      entry.entryDate = body.date;
      entry.date = body.date;
      entry.updatedAt = new Date().toISOString();
      await saveData(data);
      return json(200, { weights: getUserWeights(data, user.id) });
    }

    if (method === "DELETE" && /^\/weights\/[^/]+$/.test(route)) {
      const user = requireUser(event, data);
      const weightId = decodeURIComponent(route.split("/")[2]);
      const entry = data.weights.find((candidate) => candidate.id === weightId);
      if (!entry) return json(404, { error: "Weight entry not found." });
      if (entry.userId !== user.id && user.role !== "admin") return json(403, { error: "You can only delete your own weight entries." });
      data.weights = data.weights.filter((candidate) => candidate.id !== weightId);
      await saveData(data);
      return json(200, { weights: getUserWeights(data, user.id) });
    }

    if (method === "POST" && /^\/admin\/users\/[^/]+\/weights$/.test(route)) {
      requireAdmin(event, data);
      const userId = decodeURIComponent(route.split("/")[3]);
      const body = parseBody(event);
      const weight = validateWeight(body.weight);
      if (!weight || !ymdToDateParts(body.date)) return json(400, { error: "Enter a valid date and weight." });
      data.weights.push({ id: crypto.randomUUID(), userId, weight, week: body.week === "" ? null : Number(body.week), entryDate: body.date, date: body.date, createdByAdmin: true, createdAt: new Date().toISOString() });
      await saveData(data);
      return json(201, { ok: true });
    }

    if (method === "GET" && route === "/biggest-loser/dashboard") {
      const url = new URL(event.rawUrl || `http://local${event.path}`);
      const fromWeek = Number(url.searchParams.get("fromWeek") || 0);
      const toWeekParam = url.searchParams.get("toWeek");
      const toWeek = toWeekParam === null || toWeekParam === "" ? null : Number(toWeekParam);
      return json(200, {
        schedule: buildSchedule(data),
        leaderboard: data.users.map((user) => ({
          user: { id: user.id, username: user.username },
          progress: calculateContestProgress(data, user.id, fromWeek, toWeek)
        })).sort((a, b) => (b.progress?.percentLost ?? -Infinity) - (a.progress?.percentLost ?? -Infinity)),
        graphSeries: contestGraph(data, fromWeek, toWeek)
      });
    }

    return json(404, { error: "Not found." });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || "Server error." });
  }
};
