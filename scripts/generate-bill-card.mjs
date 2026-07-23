import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const GH_USERNAME = process.env.GH_USERNAME || "samir0607";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const LEETCODE_USER = process.env.LEETCODE_USER || "";
const CODEFORCES_HANDLE = process.env.CODEFORCES_HANDLE || "";
const CODECHEF_HANDLE = process.env.CODECHEF_HANDLE || "";
const NAME = process.env.BILL_NAME || "Samir Gupta";
const AGE = process.env.BILL_AGE || "22";
const HEIGHT = process.env.BILL_HEIGHT || "5'10\"";
const WEIGHT = process.env.BILL_WEIGHT || "78 kg";
const OUTPUT_PATH = process.env.OUTPUT_PATH || "assets/bill-card.svg";

const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": GH_USERNAME,
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function listOwnRepos(username) {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await fetchJson(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner`,
      { headers: ghHeaders }
    );
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos.filter((repo) => !repo.fork);
}

async function repoLinesChanged(owner, repoName, username) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/stats/contributors`,
      { headers: ghHeaders }
    );
    if (res.status === 202) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`stats/contributors for ${repoName} -> ${res.status}`);
    }
    const stats = await res.json();
    if (!Array.isArray(stats)) return { additions: 0, deletions: 0 };
    const mine = stats.find((entry) => entry.author?.login === username);
    if (!mine) return { additions: 0, deletions: 0 };
    return mine.weeks.reduce(
      (acc, week) => ({
        additions: acc.additions + week.a,
        deletions: acc.deletions + week.d,
      }),
      { additions: 0, deletions: 0 }
    );
  }
  throw new Error(`stats/contributors for ${repoName} never finished computing`);
}

async function fetchGithubLinesChanged() {
  try {
    const repos = await listOwnRepos(GH_USERNAME);
    let additions = 0;
    let deletions = 0;
    let failures = 0;
    for (const repo of repos) {
      try {
        const result = await repoLinesChanged(GH_USERNAME, repo.name, GH_USERNAME);
        additions += result.additions;
        deletions += result.deletions;
      } catch (err) {
        failures += 1;
        console.error(`Skipping ${repo.name}:`, err.message);
      }
    }
    if (repos.length > 0 && failures === repos.length) return null;
    return { additions, deletions };
  } catch (err) {
    console.error("GitHub lines-changed fetch failed:", err.message);
    return null;
  }
}

async function fetchCodeforcesMaxRating() {
  if (!CODEFORCES_HANDLE) return null;
  try {
    const data = await fetchJson(
      `https://codeforces.com/api/user.info?handles=${CODEFORCES_HANDLE}`
    );
    return data.result?.[0]?.maxRating ?? null;
  } catch (err) {
    console.error("Codeforces fetch failed:", err.message);
    return null;
  }
}

async function fetchLeetcodeMaxRating() {
  if (!LEETCODE_USER) return null;
  try {
    const query = `
      query userContestRankingHistory($username: String!) {
        userContestRankingHistory(username: $username) {
          attended
          rating
        }
      }
    `;
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { username: LEETCODE_USER } }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    const history = json.data?.userContestRankingHistory ?? [];
    const attendedRatings = history
      .filter((entry) => entry.attended)
      .map((entry) => entry.rating);
    if (!attendedRatings.length) return null;
    return Math.round(Math.max(...attendedRatings));
  } catch (err) {
    console.error("LeetCode fetch failed:", err.message);
    return null;
  }
}

async function fetchCodechefMaxRating() {
  if (!CODECHEF_HANDLE) return null;
  try {
    const res = await fetch(`https://www.codechef.com/users/${CODECHEF_HANDLE}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const html = await res.text();
    const anchor = html.indexOf("CodeChef Rating</strong>");
    if (anchor === -1) throw new Error("rating widget not found on profile page");
    const window = html.slice(anchor, anchor + 200);
    const match = window.match(/Highest Rating (\d+)/);
    if (!match) throw new Error("highest rating not found near widget");
    return Number(match[1]);
  } catch (err) {
    console.error("CodeChef fetch failed:", err.message);
    return null;
  }
}

function formatValue(value, suffix = "") {
  if (value === null || value === undefined) return "N/A";
  return `${value.toLocaleString("en-US")}${suffix}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function zigzag(y, width, tooth = 10, direction = 1) {
  const teeth = Math.ceil(width / tooth);
  let d = `M0,${y}`;
  for (let i = 0; i < teeth; i += 1) {
    const x = Math.min((i + 1) * tooth, width);
    const peak = y + direction * (i % 2 === 0 ? 6 : 0);
    d += ` L${x},${peak}`;
  }
  return d;
}

function buildSvg(rows) {
  const width = 400;
  const paddingX = 28;
  const rowHeight = 30;
  const headerHeight = 108;
  const footerHeight = 96;
  const dividerGap = 14;

  let y = headerHeight;
  const lineItems = [];
  for (const row of rows) {
    if (row.type === "divider") {
      lineItems.push({ ...row, y });
      y += dividerGap;
    } else if (row.type === "diff") {
      lineItems.push({ ...row, y: y + 18 });
      y += rowHeight + 20;
    } else {
      lineItems.push({ ...row, y });
      y += rowHeight;
    }
  }
  const bodyBottom = y + 4;
  const height = bodyBottom + footerHeight;

  const bg = "#1a1b27";
  const paper = "#1f2335";
  const border = "#3b4261";
  const text = "#c0caf5";
  const muted = "#565f89";
  const green = "#9ece6a";
  const red = "#f7768e";
  const blue = "#7aa2f7";

  const rowSvg = lineItems
    .map((row) => {
      if (row.type === "divider") {
        return `<line x1="${paddingX}" y1="${row.y}" x2="${width - paddingX}" y2="${row.y}" stroke="${border}" stroke-width="1" stroke-dasharray="4 4" />`;
      }
      if (row.type === "section") {
        return `<text x="${paddingX}" y="${row.y}" font-family="'JetBrains Mono','Courier New',monospace" font-size="16" letter-spacing="2" fill="${muted}">${escapeXml(row.label)}</text>`;
      }
      if (row.type === "diff") {
        return `
        <text x="${paddingX}" y="${row.y - 18}" font-family="'JetBrains Mono','Courier New',monospace" font-size="18" fill="${text}">${escapeXml(row.label)}</text>
        <text x="${width - paddingX}" y="${row.y}" font-family="'JetBrains Mono','Courier New',monospace" font-size="18" font-weight="700" text-anchor="end"><tspan fill="${green}">${escapeXml(row.plus)}</tspan><tspan fill="${red}" dx="10">${escapeXml(row.minus)}</tspan></text>
      `;
      }
      const valueColor = row.color || text;
      return `
        <text x="${paddingX}" y="${row.y}" font-family="'JetBrains Mono','Courier New',monospace" font-size="18" fill="${text}">${escapeXml(row.label)}</text>
        <text x="${width - paddingX}" y="${row.y}" font-family="'JetBrains Mono','Courier New',monospace" font-size="18" font-weight="700" fill="${valueColor}" text-anchor="end">${escapeXml(row.value)}</text>
      `;
    })
    .join("\n");

  const updatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="zz-top">
      <path d="${zigzag(0, width, 10, -1)} L${width},14 L0,14 Z" />
    </clipPath>
    <clipPath id="zz-bottom">
      <path d="${zigzag(height, width, 10, 1)} L${width},${height - 14} L0,${height - 14} Z" />
    </clipPath>
  </defs>

  <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}" />
  <g clip-path="url(#zz-top)"><rect x="0" y="0" width="${width}" height="16" fill="${paper}" /></g>
  <g clip-path="url(#zz-bottom)"><rect x="0" y="${height - 16}" width="${width}" height="16" fill="${paper}" /></g>
  <rect x="0" y="14" width="${width}" height="${height - 28}" fill="${paper}" />

  <text x="${width / 2}" y="44" text-anchor="middle" font-family="'JetBrains Mono','Courier New',monospace" font-size="21" font-weight="700" letter-spacing="3" fill="${blue}">DEV RECEIPT</text>
  <text x="${width / 2}" y="64" text-anchor="middle" font-family="'JetBrains Mono','Courier New',monospace" font-size="13" letter-spacing="2" fill="${muted}">github.com/${GH_USERNAME}</text>
  <line x1="${paddingX}" y1="80" x2="${width - paddingX}" y2="80" stroke="${border}" stroke-width="1" stroke-dasharray="4 4" />

  ${rowSvg}

  <text x="${width / 2}" y="${height - 22}" text-anchor="middle" font-family="'JetBrains Mono','Courier New',monospace" font-size="11" fill="${muted}">updated ${updatedAt}</text>
</svg>`;
}

async function main() {
  const [linesChanged, cfMax, lcMax, ccMax] = await Promise.all([
    fetchGithubLinesChanged(),
    fetchCodeforcesMaxRating(),
    fetchLeetcodeMaxRating(),
    fetchCodechefMaxRating(),
  ]);

  const rows = [
    { type: "section", label: "BIO" },
    { type: "item", label: "NAME", value: NAME },
    { type: "item", label: "AGE", value: `${AGE} yrs` },
    { type: "item", label: "HEIGHT", value: HEIGHT },
    { type: "item", label: "WEIGHT", value: WEIGHT },
    { type: "divider" },
    { type: "section", label: "STATS" },
    linesChanged
      ? {
          type: "diff",
          label: "GITHUB LOC CHANGED",
          plus: `+${linesChanged.additions.toLocaleString("en-US")}`,
          minus: `-${linesChanged.deletions.toLocaleString("en-US")}`,
        }
      : { type: "item", label: "GITHUB LOC CHANGED", value: "N/A" },
    { type: "item", label: "LEETCODE (PEAK)", value: formatValue(lcMax), color: "#e0af68" },
    { type: "item", label: "CODEFORCES (PEAK)", value: formatValue(cfMax), color: "#7aa2f7" },
    { type: "item", label: "CODECHEF (PEAK)", value: formatValue(ccMax), color: "#bb9af7" },
    { type: "divider" },
  ];

  const svg = buildSvg(rows);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
