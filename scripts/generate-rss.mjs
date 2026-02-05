import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HOME_URL = "https://m.huxiu.com/";

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const FETCH_RETRY_MAX = envNumber("FETCH_RETRY_MAX", 3);
const FETCH_RETRY_BASE_DELAY_MS = envNumber("FETCH_RETRY_BASE_DELAY_MS", 500);
const FETCH_RETRY_MAX_DELAY_MS = envNumber("FETCH_RETRY_MAX_DELAY_MS", 8000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

function backoffDelayMs(attempt) {
  const exp = FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = exp * (0.5 + Math.random());
  return clamp(Math.floor(jitter), 0, FETCH_RETRY_MAX_DELAY_MS);
}

async function withRetry(fn, { maxAttempts, label }) {
  const attempts = Math.max(1, maxAttempts ?? 1);
  const opLabel = label ?? "operation";
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      const delay = backoffDelayMs(attempt);
      const msg = err?.stack || err?.message || String(err);
      console.warn(`${opLabel} failed (attempt ${attempt}/${attempts}), retry in ${delay}ms: ${msg}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) {
    throw new Error(`拉取失败: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

async function fetchHtmlWithRetry(url) {
  return await withRetry(() => fetchHtml(url), { maxAttempts: FETCH_RETRY_MAX, label: `fetch ${url}` });
}

function extractNuxtExpression(html) {
  const re =
    /window\.__NUXT__\s*=\s*(\(\s*function\s*\([\s\S]*?\)\s*\{[\s\S]*?\}\s*\([\s\S]*?\)\s*\))\s*;?/;
  const match = re.exec(html);
  if (!match) throw new Error("未找到 window.__NUXT__ 赋值的内联脚本片段");
  return match[1];
}

function evalNuxtExpression(iifeExpr) {
  const sandbox = {
    window: {},
    globalThis: undefined,
    document: undefined,
    navigator: undefined,
    location: undefined,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(`window.__NUXT__ = ${iifeExpr};`, ctx, { timeout: 1000 });
  const nuxt = sandbox.window.__NUXT__;
  if (!nuxt) throw new Error("执行后未得到 window.__NUXT__");
  return nuxt;
}

function escapeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildRssFromHotArticles(hotArticlesList, opts = {}) {
  const now = new Date().toUTCString();
  const title = opts.title ?? "虎嗅 - 热门文章";
  const link = opts.link ?? HOME_URL;
  const description = opts.description ?? "来自 m.huxiu.com 首页的 hotArticlesList";

  const items = hotArticlesList
    .map((a) => {
      const itemTitle = escapeXml(a?.title ?? "");
      const itemLink = escapeXml(a?.url ?? "");
      const guidRaw = itemLink || String(a?.aid ?? "");
      const guid = escapeXml(guidRaw);

      const userInfo = a?.user_info;
      const author = escapeXml(userInfo?.username ?? "");

      const picPath = a?.pic_path;
      const enclosure = picPath ? `\n      <enclosure url="${escapeXml(picPath)}" type="image/jpeg" />` : "";

      const isOriginal = a?.is_original;
      const isVideo = a?.is_video_article;
      const descParts = [];
      if (isOriginal) descParts.push("原创");
      if (isVideo) descParts.push("视频");
      if (author) descParts.push(`作者：${author}`);
      const descText = descParts.join(" | ");

      const authorTag = author ? `<author>${author}</author>` : "<author />";

      return [
        "    <item>",
        `      <title>${itemTitle}</title>`,
        `      <link>${itemLink}</link>`,
        `      <guid isPermaLink="${itemLink ? "true" : "false"}">${guid}</guid>`,
        `      ${authorTag}`,
        `      <description><![CDATA[${descText}]]></description>${enclosure}`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <lastBuildDate>${now}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

async function generateRss() {
  const html = await fetchHtmlWithRetry(HOME_URL);
  const iifeExpr = extractNuxtExpression(html);
  const nuxtData = evalNuxtExpression(iifeExpr);
  const data = nuxtData?.data;
  const first = Array.isArray(data) ? data[0] : undefined;
  const hotArticlesList = first?.hotArticlesList;
  if (!Array.isArray(hotArticlesList)) {
    throw new Error("未找到 data[0].hotArticlesList，页面结构可能变更");
  }
  return buildRssFromHotArticles(hotArticlesList, {
    title: "虎嗅 - 热门文章(hotArticlesList)",
    link: HOME_URL,
    description: "从虎嗅移动端首页 __NUXT__ 中提取的热门文章列表",
  });
}

async function main() {
  const outPathArg = process.argv.find((v) => v.startsWith("--out="))?.slice("--out=".length);
  const outPath = outPathArg || "rss.xml";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");
  const absOut = path.resolve(repoRoot, outPath);

  const rss = await generateRss();
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await fs.writeFile(absOut, rss, "utf-8");
  console.log(`Wrote ${outPath} (${Buffer.byteLength(rss, "utf-8")} bytes)`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
