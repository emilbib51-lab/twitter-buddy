const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const PORT = config.dashboard?.port || 3456;

// ========== API Handlers ==========

function getStatus() {
  let state = { lastNewestTweet: null, lastCollectionTime: null, totalCollected: 0, gaps: [] };
  try {
    if (fs.existsSync(config.stateFile)) {
      state = JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
    }
  } catch {}

  let tweetFiles = 0;
  let totalTweets = 0;
  try {
    const files = fs.readdirSync(config.tweetsDir).filter(f => f.endsWith(".json"));
    tweetFiles = files.length;
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(config.tweetsDir, f), "utf-8"));
        totalTweets += data.length;
      } catch {}
    }
  } catch {}

  let analysisCount = 0;
  try {
    analysisCount = fs.readdirSync(config.analysisDir).filter(f => f.endsWith(".md")).length;
  } catch {}

  let discoverCount = 0;
  try {
    discoverCount = fs.readdirSync(config.discoverDir).filter(f => f.endsWith(".md")).length;
  } catch {}

  return {
    state, tweetFiles, totalTweets, analysisCount, discoverCount,
    analysisIntervalMs: config.daemon.analysisIntervalMs,
    discoverIntervalMs: config.discover.intervalMs,
  };
}

function getTweetFiles() {
  try {
    const files = fs.readdirSync(config.tweetsDir)
      .filter(f => f.endsWith(".json"))
      .sort().reverse();
    return files.map(f => {
      const filepath = path.join(config.tweetsDir, f);
      const stat = fs.statSync(filepath);
      let count = 0;
      let newest = null;
      let oldest = null;
      try {
        const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
        count = data.length;
        if (data.length > 0) {
          newest = data[0].time;
          oldest = data[data.length - 1].time;
        }
      } catch {}
      return { filename: f, size: stat.size, count, newest, oldest };
    });
  } catch {
    return [];
  }
}

function getAnalyses() {
  try {
    const files = fs.readdirSync(config.analysisDir)
      .filter(f => f.endsWith(".md"))
      .sort().reverse();
    return files.map(f => {
      const stat = fs.statSync(path.join(config.analysisDir, f));
      // Parse date from filename: analysis_YYYY-MM-DD-HH-MM.md
      const match = f.match(/analysis_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.md/);
      const date = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : f;
      return { filename: f, date, size: stat.size };
    });
  } catch {
    return [];
  }
}

function getAnalysisContent(filename) {
  // Sanitize filename to prevent path traversal
  const safe = path.basename(filename);
  if (!safe.endsWith(".md")) return null;
  const filepath = path.join(config.analysisDir, safe);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

function getDiscovers() {
  try {
    const files = fs.readdirSync(config.discoverDir)
      .filter(f => f.endsWith(".md"))
      .sort().reverse();
    return files.map(f => {
      const stat = fs.statSync(path.join(config.discoverDir, f));
      const match = f.match(/discover_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.md/);
      const date = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : f;
      return { filename: f, date, size: stat.size };
    });
  } catch {
    return [];
  }
}

function getDiscoverContent(filename) {
  const safe = path.basename(filename);
  if (!safe.endsWith(".md")) return null;
  const filepath = path.join(config.discoverDir, safe);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

function getTweetStats() {
  const byHour = {};  // "YYYY-MM-DD HH" => count
  const byDay = {};   // "YYYY-MM-DD" => count

  try {
    const files = fs.readdirSync(config.tweetsDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const tweets = JSON.parse(fs.readFileSync(path.join(config.tweetsDir, f), "utf-8"));
        for (const t of tweets) {
          if (!t.time) continue;
          // 转 UTC+8
          const d = new Date(new Date(t.time).getTime() + 8 * 3600000);
          const iso = d.toISOString();
          const day = iso.slice(0, 10);
          const hour = iso.slice(0, 13).replace("T", " ");

          byDay[day] = (byDay[day] || 0) + 1;
          byHour[hour] = (byHour[hour] || 0) + 1;
        }
      } catch {}
    }
  } catch {}

  // 排序
  const sortedDays = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const sortedHours = Object.entries(byHour).sort((a, b) => a[0].localeCompare(b[0]));

  return {
    byDay: sortedDays.map(([label, count]) => ({ label, count })),
    byHour: sortedHours.map(([label, count]) => ({ label, count })),
  };
}

// ========== HTML Dashboard ==========

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Twitter Timeline Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1419; color: #e7e9ea; }
  .top-bar { background: #16202a; padding: 10px 24px; border-bottom: 1px solid #2f3336; display: flex; align-items: center; gap: 20px; transition: margin-top 0.3s, opacity 0.3s; }
  .top-bar.collapsed { margin-top: -52px; opacity: 0; pointer-events: none; }
  .top-bar h1 { font-size: 17px; font-weight: 700; white-space: nowrap; }
  .stat-inline { display: flex; gap: 16px; flex: 1; align-items: center; }
  .stat-chip { display: flex; align-items: center; gap: 5px; font-size: 13px; }
  .stat-chip .val { color: #1d9bf0; font-weight: 700; }
  .stat-chip .lbl { color: #71767b; }
  .top-actions { display: flex; gap: 8px; align-items: center; }
  .btn { background: #1d9bf0; color: #fff; border: none; padding: 5px 14px; border-radius: 16px; cursor: pointer; font-size: 13px; }
  .btn:hover { background: #1a8cd8; }
  .btn:disabled { background: #2f3336; color: #71767b; cursor: not-allowed; }

  .toolbar { display: flex; gap: 0; padding: 0 20px; background: #16202a; border-bottom: 1px solid #2f3336; align-items: center; }
  .view-tabs { display: flex; gap: 0; flex: 1; }
  .view-tab { padding: 10px 20px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; color: #71767b; transition: all 0.15s; }
  .view-tab:hover { color: #e7e9ea; }
  .view-tab.active { color: #1d9bf0; border-bottom-color: #1d9bf0; }

  .analyze-bar { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
  .analyze-bar .label { color: #71767b; font-size: 13px; }
  .analyze-btn { background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 5px 12px; border-radius: 16px; cursor: pointer; font-size: 13px; transition: all 0.15s; }
  .analyze-btn:hover { border-color: #1d9bf0; color: #1d9bf0; }
  .analyze-btn.running { border-color: #f4900c; color: #f4900c; cursor: wait; }
  .custom-hours { width: 50px; background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 5px 8px; border-radius: 8px; font-size: 13px; text-align: center; }
  .custom-hours:focus { outline: none; border-color: #1d9bf0; }
  .model-select { background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 5px 8px; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .model-select:focus { outline: none; border-color: #1d9bf0; }

  .main { display: grid; grid-template-columns: 280px 1fr; gap: 0; min-height: calc(100vh - 90px); }
  .main.expanded .panel-list { display: none; }
  .main.expanded { grid-template-columns: 1fr; }
  @media (max-width: 900px) { .main { grid-template-columns: 1fr; } }

  .panel-list { border-right: 1px solid #2f3336; overflow-y: auto; max-height: calc(100vh - 90px); }
  .panel-content { overflow-y: auto; max-height: calc(100vh - 90px); }
  .panel-title { padding: 16px 20px; font-size: 16px; font-weight: 700; border-bottom: 1px solid #2f3336; background: #16202a; position: sticky; top: 0; z-index: 1; }

  .file-item { padding: 12px 20px; border-bottom: 1px solid #2f3336; cursor: pointer; transition: background 0.15s; }
  .file-item:hover { background: #1c2732; }
  .file-item.active { background: #1c2732; border-left: 3px solid #1d9bf0; }
  .file-item .name { font-size: 14px; font-weight: 600; }
  .file-item .meta { color: #71767b; font-size: 12px; margin-top: 4px; }

  .content-header { display: flex; align-items: center; padding: 10px 30px; border-bottom: 1px solid #2f3336; background: #16202a; position: sticky; top: 0; z-index: 1; gap: 10px; }
  .content-header .title { flex: 1; font-size: 14px; color: #71767b; }
  .expand-btn { background: none; border: 1px solid #2f3336; color: #71767b; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .expand-btn:hover { border-color: #1d9bf0; color: #1d9bf0; }

  .content-area { padding: 24px 36px; overflow-y: auto; }
  .content-area .placeholder { color: #71767b; text-align: center; margin-top: 80px; font-size: 15px; }

  .md-content { line-height: 1.8; font-size: 15px; max-width: 900px; }
  .md-content h1 { font-size: 22px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #2f3336; }
  .md-content h2 { font-size: 18px; margin: 20px 0 10px; color: #1d9bf0; }
  .md-content h3 { font-size: 16px; margin: 16px 0 8px; }
  .md-content p { margin: 10px 0; }
  .md-content ul, .md-content ol { margin: 8px 0 8px 20px; }
  .md-content li { margin: 6px 0; }
  .md-content a { color: #1d9bf0; text-decoration: none; }
  .md-content a:hover { text-decoration: underline; }
  .md-content strong { color: #fff; }
  .md-content hr { border: none; border-top: 1px solid #2f3336; margin: 20px 0; }
  .md-content code { background: #2f3336; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  .md-content pre { background: #1c2732; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
  .md-content pre code { background: none; padding: 0; }
  .md-content blockquote { border-left: 3px solid #1d9bf0; padding-left: 12px; color: #71767b; margin: 8px 0; }

  .toast { position: fixed; bottom: 30px; right: 30px; background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 12px 20px; border-radius: 12px; font-size: 14px; z-index: 100; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .toast.show { display: block; }
  .toast.error { border-color: #f4212e; }
  .toast.success { border-color: #00ba7c; }
</style>
</head>
<body>
  <div class="top-bar" id="top-bar">
    <h1>Timeline</h1>
    <div class="stat-inline" id="stats"></div>
    <div class="top-actions">
      <button class="btn" onclick="loadAll()">Refresh</button>
    </div>
  </div>

  <div class="toolbar">
    <div class="view-tabs">
      <div class="view-tab active" onclick="switchView('analyses')">Analysis Reports</div>
      <div class="view-tab" onclick="switchView('discovers')">Discover</div>
      <div class="view-tab" onclick="switchView('stats')">Stats</div>
      <div class="view-tab" onclick="switchView('tweets')">Tweet Data Files</div>
    </div>
    <div class="analyze-bar">
      <span class="label">Analyze:</span>
      <button class="analyze-btn" onclick="runAnalyze(1)">1h</button>
      <button class="analyze-btn" onclick="runAnalyze(2)">2h</button>
      <button class="analyze-btn" onclick="runAnalyze(8)">8h</button>
      <input class="custom-hours" id="custom-hours" type="number" min="1" max="720" placeholder="h" title="Custom hours">
      <button class="analyze-btn" onclick="runAnalyze(null)">Go</button>
      <span class="label" style="margin-left:12px">Model:</span>
      <select class="model-select" id="model-select">
        <option value="claude-opus-4-6">Opus 4.6</option>
        <option value="claude-sonnet-4-6">Sonnet 4.6</option>
        <option value="claude-sonnet-4-20250514">Sonnet 4</option>
        <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
      </select>
    </div>
  </div>

  <div class="main" id="main-layout">
    <div class="panel-list" id="file-list"></div>
    <div class="panel-content">
      <div class="content-header" id="content-header" style="display:none">
        <div class="title" id="content-title"></div>
        <button class="expand-btn" onclick="toggleExpand()" id="expand-btn">Expand</button>
      </div>
      <div class="content-area" id="content-area">
        <div class="placeholder">Select a report to view</div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
  let currentView = 'analyses';
  let isExpanded = false;

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = 'toast', 5000);
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
    document.getElementById('main-layout').classList.toggle('expanded', isExpanded);
    document.getElementById('expand-btn').textContent = isExpanded ? 'Collapse' : 'Expand';
  }

  const viewOrder = ['analyses', 'discovers', 'stats', 'tweets'];
  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-tab').forEach((tab, i) => {
      tab.classList.toggle('active', viewOrder[i] === view);
    });
    const isStats = view === 'stats';
    document.getElementById('file-list').style.display = isStats ? 'none' : '';
    document.getElementById('main-layout').style.gridTemplateColumns = isStats ? '1fr' : '280px 1fr';
    document.getElementById('content-header').style.display = 'none';
    if (view === 'analyses') { loadAnalyses(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select an item to view</div>'; }
    else if (view === 'discovers') { loadDiscovers(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select an item to view</div>'; }
    else if (view === 'stats') loadStats();
    else { loadTweetFiles(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select an item to view</div>'; }
  }

  async function loadAll() {
    await loadStatus();
    if (currentView === 'analyses') loadAnalyses();
    else if (currentView === 'discovers') loadDiscovers();
    else if (currentView === 'stats') loadStats();
    else loadTweetFiles();
  }

  function toUTC8(iso) {
    if (!iso) return 'N/A';
    const d = new Date(new Date(iso).getTime() + 8 * 3600000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  let _statusData = null;
  async function loadStatus() {
    const res = await fetch('/api/status');
    _statusData = await res.json();
    const s = _statusData.state;
    const lastCol = s.lastCollectionTime ? toUTC8(s.lastCollectionTime) : 'N/A';
    document.getElementById('stats').innerHTML = \`
      <div class="stat-chip"><span class="val">\${_statusData.totalTweets}</span><span class="lbl">tweets</span></div>
      <div class="stat-chip"><span class="val">\${_statusData.tweetFiles}</span><span class="lbl">files</span></div>
      <div class="stat-chip"><span class="val">\${_statusData.analysisCount}</span><span class="lbl">reports</span></div>
      <div class="stat-chip"><span class="val">\${_statusData.discoverCount}</span><span class="lbl">discovers</span></div>
      <div class="stat-chip"><span class="lbl">last:</span><span class="val" style="font-weight:400">\${lastCol}</span></div>
      \${s.gaps && s.gaps.length > 0 ? '<div class="stat-chip"><span style="color:#f4212e">' + s.gaps.length + ' gaps</span></div>' : ''}
    \`;
  }

  function calcNextRun(lastTime, intervalMs) {
    if (!lastTime) return 'soon';
    const next = new Date(new Date(lastTime).getTime() + intervalMs);
    const now = new Date();
    if (next <= now) return 'soon';
    const diff = next - now;
    const mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' min';
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return hrs + 'h ' + m + 'm';
  }

  async function loadAnalyses() {
    const res = await fetch('/api/analyses');
    const files = await res.json();
    const list = document.getElementById('file-list');
    const nextAnalysis = _statusData ? calcNextRun(_statusData.state.lastAnalysisTime, _statusData.analysisIntervalMs) : '...';
    const scheduleInfo = '<div style="font-size:11px;color:#71767b;font-weight:400;margin-top:4px">Next auto-analysis: <span style="color:#1d9bf0">' + nextAnalysis + '</span></div>';
    if (files.length === 0) {
      list.innerHTML = '<div class="panel-title">Analysis Reports' + scheduleInfo + '</div><div class="file-item"><div class="meta">No reports yet</div></div>';
      return;
    }
    list.innerHTML = '<div class="panel-title">Analysis Reports (' + files.length + ')' + scheduleInfo + '</div>' +
      files.map(f => \`
        <div class="file-item" onclick="loadAnalysis('\${f.filename}', this)">
          <div class="name">\${f.date}</div>
          <div class="meta">\${f.filename} | \${(f.size / 1024).toFixed(1)} KB</div>
        </div>
      \`).join('');
  }

  async function loadAnalysis(filename, el) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');
    const res = await fetch('/api/analysis/' + encodeURIComponent(filename));
    const md = await res.text();
    const html = marked.parse(md);
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = filename;
    document.getElementById('content-area').innerHTML = '<div class="md-content">' + html + '</div>';
    document.querySelectorAll('.md-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }

  async function loadDiscovers() {
    const res = await fetch('/api/discovers');
    const files = await res.json();
    const list = document.getElementById('file-list');
    const nextDiscover = _statusData ? calcNextRun(_statusData.state.lastDiscoverTime, _statusData.discoverIntervalMs) : '...';
    const titleHtml = '<div class="panel-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="flex:1">Discover (' + files.length + ')</span>' +
      '<button class="analyze-btn" id="discover-run-btn" onclick="runDiscoverNow()" style="font-size:12px;padding:3px 10px">Run Now</button>' +
      '<div style="font-size:11px;color:#71767b;font-weight:400;width:100%">Next auto-discover: <span style="color:#1d9bf0">' + nextDiscover + '</span></div>' +
      '</div>';
    if (files.length === 0) {
      list.innerHTML = titleHtml + '<div class="file-item"><div class="meta">No reports yet</div></div>';
      return;
    }
    list.innerHTML = titleHtml +
      files.map(f => \`
        <div class="file-item" onclick="loadDiscover('\${f.filename}', this)">
          <div class="name">\${f.date}</div>
          <div class="meta">\${f.filename} | \${(f.size / 1024).toFixed(1)} KB</div>
        </div>
      \`).join('');
  }

  async function loadDiscover(filename, el) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');
    const res = await fetch('/api/discover/' + encodeURIComponent(filename));
    const md = await res.text();
    const html = marked.parse(md);
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = filename;
    document.getElementById('content-area').innerHTML = '<div class="md-content">' + html + '</div>';
    document.querySelectorAll('.md-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }

  async function runDiscoverNow() {
    const btn = document.getElementById('discover-run-btn');
    if (btn) { btn.classList.add('running'); btn.disabled = true; btn.textContent = 'Running...'; }
    showToast('Starting account discovery ...', '');
    try {
      const res = await fetch('/api/discover', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        showToast('Discover failed: ' + data.error, 'error');
      } else {
        showToast('Discover complete! ' + data.tweetCount + ' tweets analyzed.', 'success');
        await loadAll();
        if (data.filename) loadDiscover(data.filename, null);
      }
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.classList.remove('running'); btn.disabled = false; btn.textContent = 'Run Now'; }
    }
  }

  let statsChart = null;
  async function loadStats(mode) {
    const area = document.getElementById('content-area');
    area.innerHTML = '<div style="padding:20px;color:#71767b">Loading stats...</div>';
    const res = await fetch('/api/tweet-stats');
    const data = await res.json();
    const curMode = mode || 'byDay';

    const btnStyle = (m) => 'background:' + (curMode === m ? '#1d9bf0' : '#16202a') + ';color:' + (curMode === m ? '#fff' : '#e7e9ea') + ';border:1px solid ' + (curMode === m ? '#1d9bf0' : '#2f3336') + ';padding:5px 14px;border-radius:16px;cursor:pointer;font-size:13px;';

    const items = data[curMode];
    const labels = items.map(i => curMode === 'byDay' ? i.label.slice(5) : i.label.slice(5).replace(' ', ' ') + ':00');
    const counts = items.map(i => i.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = counts.length > 0 ? (total / counts.length).toFixed(1) : 0;
    const max = Math.max(...counts, 0);
    const maxLabel = counts.length > 0 ? items[counts.indexOf(max)].label : 'N/A';

    area.innerHTML = \`
      <div style="padding:24px 36px;max-width:1200px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <h2 style="font-size:18px;flex:1;margin:0">Tweet Volume</h2>
          <button onclick="loadStats('byHour')" style="\${btnStyle('byHour')}">By Hour</button>
          <button onclick="loadStats('byDay')" style="\${btnStyle('byDay')}">By Day</button>
        </div>
        <div style="display:flex;gap:24px;margin-bottom:20px">
          <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 20px;flex:1">
            <div style="color:#71767b;font-size:12px">Total</div>
            <div style="color:#1d9bf0;font-size:22px;font-weight:700">\${total}</div>
          </div>
          <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 20px;flex:1">
            <div style="color:#71767b;font-size:12px">Avg / \${curMode === 'byDay' ? 'day' : 'hour'}</div>
            <div style="color:#1d9bf0;font-size:22px;font-weight:700">\${avg}</div>
          </div>
          <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 20px;flex:1">
            <div style="color:#71767b;font-size:12px">Peak</div>
            <div style="color:#1d9bf0;font-size:22px;font-weight:700">\${max}</div>
            <div style="color:#71767b;font-size:11px">\${maxLabel}</div>
          </div>
        </div>
        <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:20px;position:relative;height:400px">
          <canvas id="statsChart"></canvas>
        </div>
      </div>
    \`;

    const ctx = document.getElementById('statsChart').getContext('2d');
    if (statsChart) statsChart.destroy();
    statsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Tweets',
          data: counts,
          backgroundColor: 'rgba(29, 155, 240, 0.6)',
          borderColor: 'rgba(29, 155, 240, 1)',
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#16202a',
            borderColor: '#2f3336',
            borderWidth: 1,
            titleColor: '#e7e9ea',
            bodyColor: '#1d9bf0',
            padding: 10,
            cornerRadius: 8,
          }
        },
        scales: {
          x: {
            ticks: { color: '#71767b', font: { size: 11 }, maxRotation: 45 },
            grid: { color: 'rgba(47,51,54,0.5)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#71767b' },
            grid: { color: 'rgba(47,51,54,0.5)' },
          }
        }
      }
    });
  }

  async function loadTweetFiles() {
    const res = await fetch('/api/tweets');
    const files = await res.json();
    const list = document.getElementById('file-list');
    if (files.length === 0) {
      list.innerHTML = '<div class="panel-title">Tweet Data Files</div><div class="file-item"><div class="meta">No data files yet</div></div>';
      return;
    }
    list.innerHTML = '<div class="panel-title">Tweet Data Files (' + files.length + ')</div>' +
      files.map(f => \`
        <div class="file-item" onclick="showTweetSummary('\${f.filename}', this)">
          <div class="name">\${f.filename}</div>
          <div class="meta">\${f.count} tweets | \${(f.size / 1024).toFixed(1)} KB | \${f.newest ? toUTC8(f.newest) : ''} ~ \${f.oldest ? toUTC8(f.oldest) : ''}</div>
        </div>
      \`).join('');
  }

  function showTweetSummary(filename, el) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = filename;
    document.getElementById('content-area').innerHTML = '<div class="md-content"><h2>' + filename + '</h2><p>File path: <code>data/tweets/' + filename + '</code></p></div>';
  }

  async function runAnalyze(hours) {
    if (hours === null) {
      hours = parseFloat(document.getElementById('custom-hours').value);
      if (!hours || hours <= 0) { showToast('Please enter valid hours', 'error'); return; }
    }
    const btns = document.querySelectorAll('.analyze-btn');
    btns.forEach(b => { b.classList.add('running'); b.disabled = true; });
    showToast('Running analysis for ' + hours + 'h ...', '');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours, model: document.getElementById('model-select').value })
      });
      const data = await res.json();
      if (data.error) {
        showToast('Analysis failed: ' + data.error, 'error');
      } else {
        showToast('Analysis complete! ' + data.tweetCount + ' tweets analyzed.', 'success');
        await loadAll();
        if (data.filename) loadAnalysis(data.filename, null);
      }
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    } finally {
      btns.forEach(b => { b.classList.remove('running'); b.disabled = false; });
    }
  }

  // Auto-collapse top bar on report scroll
  document.querySelector('.panel-content').addEventListener('scroll', function() {
    const bar = document.getElementById('top-bar');
    if (this.scrollTop > 60) bar.classList.add('collapsed');
    else bar.classList.remove('collapsed');
  });

  // Initial load
  loadAll();
</script>
</body>
</html>`;

// ========== HTTP Server ==========

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getStatus()));
    return;
  }

  if (url.pathname === "/api/tweets") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getTweetFiles()));
    return;
  }

  if (url.pathname === "/api/tweet-stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getTweetStats()));
    return;
  }

  if (url.pathname === "/api/analyses") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getAnalyses()));
    return;
  }

  if (url.pathname === "/api/analyze" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { hours, model } = JSON.parse(body);
        const { runAnalysis } = require("./analyze");
        const result = await runAnalysis(hours || 2, model);
        if (!result) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No tweets found in this time range" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            filename: path.basename(result.filepath),
            tweetCount: result.tweetCount,
          }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/discover" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    (async () => {
      try {
        const { runDiscover } = require("./discover");
        const result = await runDiscover();
        if (!result) {
          res.end(JSON.stringify({ error: "No tweets collected from For You" }));
        } else {
          // 更新 state 的 lastDiscoverTime
          try {
            const stateData = JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
            stateData.lastDiscoverTime = new Date().toISOString();
            fs.writeFileSync(config.stateFile, JSON.stringify(stateData, null, 2), "utf-8");
          } catch {}
          res.end(JSON.stringify({ filename: result.filename, tweetCount: result.tweetCount }));
        }
      } catch (err) {
        res.end(JSON.stringify({ error: err.message }));
      }
    })();
    return;
  }

  if (url.pathname === "/api/discovers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getDiscovers()));
    return;
  }

  const discoverMatch = url.pathname.match(/^\/api\/discover\/(.+)$/);
  if (discoverMatch) {
    const content = getDiscoverContent(decodeURIComponent(discoverMatch[1]));
    if (content === null) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(content);
    }
    return;
  }

  const analysisMatch = url.pathname.match(/^\/api\/analysis\/(.+)$/);
  if (analysisMatch) {
    const content = getAnalysisContent(decodeURIComponent(analysisMatch[1]));
    if (content === null) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(content);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

function startDashboard() {
  server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = { startDashboard };

// CLI 模式：直接运行
if (require.main === module) {
  startDashboard();
}
