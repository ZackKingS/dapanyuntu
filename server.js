const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const DATA_HOST = "https://data.dapanyuntu.com";
const ALLOWED = new Set([
  "/dpyt/getRealtimeIndexes",
  "/dpyt/queryCurrentVerion",
  "/dpyt/getMapParamDataV3",
  "/dpyt/getMapParamDataV2",
  "/dpyt/getHistoryRateByDate",
  "/dpyt/getDayRecallRate",
]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function proxyDpyt(req, res, url) {
  const targetPath = url.pathname.replace(/^\/api\/dpyt/, "/dpyt");
  if (!ALLOWED.has(targetPath)) {
    return send(res, 403, JSON.stringify({ error: "endpoint not allowed" }), {
      "content-type": TYPES[".json"],
    });
  }

  const target = new URL(DATA_HOST + targetPath);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  try {
    const upstream = await fetch(target, {
      headers: {
        "user-agent": "Mozilla/5.0 local dapanyuntu clone",
        referer: "https://dapanyuntu.com/",
      },
    });
    const text = await upstream.text();
    send(res, upstream.status, text, {
      "content-type": upstream.headers.get("content-type") || TYPES[".json"],
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
  } catch (error) {
    send(
      res,
      502,
      JSON.stringify({ error: "upstream request failed", detail: error.message }),
      { "content-type": TYPES[".json"] },
    );
  }
}

function serveStatic(req, res, url) {
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === "/") filePath = "/index.html";
  const resolved = path.resolve(ROOT, "." + filePath);
  if (!resolved.startsWith(ROOT)) return send(res, 403, "Forbidden");

  fs.readFile(resolved, (error, content) => {
    if (error) return send(res, 404, "Not found");
    const ext = path.extname(resolved).toLowerCase();
    send(res, 200, content, {
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": ext === ".js" || ext === ".css" ? "no-cache" : "no-store",
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/dpyt/")) return proxyDpyt(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local dapanyuntu clone: http://127.0.0.1:${PORT}`);
});
