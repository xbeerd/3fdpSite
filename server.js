const http = require("http");
const fs = require("fs");
const path = require("path");
const { handler } = require("./netlify/functions/api");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "";
const PUBLIC_DIR = path.join(__dirname, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendFile(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (error, content) => {
    const fallback = path.join(PUBLIC_DIR, "index.html");
    if (error && !path.extname(requested)) {
      return fs.readFile(fallback, (fallbackError, fallbackContent) => {
        if (fallbackError) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": contentTypes[".html"], "Cache-Control": "no-store" });
        res.end(fallbackContent);
      });
    }
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(fullPath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

async function sendApi(req, res) {
  try {
    const body = await readRequestBody(req);
    const result = await handler({
      httpMethod: req.method,
      path: new URL(req.url, `http://${req.headers.host}`).pathname,
      rawUrl: `http://${req.headers.host}${req.url}`,
      headers: req.headers,
      body: body || null
    });
    res.writeHead(result.statusCode, result.headers || {});
    res.end(result.body || "");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message || "Server error." }));
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    sendApi(req, res);
    return;
  }
  sendFile(req, res);
});

server.listen(PORT, HOST || undefined, () => {
  console.log(`3FDP Team Site running at http://localhost:${PORT}`);
});
