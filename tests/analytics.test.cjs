/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader isolates server modules for fixture tests. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

// Load the application's TypeScript and @/ aliases without a Next.js server.
require.extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(compiled.outputText, filename);
};
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) name = path.resolve(__dirname, "../src", name.slice(2));
  return originalLoad.call(this, name, parent, isMain);
};
const { hasMetrics, coversPeriod, unavailable } = require("../src/lib/analytics/quality.ts");
const { mergeRange } = require("../src/lib/analytics/merge.ts");
const { getWindsorYoutubeAnalytics } = require("../src/lib/integrations/windsor/youtube.ts");
const { getWindsorTikTokAnalytics } = require("../src/lib/integrations/windsor/tiktok.ts");
const { getLiveDashboard } = require("../src/lib/analytics/live-dashboard.ts");
function channel(views, rate, previousViews = views) {
  return {
    views, engagementRate: rate, followers: 10, postsPublished: 0,
    previous: { views: previousViews, engagementRate: rate, followers: 10 },
    changes: { views: 0, engagementRate: 0, followers: 0, postsPublished: 0 },
    performanceData: [{ date: "2026-11-09", views, engagement: rate, followers: 10 }],
    topPosts: [],
  };
}
test("zero is a valid metric; missing, blank, invalid and negative values are unavailable", () => {
  assert.equal(hasMetrics({ views: 0 }, ["views"]), true);
  for (const value of [null, undefined, "", " ", "oops", -1, Infinity]) {
    assert.equal(hasMetrics({ views: value }, ["views"]), false);
  }
});
test("period includes both calendar boundaries, across a month transition", () => {
  const dates = new Set(["2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.equal(coversPeriod(dates, "2026-11-01", 3), true);
  dates.delete("2026-10-30");
  assert.equal(coversPeriod(dates, "2026-11-01", 3), false);
});
test("engagement is view weighted: 10 interactions + 60 interactions / 400 views = 17.5%", () => {
  const result = mergeRange([channel(100, 10), channel(300, 20)]);
  assert.equal(result.engagementRate, 17.5);
  assert.equal(result.performanceData[0].engagement, 17.5);
});
test("a drop to zero retains the previous denominator", () => {
  const result = mergeRange([channel(0, 0, 100), channel(100, 10, 100)]);
  assert.equal(result.changes.views, -50);
});
test("unavailable channel is omitted and all-unavailable remains explicit", () => {
  assert.equal(mergeRange([channel(100, 10), unavailable("missing")]).views, 100);
  assert.ok(mergeRange([unavailable("missing")]).unavailableReason);
});

function mockProvider({ missingDay = false, failTikTok = false, invalidBody = false } = {}) {
  process.env.WINDSOR_API_KEY = "fixture-only";
  global.fetch = async (input) => {
    const url = new URL(input);
    if (failTikTok && url.pathname.includes("tiktok")) return { ok: false, status: 503 };
    if (invalidBody) return { ok: true, json: async () => ({ data: {} }) };
    const fields = url.searchParams.get("fields").split(",");
    let rows = [];
    if (fields.includes("date") && !fields.includes("video")) {
      const endDay = Math.floor(Date.now() / 86400000) - 1;
      rows = Array.from({ length: 730 }, (_, index) => {
        const row = Object.fromEntries(fields.map((field) => [field, 0]));
        row.date = new Date((endDay - index) * 86400000).toISOString().slice(0, 10);
        return row;
      });
      if (missingDay) rows.shift();
    } else if (fields.includes("subscriber_count") || fields.includes("total_followers_count")) {
      rows = [Object.fromEntries(fields.map((field) => [field, 0]))];
    }
    return { ok: true, json: async () => ({ data: rows }) };
  };
}
test("adapters accept explicit zero daily activity and use completed UTC days", async () => {
  mockProvider();
  for (const load of [getWindsorYoutubeAnalytics, getWindsorTikTokAnalytics]) {
    const data = (await load())["7d"];
    assert.equal(data.unavailableReason, undefined);
    assert.equal(data.views, 0);
    assert.equal(data.performanceData.length, 7);
    const yesterday = new Date((Math.floor(Date.now() / 86400000) - 1) * 86400000).toISOString().slice(0, 10);
    assert.equal(data.performanceData.at(-1).date, yesterday);
  }
});
test("adapters flag missing reporting days", async () => {
  mockProvider({ missingDay: true });
  assert.ok((await getWindsorYoutubeAnalytics())["7d"].unavailableReason);
  assert.ok((await getWindsorTikTokAnalytics())["30d"].unavailableReason);
});
test("malformed provider envelope rejects the request", async () => {
  mockProvider({ invalidBody: true });
  await assert.rejects(getWindsorYoutubeAnalytics, /unexpected response/);
});
test("platform failure leaves healthy-channel overview available through normal loader", async () => {
  mockProvider({ failTikTok: true });
  const result = await getLiveDashboard();
  assert.equal(result.connected.youtube, true);
  assert.equal(result.connected.tiktok, false);
  assert.equal(result.overview["7d"].unavailableReason, undefined);
  assert.ok(result.platforms.tiktok["7d"].unavailableReason);
});
