/**
 * 诊断脚本：测试关注状态检测
 * 用法:
 *   node debug-follow.js              -- 测试悬停 + 主页两种方式
 *   node debug-follow.js --hover      -- 只测试悬停方式（需要先在 For You 时间线上）
 *   node debug-follow.js --profile    -- 只测试主页方式
 */
const { launchBrowser, log } = require("./collect-timeline");

// ====== 方法1: 悬停头像检测 ======

async function testHoverOnTimeline(page) {
  log("\n=== Testing hover-card approach on For You timeline ===");

  // 先导航到 For You
  log("Navigating to x.com/home ...");
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 点击 For You tab
  try {
    const forYouTab = page.locator(
      '[role="tab"]:has-text("For you"), [role="tab"]:has-text("为你推荐")'
    );
    if ((await forYouTab.count()) > 0) {
      await forYouTab.first().click();
      log("Clicked For You tab");
      await page.waitForTimeout(2000);
    }
  } catch {}

  // 找到前 6 个可见推文的头像并悬停
  const avatars = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    document.querySelectorAll('[data-testid="tweet"]').forEach(tweet => {
      const imgs = tweet.querySelectorAll('img[src*="profile_images"]');
      for (const img of imgs) {
        const link = img.closest('a[href]');
        if (!link) continue;
        const href = link.getAttribute('href');
        if (!href || href === '/') continue;
        const handle = href.replace(/^\//, '').split('/')[0];
        if (seen.has(handle.toLowerCase())) continue;
        seen.add(handle.toLowerCase());
        const rect = img.getBoundingClientRect();
        if (rect.top > 50 && rect.bottom < window.innerHeight - 50 && rect.width > 0) {
          results.push({
            handle,
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
          });
        }
      }
    });
    return results.slice(0, 6);
  });

  log(`Found ${avatars.length} visible avatars to test`);

  for (const avatar of avatars) {
    log(`\nHovering @${avatar.handle} at (${avatar.x}, ${avatar.y}) ...`);

    await page.mouse.move(avatar.x, avatar.y);

    let hoverCardAppeared = false;
    try {
      await page.waitForSelector('[data-testid="HoverCard"]', { timeout: 2500 });
      hoverCardAppeared = true;
      await page.waitForTimeout(300);

      const debug = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="HoverCard"]');
        if (!card) return { cardFound: false };

        const info = { cardFound: true };

        // data-testid
        const unfollow = card.querySelector('[data-testid$="-unfollow"]');
        const follow = card.querySelector('[data-testid$="-follow"]');
        info.unfollowTestId = unfollow ? unfollow.getAttribute('data-testid') : null;
        info.followTestId = follow ? follow.getAttribute('data-testid') : null;

        // aria-label
        const labels = [];
        card.querySelectorAll('[aria-label]').forEach(el => {
          const label = el.getAttribute('aria-label');
          if (/follow|关注|unfollow|取消/i.test(label)) labels.push(label);
        });
        info.followAriaLabels = labels;

        // 按钮文本
        const btns = [];
        card.querySelectorAll('[role="button"]').forEach(btn => {
          const text = btn.textContent.trim();
          if (/^Follow$|^Following$|^关注$|^正在关注$/i.test(text)) btns.push(text);
        });
        info.followButtons = btns;

        // 判定
        if (unfollow) info.isFollowed = true;
        else if (follow) info.isFollowed = false;
        else if (labels.some(l => /Following|正在关注|Unfollow|取消关注/i.test(l))) info.isFollowed = true;
        else if (labels.some(l => /^Follow |^关注 /i.test(l))) info.isFollowed = false;
        else if (btns.includes("Following") || btns.includes("正在关注")) info.isFollowed = true;
        else if (btns.includes("Follow") || btns.includes("关注")) info.isFollowed = false;
        else info.isFollowed = null;

        return info;
      });

      const status = debug.isFollowed === true ? "✅ FOLLOWED" :
                     debug.isFollowed === false ? "❌ NOT FOLLOWED" : "❓ UNKNOWN";
      console.log(`  @${avatar.handle}: ${status}`);
      console.log(`  Debug:`, JSON.stringify(debug, null, 2));
    } catch {
      console.log(`  @${avatar.handle}: HoverCard did not appear`);
    }

    // 移走鼠标关闭卡片
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
  }
}

// ====== 方法2: 主页检测 ======

async function testProfileCheck(page, handle) {
  try {
    await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded", timeout: 15000 });

    let waitMethod = "waitForSelector";
    try {
      await page.waitForSelector(
        '[data-testid$="-follow"], [data-testid$="-unfollow"]',
        { timeout: 8000 }
      );
    } catch {
      waitMethod = "fallback-timeout";
      await page.waitForTimeout(2000);
    }

    const result = await page.evaluate(() => {
      const debug = {};
      const unfollowTestId = document.querySelector('[data-testid$="-unfollow"]');
      const followTestId = document.querySelector('[data-testid$="-follow"]');
      debug.unfollowTestId = unfollowTestId ? unfollowTestId.getAttribute('data-testid') : null;
      debug.followTestId = followTestId ? followTestId.getAttribute('data-testid') : null;

      const allAriaLabels = [];
      document.querySelectorAll('[aria-label]').forEach(el => {
        const label = el.getAttribute('aria-label');
        if (/follow|关注|unfollow|取消/i.test(label)) allAriaLabels.push(label);
      });
      debug.followAriaLabels = allAriaLabels;

      const followButtons = [];
      document.querySelectorAll('[role="button"], button').forEach(btn => {
        const text = btn.textContent.trim();
        if (/^Follow$|^Following$|^关注$|^正在关注$|^Unfollow$/i.test(text)) followButtons.push(text);
      });
      debug.followButtons = followButtons;
      debug.pageTitle = document.title;

      if (unfollowTestId) debug.isFollowed = true;
      else if (followTestId) debug.isFollowed = false;
      else if (allAriaLabels.some(l => /Following|正在关注|Unfollow|取消关注/i.test(l))) debug.isFollowed = true;
      else if (allAriaLabels.some(l => /^Follow |^关注 /i.test(l))) debug.isFollowed = false;
      else if (followButtons.includes("Following") || followButtons.includes("正在关注")) debug.isFollowed = true;
      else if (followButtons.includes("Follow") || followButtons.includes("关注")) debug.isFollowed = false;
      else debug.isFollowed = null;

      return debug;
    });

    result.waitMethod = waitMethod;
    return result;
  } catch (err) {
    return { error: err.message, isFollowed: null };
  }
}

// ====== Main ======

(async () => {
  const args = process.argv.slice(2);
  const hoverOnly = args.includes("--hover");
  const profileOnly = args.includes("--profile");

  const testUsers = ["Cato_KT", "DD29397053", "elikiiba", "Dominos_UK"];

  log("Launching browser ...");
  const browser = await launchBrowser();
  const page = browser.pages()[0] || (await browser.newPage());

  try {
    // 测试悬停方式
    if (!profileOnly) {
      await testHoverOnTimeline(page);
    }

    // 测试主页方式
    if (!hoverOnly) {
      log("\n=== Testing profile-page approach ===");
      for (const handle of testUsers) {
        log(`\nChecking @${handle} via profile ...`);
        const result = await testProfileCheck(page, handle);
        const status = result.isFollowed === true ? "✅ FOLLOWED" :
                       result.isFollowed === false ? "❌ NOT FOLLOWED" : "❓ UNKNOWN";
        console.log(`  @${handle}: ${status}`);
        console.log(`  Debug:`, JSON.stringify(result, null, 2));
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
})();
