(() => {
  const maps = {
    global: window.map_global,
    mainSH: window.map_mainSH,
    mainSZ: window.map_mainSZ,
    bjs: window.map_bjs,
    kcb: window.map_kcb,
    399006: window.map_399006,
  };

  const metricLabels = {
    "mkt_idx.cur_chng_pct": "涨跌幅",
    RECENT_1WEEK_RATE: "近1周涨跌幅",
    RECENT_HALF_MOUTH_RATE: "近2周涨跌幅",
    RATE60: "近2月涨跌幅",
    THIS_YEAR_RATE: "年初至今",
    PE_TTM: "市盈率(TTM)",
    PB: "市净率",
  };

  const indexNames = {
    szzs: "上证指数",
    szcz: "深证成指",
    cyb: "创业板指",
    kc50: "科创50",
    hs300: "沪深300",
  };

  const mapNames = {
    global: "A股全图",
    mainSH: "上证A股",
    mainSZ: "深证A股",
    bjs: "北交所A股",
    kcb: "科创板",
    399006: "创业板",
  };

  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const tooltip = document.getElementById("tooltip");
  const emptyState = document.getElementById("emptyState");
  const metricSelect = document.getElementById("metricSelect");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const captureDialog = document.getElementById("captureDialog");
  const captureImage = document.getElementById("captureImage");
  const downloadCapture = document.getElementById("downloadCapture");

  const state = {
    mapKey: "global",
    metric: "mkt_idx.cur_chng_pct",
    perf: {},
    rects: [],
    leaves: [],
    hovered: null,
    selected: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    auto: true,
    lastFetch: 0,
  };

  function cloneTree(node, parent = null, depth = 0) {
    const copy = {
      name: node.name,
      id: node.id,
      scale: Number(node.scale) || 1,
      parent,
      depth,
      children: null,
    };
    if (Array.isArray(node.children) && node.children.length) {
      copy.children = node.children.map((child) => cloneTree(child, copy, depth + 1));
      copy.scale = copy.children.reduce((sum, child) => sum + child.scale, 0) || copy.scale;
    }
    return copy;
  }

  function flatten(node, list = []) {
    list.push(node);
    if (node.children) node.children.forEach((child) => flatten(child, list));
    return list;
  }

  function walkLeaves(node, list = []) {
    if (!node.children || !node.children.length) list.push(node);
    else node.children.forEach((child) => walkLeaves(child, list));
    return list;
  }

  function totalScale(nodes) {
    return nodes.reduce((sum, node) => sum + Math.max(0.01, node.scale), 0);
  }

  function balancedTreemap(nodes, rect) {
    if (!nodes.length) return [];
    if (nodes.length === 1) return [{ node: nodes[0], ...rect }];

    const sorted = nodes.slice().sort((a, b) => b.scale - a.scale);
    const half = totalScale(sorted) / 2;
    let acc = 0;
    let split = 1;
    for (; split < sorted.length - 1; split++) {
      if (acc + sorted[split].scale > half) break;
      acc += sorted[split].scale;
    }

    const left = sorted.slice(0, split);
    const right = sorted.slice(split);
    const leftTotal = totalScale(left);
    const all = leftTotal + totalScale(right);
    const ratio = leftTotal / all;

    if (rect.w >= rect.h) {
      const w1 = rect.w * ratio;
      return [
        ...balancedTreemap(left, { x: rect.x, y: rect.y, w: w1, h: rect.h }),
        ...balancedTreemap(right, { x: rect.x + w1, y: rect.y, w: rect.w - w1, h: rect.h }),
      ];
    }

    const h1 = rect.h * ratio;
    return [
      ...balancedTreemap(left, { x: rect.x, y: rect.y, w: rect.w, h: h1 }),
      ...balancedTreemap(right, { x: rect.x, y: rect.y + h1, w: rect.w, h: rect.h - h1 }),
    ];
  }

  function worstAspect(row, side) {
    if (!row.length || side <= 0) return Infinity;
    const areas = row.map((item) => item.area);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    const side2 = side * side;
    return Math.max((side2 * max) / (sum * sum), (sum * sum) / (side2 * min));
  }

  function layoutSquarifyRow(row, rect, out) {
    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    if (rect.w >= rect.h) {
      const w = Math.min(rect.w, rowArea / rect.h);
      let y = rect.y;
      row.forEach((item, index) => {
        const isLast = index === row.length - 1;
        const h = isLast ? rect.y + rect.h - y : item.area / w;
        out.push({ node: item.node, x: rect.x, y, w, h });
        y += h;
      });
      return { x: rect.x + w, y: rect.y, w: Math.max(0, rect.w - w), h: rect.h };
    }

    const h = Math.min(rect.h, rowArea / rect.w);
    let x = rect.x;
    row.forEach((item, index) => {
      const isLast = index === row.length - 1;
      const w = isLast ? rect.x + rect.w - x : item.area / h;
      out.push({ node: item.node, x, y: rect.y, w, h });
      x += w;
    });
    return { x: rect.x, y: rect.y + h, w: rect.w, h: Math.max(0, rect.h - h) };
  }

  function squarifiedTreemap(nodes, rect) {
    if (!nodes.length || rect.w <= 0 || rect.h <= 0) return [];
    if (nodes.length === 1) return [{ node: nodes[0], ...rect }];

    const scale = (rect.w * rect.h) / totalScale(nodes);
    const items = nodes
      .slice()
      .sort((a, b) => b.scale - a.scale)
      .map((node) => ({ node, area: Math.max(0.01, node.scale) * scale }));

    const out = [];
    let remaining = { ...rect };
    let row = [];

    while (items.length) {
      const item = items[0];
      const side = Math.min(remaining.w, remaining.h);
      if (!row.length || worstAspect([...row, item], side) <= worstAspect(row, side)) {
        row.push(items.shift());
      } else {
        remaining = layoutSquarifyRow(row, remaining, out);
        row = [];
      }
    }

    if (row.length) layoutSquarifyRow(row, remaining, out);
    return out;
  }

  function layoutNode(node, rect, out) {
    out.push({ node, ...rect });
    if (!node.children || node.children.length === 0 || rect.w < 12 || rect.h < 12) return;

    const pad = node.depth === 0 ? 4 : 2;
    const header = node.depth < 2 ? Math.min(21, Math.max(14, rect.h * 0.12)) : 0;
    const inner = {
      x: rect.x + pad,
      y: rect.y + pad + header,
      w: Math.max(0, rect.w - pad * 2),
      h: Math.max(0, rect.h - pad * 2 - header),
    };

    const childRects = node.depth === 0 ? balancedTreemap(node.children, inner) : squarifiedTreemap(node.children, inner);
    childRects.forEach((item) => layoutNode(item.node, item, out));
  }

  function parsePerf(raw) {
    if (!raw || raw === "-|-" || raw === "-") return { value: null, price: null };
    const [value, price] = String(raw).split("|");
    const num = Number(value);
    return {
      value: Number.isFinite(num) ? num : null,
      price: price && price !== "-" ? price : null,
    };
  }

  function nodePerf(node) {
    if (!node.children) return parsePerf(state.perf[node.name]);
    const values = walkLeaves(node)
      .map((leaf) => parsePerf(state.perf[leaf.name]).value)
      .filter((value) => value !== null);
    if (!values.length) return { value: null, price: null };
    return { value: values.reduce((a, b) => a + b, 0) / values.length, price: null };
  }

  function colorFor(value) {
    if (value === null || Number.isNaN(value)) return "#3e403f";
    if (state.metric === "PE_TTM" || state.metric === "PB") {
      const clamped = Math.max(0, Math.min(1, value / (state.metric === "PE_TTM" ? 120 : 9.6)));
      const hue = 124 - clamped * 124;
      return `hsl(${hue} 72% ${32 + clamped * 10}%)`;
    }

    const limit = state.metric === "mkt_idx.cur_chng_pct" ? 4 : state.metric === "THIS_YEAR_RATE" ? 32 : 24;
    const mag = Math.min(1, Math.abs(value) / limit);
    if (value > 0) return `hsl(2 76% ${26 + mag * 28}%)`;
    if (value < 0) return `hsl(145 76% ${24 + mag * 28}%)`;
    return "#444640";
  }

  function setupCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function transformRect(rect) {
    return {
      x: rect.x * state.zoom + state.panX,
      y: rect.y * state.zoom + state.panY,
      w: rect.w * state.zoom,
      h: rect.h * state.zoom,
    };
  }

  function visible(rect, width, height) {
    return rect.x + rect.w >= 0 && rect.y + rect.h >= 0 && rect.x <= width && rect.y <= height;
  }

  function render() {
    setupCanvas();
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#252931";
    ctx.fillRect(0, 0, width, height);

    const root = cloneTree(maps[state.mapKey]);
    const rects = [];
    layoutNode(root, { x: 0, y: 0, w: width, h: height }, rects);
    state.rects = rects.map((rect) => ({ ...rect, screen: transformRect(rect) }));

    const drawRects = state.rects
      .filter((rect) => visible(rect.screen, width, height))
      .sort((a, b) => a.node.depth - b.node.depth);

    drawRects.forEach((rect) => {
      const r = rect.screen;
      if (r.w < 0.6 || r.h < 0.6) return;
      const perf = nodePerf(rect.node);
      ctx.fillStyle = rect.node.children ? "#252931" : colorFor(perf.value);
      ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.ceil(r.w), Math.ceil(r.h));

      ctx.strokeStyle = rect.node.depth <= 1 ? "#5f6470" : "rgba(0,0,0,.55)";
      ctx.lineWidth = rect.node.depth <= 1 ? 1.2 : 0.65;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.max(0, Math.ceil(r.w) - 1), Math.max(0, Math.ceil(r.h) - 1));

      if (rect.node.depth <= 1 && r.w > 48 && r.h > 23) {
        const size = Math.min(24, Math.max(15, Math.sqrt(r.w * r.h) / 14));
        drawFittedText(rect.node.name, r.x + 7, r.y + size + 1, r.w - 14, size, "#f6eee4", true);
      } else if (!rect.node.children && r.w > 22 && r.h > 11) {
        drawStockLabel(rect.node, perf, r);
      }

      if (state.selected && state.selected.id === rect.node.id) {
        ctx.strokeStyle = "#f5d66f";
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x + 2, r.y + 2, Math.max(0, r.w - 4), Math.max(0, r.h - 4));
      }
    });

    emptyState.hidden = Object.keys(state.perf).length > 0;
  }

  function drawText(text, x, y, size, color, bold) {
    ctx.font = `${bold ? "700 " : ""}${size}px Microsoft YaHei, Arial`;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(text), x, y);
  }

  function drawFittedText(text, x, y, maxWidth, size, color, bold) {
    const value = String(text);
    ctx.font = `${bold ? "700 " : ""}${size}px Microsoft YaHei, Arial`;
    if (ctx.measureText(value).width <= maxWidth) {
      drawText(value, x, y, size, color, bold);
      return;
    }

    let clipped = value;
    while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    drawText(clipped.length > 1 ? `${clipped}...` : clipped, x, y, size, color, bold);
  }

  function drawCenteredFittedText(text, cx, cy, maxWidth, size, color, bold) {
    const value = String(text);
    ctx.save();
    ctx.font = `${bold ? "700 " : ""}${size}px Microsoft YaHei, Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.78)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    let clipped = value;
    if (ctx.measureText(clipped).width > maxWidth) {
      while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
        clipped = clipped.slice(0, -1);
      }
      clipped = clipped.length > 1 ? `${clipped}...` : clipped;
    }

    ctx.fillText(clipped, cx, cy);
    ctx.restore();
  }

  function stockFontSize(rect) {
    const area = rect.w * rect.h;
    const base = Math.sqrt(area) / 7.6;
    const edgeLimit = Math.min(rect.w / 4.2, rect.h / 2.0);
    return Math.max(6, Math.min(30, base, edgeLimit));
  }

  function drawStockLabel(node, perf, rect) {
    let fontSize = stockFontSize(rect);
    let valueSize = Math.max(6, Math.min(fontSize * 0.94, rect.h / 3.4));
    let pad = Math.max(2, Math.min(8, fontSize * 0.38));
    const gap = 1;
    const availableHeight = rect.h - pad * 2;

    if (availableHeight < fontSize + valueSize + gap) {
      const ratio = Math.max(0.38, availableHeight / (fontSize + valueSize + gap));
      fontSize = Math.max(6, fontSize * ratio);
      valueSize = Math.max(6, valueSize * ratio);
      pad = Math.max(1, Math.min(7, fontSize * 0.34));
    }

    const maxWidth = rect.w - pad * 2;
    const canShowValue = rect.h >= pad * 2 + fontSize + valueSize + gap && rect.w > 18 && valueSize >= 6 && perf.value !== null;
    const canShowName = rect.h >= pad * 2 + fontSize && rect.w > 16 && fontSize >= 6;

    if (!canShowName) return;
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;

    if (!canShowValue) {
      drawCenteredFittedText(node.name, centerX, centerY, maxWidth, fontSize, "#fff7ee", false);
      return;
    }

    const totalHeight = fontSize + valueSize + gap;
    drawCenteredFittedText(node.name, centerX, centerY - totalHeight / 2 + fontSize / 2, maxWidth, fontSize, "#fff7ee", false);
    drawCenteredFittedText(formatValue(perf.value), centerX, centerY + totalHeight / 2 - valueSize / 2, maxWidth, valueSize, "#fff7ee", true);
  }

  function formatValue(value) {
    if (value === null) return "--";
    if (state.metric === "PE_TTM" || state.metric === "PB") return value.toFixed(2);
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  }

  function hitTest(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    let match = null;
    for (const rect of state.rects) {
      const r = rect.screen;
      if (x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h) {
        if (!match || rect.node.depth > match.node.depth) match = rect;
      }
    }
    return match;
  }

  function showTooltip(rect, event) {
    if (!rect) {
      tooltip.hidden = true;
      return;
    }

    const perf = nodePerf(rect.node);
    const parent = rect.node.parent ? rect.node.parent.name : mapNames[state.mapKey];
    tooltip.innerHTML = `
      <strong>${rect.node.name}</strong>
      <div><span>代码/分组</span><b>${rect.node.id || "--"}</b></div>
      <div><span>所属</span><b>${parent}</b></div>
      <div><span>${metricLabels[state.metric]}</span><b>${formatValue(perf.value)}</b></div>
      <div><span>现价</span><b>${perf.price || "--"}</b></div>
      <div><span>市值权重</span><b>${Math.round(rect.node.scale).toLocaleString()}</b></div>
    `;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 310)}px`;
    tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - 180)}px`;
  }

  function updateClock() {
    document.getElementById("clock").textContent = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
    });
  }

  async function api(path) {
    const res = await fetch(`/api/dpyt${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadIndexes() {
    const data = await api("/getRealtimeIndexes");
    const entries = ["szzs", "szcz", "cyb", "kc50", "hs300"];
    document.getElementById("indexStrip").innerHTML = entries
      .map((key) => {
        const [price = "--", rate = "--"] = String(data.data?.[key] || "").split(",");
        const value = Number(rate);
        const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
        return `<a class="index-card" href="${indexLink(key)}" target="_blank" rel="noreferrer">
          <strong>${indexNames[key]}</strong>
          <span class="${cls}">${price} ${rate}%</span>
        </a>`;
      })
      .join("");
  }

  function indexLink(key) {
    return {
      szzs: "https://xueqiu.com/S/SH000001",
      szcz: "https://xueqiu.com/S/SZ399001",
      cyb: "https://xueqiu.com/S/SZ399006",
      kc50: "https://xueqiu.com/S/SH000688",
      hs300: "https://xueqiu.com/S/SH000300",
    }[key];
  }

  async function loadPerf() {
    const metric = state.metric;
    const path =
      metric === "mkt_idx.cur_chng_pct"
        ? `/getMapParamDataV3?param=${encodeURIComponent(metric)}&changed=null`
        : `/getMapParamDataV2?param=${encodeURIComponent(metric)}`;
    const data = await api(path);
    state.perf = data.data || {};
    state.lastFetch = Date.now();
    render();
  }

  async function loadRecall(time) {
    const data = await api(`/getDayRecallRate?time=${encodeURIComponent(time)}`);
    state.perf = data.data || {};
    render();
  }

  function renderLegend() {
    const legend = document.getElementById("legend");
    const labels =
      state.metric === "PE_TTM"
        ? ["0", "15", "30", "45", "60", "75", "90", "105", "120"]
        : state.metric === "PB"
          ? ["0", "1.2", "2.4", "3.6", "4.8", "6", "7.2", "8.4", "9.6"]
          : ["-4%", "-3%", "-2%", "-1%", "0%", "1%", "2%", "3%", "4%"];
    legend.innerHTML = labels
      .map((label) => {
        const value = Number(label.replace("%", ""));
        const color = state.metric === "PE_TTM" || state.metric === "PB" ? colorFor(value) : colorFor(value);
        return `<span class="legend-step" style="background:${color}">${label}</span>`;
      })
      .join("");
  }

  function bindEvents() {
    window.addEventListener("resize", render);
    setInterval(updateClock, 1000);
    updateClock();

    document.querySelectorAll(".market-nav button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".market-nav button").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        state.mapKey = button.dataset.map;
        state.panX = 0;
        state.panY = 0;
        state.zoom = 1;
        state.selected = null;
        render();
      });
    });

    metricSelect.addEventListener("change", async () => {
      state.metric = metricSelect.value;
      document.querySelectorAll(".recall button").forEach((button) => button.classList.remove("active"));
      renderLegend();
      emptyState.hidden = false;
      emptyState.textContent = "正在加载行情数据...";
      await safeLoad(loadPerf);
    });

    document.getElementById("refreshBtn").addEventListener("click", () => safeLoad(loadAll));

    document.getElementById("fullscreenBtn").addEventListener("click", () => {
      document.body.classList.toggle("immersive");
      setTimeout(render, 40);
    });

    document.getElementById("autoBtn").addEventListener("click", (event) => {
      state.auto = !state.auto;
      event.currentTarget.classList.toggle("active", state.auto);
    });

    document.querySelectorAll(".recall button").forEach((button) => {
      button.addEventListener("click", async () => {
        document.querySelectorAll(".recall button").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        emptyState.hidden = false;
        emptyState.textContent = `正在加载 ${button.dataset.time} 复盘...`;
        await safeLoad(() => loadRecall(button.dataset.time));
      });
    });

    canvas.addEventListener("mousemove", (event) => {
      if (state.dragging) return;
      const hit = hitTest(event.clientX, event.clientY);
      state.hovered = hit?.node || null;
      showTooltip(hit, event);
    });

    canvas.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });

    canvas.addEventListener("mousedown", (event) => {
      state.dragging = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      canvas.classList.add("dragging");
    });

    window.addEventListener("mouseup", () => {
      state.dragging = false;
      canvas.classList.remove("dragging");
    });

    window.addEventListener("mousemove", (event) => {
      if (!state.dragging) return;
      state.panX = state.dragging.panX + event.clientX - state.dragging.x;
      state.panY = state.dragging.panY + event.clientY - state.dragging.y;
      render();
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const oldZoom = state.zoom;
        const nextZoom = Math.max(0.55, Math.min(5, state.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
        const box = canvas.getBoundingClientRect();
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        state.panX = x - ((x - state.panX) / oldZoom) * nextZoom;
        state.panY = y - ((y - state.panY) / oldZoom) * nextZoom;
        state.zoom = nextZoom;
        render();
      },
      { passive: false },
    );

    canvas.addEventListener("click", (event) => {
      const hit = hitTest(event.clientX, event.clientY);
      state.selected = hit?.node || null;
      render();
    });

    canvas.addEventListener("dblclick", (event) => {
      const hit = hitTest(event.clientX, event.clientY);
      if (!hit || hit.node.children || !/\.(SH|SZ|BJ)$/.test(hit.node.id)) return;
      window.open(`https://xueqiu.com/S/${hit.node.id.replace(".", "")}`, "_blank", "noreferrer");
    });

    searchInput.addEventListener("input", handleSearch);
    document.getElementById("captureBtn").addEventListener("click", capture);
  }

  function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      searchResults.innerHTML = "";
      state.selected = null;
      render();
      return;
    }

    const root = cloneTree(maps[state.mapKey]);
    const results = flatten(root)
      .filter((node) => `${node.name} ${node.id}`.toLowerCase().includes(query))
      .slice(0, 30);

    searchResults.innerHTML = results
      .map(
        (node, index) =>
          `<button class="search-item" data-index="${index}" type="button">${node.name}<span>${node.id || "--"}</span></button>`,
      )
      .join("");

    searchResults.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.selected = results[Number(button.dataset.index)];
        render();
      });
    });
  }

  function capture() {
    const url = canvas.toDataURL("image/png");
    captureImage.src = url;
    downloadCapture.href = url;
    captureDialog.showModal();
  }

  async function safeLoad(fn) {
    try {
      await fn();
      emptyState.hidden = true;
    } catch (error) {
      console.error(error);
      emptyState.hidden = false;
      emptyState.textContent = "行情接口暂时不可用，已保留本地云图结构";
      render();
    }
  }

  async function loadAll() {
    await Promise.all([loadIndexes(), loadPerf()]);
  }

  async function init() {
    bindEvents();
    renderLegend();
    render();
    await safeLoad(loadAll);
    setInterval(() => {
      if (!state.auto) return;
      if (Date.now() - state.lastFetch < 10000) return;
      if (state.metric === "mkt_idx.cur_chng_pct") safeLoad(loadAll);
    }, 15000);
  }

  init();
})();
