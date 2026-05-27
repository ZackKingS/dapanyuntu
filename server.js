// ==================== 本地大盘云图服务器 ====================
// 功能：1. 提供静态文件（HTML/CSS/JS）
//      2. 代理API请求到data.dapanyuntu.com（绕过跨域限制）

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// ==================== 配置 ====================
const ROOT = __dirname;                          // 项目根目录
const PORT = Number(process.env.PORT || 4173);  // 监听端口（可通过环境变量覆盖）
const DATA_HOST = "https://data.dapanyuntu.com"; // 上游数据服务器地址

// API白名单：只允许代理这些端点（安全考虑，防止滥用）
const ALLOWED = new Set([
  "/dpyt/getRealtimeIndexes",      // 获取主要指数
  "/dpyt/queryCurrentVerion",      // 查询当前版本
  "/dpyt/getMapParamDataV3",       // 获取实时行情数据（新版本）
  "/dpyt/getMapParamDataV2",       // 获取历史数据
  "/dpyt/getHistoryRateByDate",    // 获取历史涨跌幅
  "/dpyt/getDayRecallRate",        // 获取复盘数据
]);

// MIME类型映射：根据文件扩展名返回正确的Content-Type
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ==================== 工具函数 ====================
// 发送HTTP响应的辅助函数
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

// 处理API响应：移除股票名称中的 -U 后缀
function removeUsuffix(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);

    // 如果响应包含 data 字段且是对象，处理其中的股票名称
    if (data.data && typeof data.data === 'object') {
      const processed = {};

      for (const [key, value] of Object.entries(data.data)) {
        // 移除股票名称中的 -U 后缀
        const newKey = key.replace(/-U$/, '');
        processed[newKey] = value;
      }

      data.data = processed;
    }

    return JSON.stringify(data);
  } catch (error) {
    // 如果不是JSON或处理失败，直接返回原始字符串
    return jsonStr;
  }
}

// ==================== API代理 ====================
// 代理来自前端的API请求到dapanyuntu.com
// 作用：1. 绕过浏览器跨域限制
//      2. 白名单验证，防止滥用
//      3. 伪装User-Agent和Referer避免被检测
async function proxyDpyt(req, res, url) {
  // 将请求路径从 /api/dpyt/* 转换为 /dpyt/*
  const targetPath = url.pathname.replace(/^\/api\/dpyt/, "/dpyt");

  // 白名单检查：只允许特定的API端点
  if (!ALLOWED.has(targetPath)) {
    return send(res, 403, JSON.stringify({ error: "endpoint not allowed" }), {
      "content-type": TYPES[".json"],
    });
  }

  // 构建目标URL并传递查询参数
  const target = new URL(DATA_HOST + targetPath);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  try {
    // 发起请求到上游服务器
    const upstream = await fetch(target, {
      headers: {
        "user-agent": "Mozilla/5.0 local dapanyuntu clone",
        "referer": "https://dapanyuntu.com/",
      },
    });
    let text = await upstream.text();

    // 处理响应数据：移除股票名称中的 -U 后缀
    if (targetPath === "/dpyt/getMapParamDataV3" || targetPath === "/dpyt/getMapParamDataV2") {
      text = removeUsuffix(text);
    }

    // 转发响应：保留原始状态码、Content-Type，添加CORS头允许跨域
    send(res, upstream.status, text, {
      "content-type": upstream.headers.get("content-type") || TYPES[".json"],
      "cache-control": "no-store",
      "access-control-allow-origin": "*", // 允许所有来源的跨域请求
    });
  } catch (error) {
    // 上游请求失败（网络错误、服务器无法访问等）
    send(
      res,
      502, // Bad Gateway
      JSON.stringify({ error: "upstream request failed", detail: error.message }),
      { "content-type": TYPES[".json"] },
    );
  }
}

// ==================== 静态文件服务 ====================
// 提供HTML、CSS、JS、PNG等本地文件
function serveStatic(req, res, url) {
  // URL解码：处理特殊字符（如%20空格）
  let filePath = decodeURIComponent(url.pathname);
  // 根路径 / 映射到 index.html
  if (filePath === "/") filePath = "/index.html";

  // 解析绝对路径并检查安全性（防止目录遍历攻击 ../../../etc/passwd）
  const resolved = path.resolve(ROOT, "." + filePath);
  if (!resolved.startsWith(ROOT)) return send(res, 403, "Forbidden");

  // 读取文件
  fs.readFile(resolved, (error, content) => {
    if (error) return send(res, 404, "Not found");

    // 获取文件扩展名，用于确定MIME类型
    const ext = path.extname(resolved).toLowerCase();
    send(res, 200, content, {
      "content-type": TYPES[ext] || "application/octet-stream",
      // JS和CSS文件设为no-cache（有更新时立即加载新版本）
      // 其他文件设为no-store（不缓存）
      "cache-control": ext === ".js" || ext === ".css" ? "no-cache" : "no-store",
    });
  });
}

// ==================== HTTP服务器 ====================
// 创建HTTP服务器，路由请求到不同的处理函数
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 路由逻辑：
  // - /api/dpyt/* → 代理到上游API服务器
  // - 其他路径 → 提供本地静态文件
  if (url.pathname.startsWith("/api/dpyt/")) return proxyDpyt(req, res, url);
  return serveStatic(req, res, url);
});

// 启动服务器
// 监听0.0.0.0:PORT (允许任何网络接口访问)
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Local dapanyuntu clone: http://0.0.0.0:${PORT}`);
});
