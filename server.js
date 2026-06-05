const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "";
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const STARTUP_LOG = path.join(__dirname, "startup.log");
const SESSION_BYTES = 32;
const WEIGH_IN_HOUR = 18;
const TIME_ZONE = "America/Chicago";

const sessions = new Map();

const defaultData = {
  config: {
    appName: "3FDP Biggest Loser",
    startDate: "",
    endDate: "",
    weighInHour: WEIGH_IN_HOUR,
    timeZone: TIME_ZONE
  },
  users: [],
  weights: []
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    saveData(defaultData);
    return structuredClone(defaultData);
  }

  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const stored = JSON.parse(raw);
  return {
    ...structuredClone(defaultData),
    ...stored,
    config: { ...defaultData.config, ...(stored.config || {}) },
    users: stored.users || [],
    weights: stored.weights || []
  };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();
ensureBootstrapAdmin();

function ensureBootstrapAdmin() {
  if (db.users.length > 0) return;
  const { salt, hash } = hashPassword("");
  db.users.push({
    id: "admin",
    email: "admin",
    username: "Admin",
    loginName: "admin",
    passwordSalt: salt,
    passwordHash: hash,
    passwordSetupRequired: true,
    role: "admin",
    createdAt: new Date().toISOString()
  });
  saveData(db);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, body, headers = {}) {
  send(res, status, body, { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(value.join("="));
  }
  return cookies;
}

function readBody(req) {
  if (typeof req.bodyText === "string") {
    if (!req.bodyText) return Promise.resolve({});
    try {
      return Promise.resolve(JSON.parse(req.bodyText));
    } catch {
      return Promise.reject(new Error("Invalid JSON."));
    }
  }

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.passwordSalt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"));
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

function getAuthedUser(req) {
  const token = parseCookies(req).session;
  const userId = token ? sessions.get(token) : null;
  return userId ? db.users.find((user) => user.id === userId) : null;
}

function requireUser(req, res) {
  const user = getAuthedUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Please log in first." });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Admin access required." });
    return null;
  }
  return user;
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
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function isConfigured() {
  return Boolean(db.config.startDate && db.config.endDate);
}

function buildSchedule(now = new Date()) {
  const nowParts = centralParts(now);
  if (!isConfigured()) {
    return {
      configured: false,
      entries: [],
      todayYmd: nowParts.ymd,
      activeContest: false,
      currentWeek: null,
      activeEntry: null
    };
  }

  const entries = [{ week: 0, label: "Starting weight", date: db.config.startDate, type: "start" }];
  let week = 1;
  let date = firstThursdayAfter(db.config.startDate);
  while (date && date <= db.config.endDate) {
    entries.push({ week, label: `Week ${week} Thursday cutoff`, date, type: "weekly" });
    date = addDays(date, 7);
    week += 1;
  }

  return {
    configured: true,
    entries,
    todayYmd: nowParts.ymd,
    activeContest: nowParts.ymd >= db.config.startDate && nowParts.ymd <= db.config.endDate,
    currentWeek: null,
    activeEntry: null,
    deadlineText: `Thursday ${db.config.weighInHour}:00 Central`
  };
}

function getUserWeights(userId) {
  return db.weights
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => {
      const dateCompare = getEntryDate(a).localeCompare(getEntryDate(b));
      if (dateCompare !== 0) return dateCompare;
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
}

function getEntryDate(entry) {
  return entry.entryDate || entry.date || "";
}

function entryCountsForCutoff(entry, cutoffDate) {
  const entryDate = getEntryDate(entry);
  if (!entryDate || entryDate > cutoffDate) return false;
  if (entry.createdByAdmin || entryDate < cutoffDate) return true;
  const created = entry.createdAt ? centralParts(new Date(entry.createdAt)) : null;
  return !created || created.ymd < cutoffDate || (created.ymd === cutoffDate && created.hour < db.config.weighInHour);
}

function checkpointWeight(userId, checkpoint) {
  return getUserWeights(userId)
    .filter((entry) => entryCountsForCutoff(entry, checkpoint.date))
    .at(-1) || null;
}

function calculateContestProgress(userId, fromWeek = 0, toWeek = null) {
  const schedule = buildSchedule();
  const from = schedule.entries.find((entry) => entry.week === Number(fromWeek)) || schedule.entries[0];
  const endEntry = toWeek === null
    ? [...schedule.entries].reverse().find((entry) => checkpointWeight(userId, entry))
    : schedule.entries.find((entry) => entry.week === Number(toWeek));
  const start = from ? checkpointWeight(userId, from) : null;
  const end = endEntry ? checkpointWeight(userId, endEntry) : null;
  if (!start || !end || start.weight <= 0) return null;

  return {
    fromWeek: from.week,
    toWeek: endEntry.week,
    percentLost: Number((((start.weight - end.weight) / start.weight) * 100).toFixed(2)),
    hasGained: end.weight > start.weight,
    date: endEntry.date
  };
}

function leaderboard(fromWeek = 0, toWeek = null) {
  return db.users
    .map((user) => ({
      user: { id: user.id, username: user.username },
      progress: calculateContestProgress(user.id, fromWeek, toWeek),
      weightsEntered: getUserWeights(user.id).map((entry) => ({ week: entry.week, date: getEntryDate(entry) }))
    }))
    .sort((a, b) => (b.progress?.percentLost ?? -Infinity) - (a.progress?.percentLost ?? -Infinity));
}

function graphSeries(fromWeek = 0, toWeek = null) {
  const schedule = buildSchedule();
  return db.users.map((user) => {
    const baselineWeek = Number(fromWeek);
    const baselineEntry = schedule.entries.find((entry) => entry.week === baselineWeek) || schedule.entries[0];
    const baseline = baselineEntry ? checkpointWeight(user.id, baselineEntry) : null;
    const maxWeek = toWeek === null ? Math.max(...schedule.entries.map((entry) => entry.week), baselineWeek) : Number(toWeek);
    const points = baseline && baseline.weight > 0
      ? schedule.entries
        .filter((entry) => entry.week >= baselineWeek && entry.week <= maxWeek)
        .map((entry) => ({ checkpoint: entry, weight: checkpointWeight(user.id, entry) }))
        .filter((entry) => entry.weight)
        .map(({ checkpoint, weight }) => ({
          week: checkpoint.week,
          date: checkpoint.date,
          percentLost: Number((((baseline.weight - weight.weight) / baseline.weight) * 100).toFixed(2))
        }))
      : [];

    return {
      user: { id: user.id, username: user.username },
      points
    };
  });
}

function validateWeight(weight) {
  const value = Number(weight);
  return Number.isFinite(value) && value > 0 && value < 1500 ? value : null;
}

function routeStatic(req, res) {
  const requested = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!fullPath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");

  fs.readFile(fullPath, (error, content) => {
    if (error) return send(res, 404, "Not found");
    const ext = path.extname(fullPath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function routeApi(req, res) {
  try {
    if (req.method === "POST" && req.url === "/api/register") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!email.includes("@") || username.length < 2 || password.length < 8) {
        return sendJson(res, 400, { error: "Use a valid email, a username, and a password with at least 8 characters." });
      }
      if (db.users.some((user) => user.email === email || user.loginName === email)) {
        return sendJson(res, 409, { error: "That email is already registered." });
      }
      if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
        return sendJson(res, 409, { error: "That username is already registered." });
      }

      const { salt, hash } = hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        email,
        username,
        passwordSalt: salt,
        passwordHash: hash,
        role: "user",
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      saveData(db);

      return sendJson(res, 201, { user: publicUser(user) });
    }

    if (req.method === "POST" && req.url === "/api/login") {
      const body = await readBody(req);
      const login = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find((candidate) => loginMatchesUser(candidate, login));
      if (!user || !verifyPassword(password, user)) {
        return sendJson(res, 401, { error: "Invalid email or password." });
      }
      const token = crypto.randomBytes(SESSION_BYTES).toString("hex");
      sessions.set(token, user.id);
      return sendJson(res, 200, { user: publicUser(user) }, {
        "Set-Cookie": `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
      });
    }

    if (req.method === "POST" && req.url === "/api/set-password") {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const newPassword = String(body.password || "");
      const email = String(body.email || "").trim().toLowerCase();
      if (newPassword.length < 8) {
        return sendJson(res, 400, { error: "Choose a password with at least 8 characters." });
      }
      if (email && (!email.includes("@") || db.users.some((candidate) => candidate.id !== user.id && candidate.email === email))) {
        return sendJson(res, 400, { error: "Use a valid, unused email address." });
      }

      const { salt, hash } = hashPassword(newPassword);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      user.passwordSetupRequired = false;
      if (email) user.email = email;
      saveData(db);
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (req.method === "POST" && req.url === "/api/logout") {
      const token = parseCookies(req).session;
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true }, {
        "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
      });
    }

    if (req.method === "GET" && req.url === "/api/me") {
      const user = getAuthedUser(req);
      return sendJson(res, 200, { user: user ? publicUser(user) : null });
    }

    if (req.method === "GET" && req.url === "/api/config") {
      return sendJson(res, 200, { config: db.config, schedule: buildSchedule() });
    }

    if (req.method === "PUT" && req.url === "/api/config") {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      const body = await readBody(req);
      const startDate = String(body.startDate || "");
      const endDate = String(body.endDate || "");
      if (!ymdToDateParts(startDate) || !ymdToDateParts(endDate) || endDate < startDate) {
        return sendJson(res, 400, { error: "Choose a valid start date and an end date after the start date." });
      }

      db.config = {
        ...db.config,
        appName: String(body.appName || db.config.appName).trim() || db.config.appName,
        startDate,
        endDate,
        weighInHour: WEIGH_IN_HOUR,
        timeZone: TIME_ZONE
      };
      saveData(db);
      return sendJson(res, 200, { config: db.config, schedule: buildSchedule() });
    }

    if (req.method === "GET" && req.url.startsWith("/api/dashboard")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const fromWeek = Number(url.searchParams.get("fromWeek") || 0);
      const toWeekParam = url.searchParams.get("toWeek");
      const toWeek = toWeekParam === null || toWeekParam === "" ? null : Number(toWeekParam);
      return sendJson(res, 200, {
        config: db.config,
        schedule: buildSchedule(),
        leaderboard: leaderboard(fromWeek, toWeek),
        graphSeries: graphSeries(fromWeek, toWeek)
      });
    }

    if (req.method === "GET" && req.url === "/api/my-weights") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, {
        schedule: buildSchedule(),
        weights: getUserWeights(user.id),
        progress: calculateContestProgress(user.id)
      });
    }

    if (req.method === "POST" && req.url === "/api/my-weights") {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const weight = validateWeight(body.weight);
      if (!weight) return sendJson(res, 400, { error: "Enter a valid weight." });
      const now = new Date();
      const today = centralParts(now).ymd;

      db.weights.push({
        id: crypto.randomUUID(),
        userId: user.id,
        week: null,
        entryDate: today,
        date: today,
        weight,
        createdAt: now.toISOString()
      });
      saveData(db);
      return sendJson(res, 201, { weights: getUserWeights(user.id), progress: calculateContestProgress(user.id) });
    }

    if (req.method === "GET" && req.url === "/api/admin/users") {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      return sendJson(res, 200, {
        users: db.users.map((user) => ({
          ...publicUser(user),
          weightsEntered: getUserWeights(user.id).map((entry) => ({ week: entry.week, date: getEntryDate(entry), createdAt: entry.createdAt }))
        }))
      });
    }

    if (req.method === "POST" && req.url === "/api/admin/users") {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "changeme123");

      if (!email.includes("@") || username.length < 2 || password.length < 8) {
        return sendJson(res, 400, { error: "Use a valid email, username, and temporary password with at least 8 characters." });
      }
      if (db.users.some((user) => user.email === email || user.loginName === email)) {
        return sendJson(res, 409, { error: "That email is already registered." });
      }
      if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
        return sendJson(res, 409, { error: "That username is already registered." });
      }

      const { salt, hash } = hashPassword(password);
      db.users.push({
        id: crypto.randomUUID(),
        email,
        username,
        passwordSalt: salt,
        passwordHash: hash,
        passwordSetupRequired: true,
        role: "user",
        createdAt: new Date().toISOString()
      });
      saveData(db);
      return sendJson(res, 201, { ok: true });
    }

    if (req.method === "POST" && /^\/api\/admin\/users\/[^/]+\/reset-password$/.test(req.url)) {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      const userId = decodeURIComponent(req.url.split("/")[4]);
      const body = await readBody(req);
      const password = String(body.password || "changeme123");
      const user = db.users.find((candidate) => candidate.id === userId);
      if (!user) return sendJson(res, 404, { error: "User not found." });
      if (password.length < 8) return sendJson(res, 400, { error: "Temporary password must be at least 8 characters." });

      const { salt, hash } = hashPassword(password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      user.passwordSetupRequired = true;
      saveData(db);
      return sendJson(res, 200, { ok: true, temporaryPassword: password });
    }

    if (req.method === "POST" && /^\/api\/admin\/users\/[^/]+\/weights$/.test(req.url)) {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      const userId = decodeURIComponent(req.url.split("/")[4]);
      const user = db.users.find((candidate) => candidate.id === userId);
      if (!user) return sendJson(res, 404, { error: "User not found." });

      const body = await readBody(req);
      const weight = validateWeight(body.weight);
      const week = Number(body.week);
      const date = String(body.date || "");
      if (!Number.isInteger(week) || week < 0) return sendJson(res, 400, { error: "Choose a valid week number." });
      if (!ymdToDateParts(date)) return sendJson(res, 400, { error: "Choose a valid weigh-in date." });
      if (!weight) return sendJson(res, 400, { error: "Enter a valid weight." });

      const existing = db.weights.find((entry) => entry.userId === userId && entry.week === week);
      if (existing) {
        existing.weight = weight;
        existing.entryDate = date;
        existing.date = date;
        existing.updatedByAdminAt = new Date().toISOString();
      } else {
        db.weights.push({
          id: crypto.randomUUID(),
          userId,
          week,
          entryDate: date,
          date,
          weight,
          createdByAdmin: true,
          createdAt: new Date().toISOString()
        });
      }
      saveData(db);
      return sendJson(res, 200, { ok: true, replaced: Boolean(existing) });
    }

    if (req.method === "DELETE" && /^\/api\/admin\/users\/[^/]+\/weights\/\d+$/.test(req.url)) {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      const parts = req.url.split("/");
      const userId = decodeURIComponent(parts[4]);
      const week = Number(parts[6]);
      const beforeCount = db.weights.length;
      db.weights = db.weights.filter((entry) => !(entry.userId === userId && entry.week === week));
      if (db.weights.length === beforeCount) return sendJson(res, 404, { error: "Weigh-in entry not found." });
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && /^\/api\/admin\/users\/[^/]+\/weights$/.test(req.url)) {
      requireAdmin(req, res);
      if (res.writableEnded) return;
      const userId = decodeURIComponent(req.url.split("/")[4]);
      db.weights = db.weights.filter((entry) => entry.userId !== userId);
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && /^\/api\/admin\/users\/[^/]+$/.test(req.url)) {
      const admin = requireAdmin(req, res);
      if (!admin || res.writableEnded) return;
      const userId = decodeURIComponent(req.url.split("/")[4]);
      if (userId === admin.id) return sendJson(res, 400, { error: "You cannot delete the admin account you are currently using." });

      const beforeCount = db.users.length;
      db.users = db.users.filter((user) => user.id !== userId);
      if (db.users.length === beforeCount) return sendJson(res, 404, { error: "User not found." });
      db.weights = db.weights.filter((entry) => entry.userId !== userId);
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Server error." });
  }
}

function createResponse(socket) {
  return {
    writableEnded: false,
    headers: {},
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(content = "") {
      if (this.writableEnded) return;
      this.writableEnded = true;
      const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
      const status = this.status || 200;
      const reason = {
        200: "OK",
        201: "Created",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        409: "Conflict",
        500: "Internal Server Error"
      }[status] || "OK";
      const headers = {
        "Content-Length": body.length,
        "Connection": "close",
        ...this.headers
      };
      let headerText = `HTTP/1.1 ${status} ${reason}\r\n`;
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headerText += `${name}: ${item}\r\n`;
        } else {
          headerText += `${name}: ${value}\r\n`;
        }
      }
      socket.end(Buffer.concat([Buffer.from(`${headerText}\r\n`), body]));
    }
  };
}

function parseHttpRequest(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;

  const headerText = raw.slice(0, headerEnd).toString("utf8");
  const bodyText = raw.slice(headerEnd + 4).toString("utf8");
  const lines = headerText.split("\r\n");
  const [method, url] = lines.shift().split(" ");
  const headers = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }

  return { method, url, headers, bodyText };
}

function handleRequest(req, res) {
  if (req.url.startsWith("/api/")) return routeApi(req, res);
  return routeStatic(req, res);
}

const server = net.createServer((socket) => {
  const chunks = [];
  let total = 0;

  socket.on("data", (chunk) => {
    chunks.push(chunk);
    total += chunk.length;
    const raw = Buffer.concat(chunks, total);
    const headerEnd = raw.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const headerText = raw.slice(0, headerEnd).toString("utf8");
    const lengthMatch = headerText.match(/\r\ncontent-length:\s*(\d+)/i);
    const contentLength = lengthMatch ? Number(lengthMatch[1]) : 0;
    if (raw.length < headerEnd + 4 + contentLength) return;

    const req = parseHttpRequest(raw.slice(0, headerEnd + 4 + contentLength));
    const res = createResponse(socket);
    if (!req) return send(res, 400, "Bad request");
    handleRequest(req, res);
  });

  socket.on("error", () => {});
});

function logStartup(message) {
  fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${message}\n`);
}

process.on("uncaughtException", (error) => {
  logStartup(`UNCAUGHT ${error.stack || error.message || error}`);
  console.error(error);
  process.exit(1);
});

server.on("error", (error) => {
  logStartup(`SERVER ERROR ${error.stack || error.message || error}`);
  console.error(error);
  process.exit(1);
});

logStartup(`Starting on ${HOST || "default host"}:${PORT}`);
server.listen(PORT, HOST || undefined, () => {
  const message = `3FDP Biggest Loser app running at http://localhost:${PORT}`;
  logStartup(message);
  console.log(message);
});
