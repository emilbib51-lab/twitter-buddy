const fs = require("fs");
const config = require("./config");
const { launchBrowser, navigateToTimeline, collectTweets, saveTweets, log } = require("./collect-timeline");
const { runDiscover } = require("./discover");

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ========== 状态管理 ==========

function loadState() {
  try {
    if (fs.existsSync(config.stateFile)) {
      return JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
    }
  } catch {}
  return {
    lastNewestTweet: null,
    lastCollectionTime: null,
    totalCollected: 0,
    gaps: [],
  };
}

function saveState(state) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2), "utf-8");
}

// ========== 单次采集 ==========

async function runCollection(state) {
  log("=== Starting collection cycle ===");

  const browser = await launchBrowser();
  const page = browser.pages()[0] || (await browser.newPage());

  try {
    await navigateToTimeline(page);

    const result = await collectTweets(page, {
      stopAtTimestamp: state.lastNewestTweet,
    });

    if (result.tweets.length === 0) {
      log("No tweets collected this cycle.");
      return state;
    }

    // 保存推文
    saveTweets(result.tweets, config.tweetsDir);

    // 缺口检测
    if (state.lastNewestTweet && !result.reachedTarget) {
      const gap = {
        from: state.lastNewestTweet,
        to: result.oldestTime,
        detectedAt: new Date().toISOString(),
      };
      state.gaps.push(gap);
      log(`⚠️  GAP DETECTED: ${gap.from} ~ ${gap.to}`);
      log(`⚠️  Some tweets between these times may be missing.`);
    }

    // 更新状态
    state.lastNewestTweet = result.newestTime;
    state.lastCollectionTime = new Date().toISOString();
    state.totalCollected += result.tweets.length;
    saveState(state);

    log(`Cycle complete: ${result.tweets.length} new tweets (total: ${state.totalCollected})`);
  } catch (err) {
    log(`Collection error: ${err.message}`);
  } finally {
    await browser.close();
  }

  return state;
}

// ========== 守护进程主循环 ==========

async function main() {
  log("========================================");
  log("  Twitter Timeline Daemon Starting");
  log("========================================");

  // 启动 Dashboard 服务
  try {
    const { startDashboard } = require("./server");
    startDashboard();
  } catch (err) {
    log(`Dashboard failed to start: ${err.message}`);
  }

  let state = loadState();
  if (state.lastNewestTweet) {
    log(`Resuming from: ${state.lastNewestTweet}`);
    log(`Total collected so far: ${state.totalCollected}`);
  } else {
    log("First run, no previous state.");
  }

  let lastAnalysisTime = state.lastAnalysisTime ? new Date(state.lastAnalysisTime).getTime() : 0;
  let lastDiscoverTime = state.lastDiscoverTime ? new Date(state.lastDiscoverTime).getTime() : 0;

  // 优雅退出
  let running = true;
  process.on("SIGINT", () => {
    log("\nShutting down gracefully...");
    saveState(state);
    log("State saved. Goodbye.");
    running = false;
    process.exit(0);
  });

  while (running) {
    // 采集
    state = await runCollection(state);

    // 检查是否需要触发分析
    if (Date.now() - lastAnalysisTime >= config.daemon.analysisIntervalMs) {
      log("=== Triggering LLM analysis ===");
      try {
        const { runAnalysis } = require("./analyze");
        await runAnalysis();
        lastAnalysisTime = Date.now();
        state.lastAnalysisTime = new Date().toISOString();
        saveState(state);
      } catch (err) {
        log(`Analysis error: ${err.message}`);
      }
    }

    // 检查是否需要触发账号发现
    if (Date.now() - lastDiscoverTime >= config.discover.intervalMs) {
      log("=== Triggering account discovery ===");
      try {
        await runDiscover();
        lastDiscoverTime = Date.now();
        state.lastDiscoverTime = new Date().toISOString();
        saveState(state);
      } catch (err) {
        log(`Discover error: ${err.message}`);
      }
    }

    // 随机等待
    const waitMs = rand(config.daemon.intervalMin, config.daemon.intervalMax);
    const waitMin = (waitMs / 60000).toFixed(1);
    log(`Next collection in ${waitMin} minutes ...`);
    log("----------------------------------------");

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

main();
