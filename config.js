const path = require("path");

module.exports = {
  // Chrome 配置
  chromeDataDir: path.join(__dirname, ".chrome-profile"),

  // 采集配置
  scroll: {
    burstMin: 3,
    burstMax: 10,
    burstDelayMin: 200,
    burstDelayMax: 500,
    pauseMin: 3000,
    pauseMax: 9000,
    scrollPixels: 700,
    maxScrolls: 200,
    staleLimit: 10,
  },

  // 守护进程配置
  daemon: {
    intervalMin: 5 * 60 * 1000,   // 最短间隔 5 分钟
    intervalMax: 60 * 60 * 1000,  // 最长间隔 60 分钟
    analysisIntervalMs: 2 * 60 * 60 * 1000, // 每 2 小时触发一次分析
  },

  // LLM 分析配置
  analysis: {
    model: "claude-opus-4-6",
    maxTokens: 4096,
    analysisHours: 2, // 分析最近几小时的推文
    prompt: `你是一个推特时间线分析助手。以下是最近一段时间采集到的推文数据（JSON 格式）。

请用中文分析：
1. **主要话题和趋势**：当前讨论的热点是什么
2. **值得重点关注的推文**：突发新闻、alpha 信息、深度见解、重要公告。每条都要给出推文摘要和原文链接（用 Markdown 格式 [摘要](链接)），方便直接点击查看
3. **整体情绪倾向**：乐观/悲观/中性，以及原因
4. **值得跟进的讨论**：有哪些对话串或话题值得深入关注，附上相关推文链接
5. **值得关注的人物**：提到任何推特用户时，都用 Markdown 链接格式 [@用户名](https://x.com/用户名)，方便直接点击查看主页

关注重点：加密货币、AI/科技、宏观经济、地缘政治`,
  },

  // 账号发现配置
  discover: {
    maxScrolls: 100,
    intervalMs: 6 * 60 * 60 * 1000, // daemon 中每 6 小时跑一次
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    prompt: `你是一个推特账号发现助手。以下是从"为你推荐"(For You) 时间线采集到的推文数据（JSON 格式）。

请用中文分析并推荐值得关注的账号：

1. **值得关注的账号**：找出推文中出现的、内容质量高的账号。每个账号请给出：
   - 账号名和链接（用 Markdown 格式 [@用户名](https://x.com/用户名)）
   - 该账号发了什么内容（附推文链接）
   - 为什么值得关注（内容质量、专业领域、影响力等）
   - 推荐指数（⭐ 1-5 星）

2. **优质内容精选**：挑出最有价值的 5-10 条推文，给出摘要和原文链接（用 Markdown 格式 [摘要](链接)）

3. **新发现的话题/领域**：有没有你之前没接触过的有趣话题或圈子

4. **不推荐关注的类型**：哪些账号看起来是营销号、机器人、或者低质量内容

关注重点：加密货币、AI/科技、宏观经济、地缘政治、深度思考、原创内容`,
  },

  // Dashboard 配置
  dashboard: { port: 3456 },

  // 数据目录
  dataDir: path.join(__dirname, "data"),
  tweetsDir: path.join(__dirname, "data", "tweets"),
  analysisDir: path.join(__dirname, "data", "analysis"),
  discoverDir: path.join(__dirname, "data", "discover"),
  stateFile: path.join(__dirname, "data", "state.json"),
};
