/**
 * Real JavaScript test harness for the deployed Apps Script sources.
 *
 * The Python suite in run_tests.py mirrors these functions by hand, so a bug
 * that only exists in the shipped .gs file would go unnoticed. This harness
 * instead extracts the actual top-level declarations from gcalweather.gs and
 * icalweather.gs, evaluates them with stubbed Apps Script globals, and asserts
 * on the result. That is the only way to be sure the code that ships is the
 * code that was tested.
 *
 * Dependency free on purpose so it runs on both runtimes:
 *   bun  tests/js_harness.js     (local)
 *   node tests/js_harness.js     (CI)
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
/** Reads a source file with CRLF normalised to LF so the extractors below,
 *  which anchor on "\n}", ";\n" and "\n};", behave identically on Windows
 *  checkouts and CI's Linux checkout. */
function read(file) {
  return fs.readFileSync(path.join(REPO, file), "utf8").replace(/\r\n/g, "\n");
}
const GCAL = read("gcalweather.gs");
const ICAL = read("icalweather.gs");

/** Extracts a top-level `function NAME(...) { ... }` declaration. */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const end = src.indexOf("\n}", start);
  if (end === -1) throw new Error(`unterminated function ${name}`);
  return src.slice(start, end + 2);
}

/** Extracts a top-level `const NAME = { ... };` block. */
function extractConstObject(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`const ${name} not found`);
  const end = src.indexOf("\n};", start);
  if (end === -1) throw new Error(`unterminated const ${name}`);
  return src.slice(start, end + 3);
}

/** Extracts a top-level `const NAME = <expression>;` line. */
function extractConstExpression(src, name) {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`const ${name} not found`);
  const end = src.indexOf(";\n", start);
  if (end === -1) throw new Error(`unterminated const ${name}`);
  return src.slice(start, end + 1);
}

/**
 * Builds a sandboxed module from extracted declarations.
 *
 * `stubs` are globals the extracted code expects to exist (Logger, CB, ...).
 * They are passed in as function parameters, so they must NOT also be declared
 * inside `decls` or the generated function hits a duplicate declaration.
 * `wanted` names are read back out of the module scope once it has run.
 */
function load(decls, stubs, wanted) {
  const stubNames = Object.keys(stubs);
  const factory = new Function(
    ...stubNames,
    `${decls}\nreturn { ${wanted.join(", ")} };`
  );
  return factory(...stubNames.map((n) => stubs[n]));
}

/* ------------------------------------------------------------------ */
/* Minimal test runner                                                 */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || "values differ"}: got ${a}, want ${b}`);
}

function ok(value, msg) {
  if (!value) throw new Error(msg || `expected truthy, got ${JSON.stringify(value)}`);
}

function run(name, fn) {
  console.log(name);
  fn();
}

/* ------------------------------------------------------------------ */
/* NewsAPI: headline validation                                        */
/* ------------------------------------------------------------------ */

const validateDecls = [extractFunction(GCAL, "validateHeadlines")].join("\n\n");
const icalValidate = [extractFunction(ICAL, "validateHeadlines")].join("\n\n");
const validateHeadlines = load(validateDecls, {}, ["validateHeadlines"]).validateHeadlines;
const icalValidateHeadlines = load(icalValidate, {}, ["validateHeadlines"]).validateHeadlines;

run("validateHeadlines (gcal)", () => {
  test("keeps a well-formed block", () => {
    eq(validateHeadlines("• Reuters: Markets rally"), "• Reuters: Markets rally");
  });
  test("normalises padding and blank lines", () => {
    eq(validateHeadlines("  • Reuters: Rate cut  \n\n"), "• Reuters: Rate cut");
  });
  test("allows colons inside a title", () => {
    eq(validateHeadlines("• BBC: Officials: talks resume"), "• BBC: Officials: talks resume");
  });
  test("rejects empty, blank and non-strings", () => {
    eq(validateHeadlines(""), null, "empty");
    eq(validateHeadlines("   \n  "), null, "whitespace");
    eq(validateHeadlines(null), null, "null");
    eq(validateHeadlines(123), null, "number");
    eq(validateHeadlines(undefined), null, "undefined");
  });
  test("rejects unattributable and placeholder content", () => {
    eq(validateHeadlines("No breaking news today"), null, "placeholder");
    eq(validateHeadlines("Error: rate limited"), null, "error");
    eq(validateHeadlines("• Reuters"), null, "no title");
    eq(validateHeadlines("• : title"), null, "no source");
    eq(validateHeadlines("• Reuters: Rate cut\n• AP"), null, "one bad line rejects the block");
    eq(validateHeadlines("• Reuters: undefined"), null, "undefined token");
    eq(validateHeadlines("• Reuters: null"), null, "null token");
    eq(validateHeadlines("• Reuters: NaN"), null, "NaN token");
  });
  test("ICAL copy behaves identically", () => {
    eq(icalValidateHeadlines("• AP: Storm lands"), "• AP: Storm lands");
    eq(icalValidateHeadlines("nope"), null, "unattributable");
  });
});

/* ------------------------------------------------------------------ */
/* NewsAPI: URL routing                                                */
/* ------------------------------------------------------------------ */

const routerDecls = [
  extractConstExpression(GCAL, "NEWS_API_URL"),
  extractConstExpression(GCAL, "NEWS_TOP_HEADLINES_URL"),
  extractConstExpression(GCAL, "NEWS_MAJOR_DOMAINS"),
  extractFunction(GCAL, "buildBreakingNewsUrls"),
].join("\n\n");
const router = load(routerDecls, {}, [
  "buildBreakingNewsUrls", "NEWS_API_URL", "NEWS_TOP_HEADLINES_URL", "NEWS_MAJOR_DOMAINS",
]);

run("buildBreakingNewsUrls (gcal)", () => {
  const { buildBreakingNewsUrls, NEWS_TOP_HEADLINES_URL, NEWS_API_URL } = router;

  test("today builds top-headlines plus a date-scoped fallback", () => {
    const urls = buildBreakingNewsUrls("2026-09-27", "2026-09-27", "secret key/1");
    eq(urls.length, 2, "endpoint count");
    ok(urls[0].startsWith(NEWS_TOP_HEADLINES_URL), "first must be top-headlines");
    ok(urls[0].indexOf("domains=") === -1, "top-headlines must not filter by domain");
    ok(urls[0].indexOf("from=") === -1, "top-headlines must not filter by date");
    ok(urls[0].indexOf("secret%20key%2F1") !== -1, "key must be URL encoded");
    ok(urls[1].startsWith(NEWS_API_URL), "fallback must be /everything");
    ok(urls[1].indexOf("from=2026-09-27&to=2026-09-27") !== -1, "fallback must pin from/to");
  });

  test("past and future days build nothing at all", () => {
    eq(buildBreakingNewsUrls("2026-09-26", "2026-09-27", "secret key/1"), [], "past day");
    eq(buildBreakingNewsUrls("2026-09-28", "2026-09-27", "secret key/1"), [], "future day");
    eq(buildBreakingNewsUrls("", "2026-09-27", "secret key/1"), [], "blank date");
    eq(buildBreakingNewsUrls("garbage", "2026-09-27", "secret key/1"), [], "malformed date");
  });
});

/* ------------------------------------------------------------------ */
/* NewsAPI: fetchBreakingNews never calls the network off-today         */
/* ------------------------------------------------------------------ */

function loadFetch(src, cacheName, orderName, todayKey) {
  const calls = [];
  const logs = [];
  const props = { NEWS_API_KEY: "0123456789abcdef" };
  const circuit = { allowed: true, failures: 0, successes: 0 };

  const decls = [
    `let ${cacheName} = {};`,
    `let ${orderName} = [];`,
    `const _BREAKING_NEWS_CACHE_MAX = 50;`,
    `const FETCH_TIMEOUT_MS = 20000;`,
    extractConstExpression(src, "NEWS_API_URL"),
    extractConstExpression(src, "NEWS_TOP_HEADLINES_URL"),
    extractConstExpression(src, "NEWS_MAJOR_DOMAINS"),
    extractFunction(src, "redactSecretsForLog"),
    extractFunction(src, "validateHeadlines"),
    extractFunction(src, "buildBreakingNewsUrls"),
    extractFunction(src, "fetchBreakingNews"),
  ].join("\n\n");

  const Logger = { log: (m) => logs.push(String(m)) };
  const CB = {
    isCallAllowed: () => circuit.allowed,
    recordFailure: () => { circuit.failures += 1; },
    recordSuccess: () => { circuit.successes += 1; },
  };
  const _scriptProps = { getProperty: (k) => (k in props ? props[k] : null) };
  const Utilities = { formatDate: () => todayKey };
  const UrlFetchApp = {
    fetch(url) {
      calls.push(url);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          status: "ok",
          articles: [
            { title: "Rate cut announced", source: { name: "Reuters" } },
            { title: "Storm makes landfall", source: { name: "AP" } },
          ],
        }),
      };
    },
  };

  const mod = load(decls, { Logger, CB, _scriptProps, Utilities, UrlFetchApp }, [
    "fetchBreakingNews", "buildBreakingNewsUrls", "validateHeadlines", "redactSecretsForLog",
  ]);

  return { fetchBreakingNews: mod.fetchBreakingNews, calls, logs, props, circuit, Logger };
}

run("fetchBreakingNews (gcal) - current day only", () => {
  test("today fetches and returns validated headlines", () => {
    const f = loadFetch(GCAL, "_breakingNewsCacheGcal", "_breakingNewsCacheOrderGcal", "2026-09-27");
    const out = f.fetchBreakingNews("2026-09-27", "America/New_York");
    eq(f.calls.length, 1, "top-headlines satisfies today, so no fallback call");
    ok(f.calls[0].indexOf("apiKey=0123456789abcdef") !== -1, "request must carry the key");
    eq(out, "• Reuters: Rate cut announced\n• AP: Storm makes landfall");
  });

  test("a past day makes zero network calls", () => {
    const f = loadFetch(GCAL, "_breakingNewsCacheGcal", "_breakingNewsCacheOrderGcal", "2026-09-27");
    eq(f.fetchBreakingNews("2026-09-26", "America/New_York"), null, "past day returns null");
    eq(f.calls.length, 0, "past day must not touch the network");
    ok(f.logs.some(m => m.indexOf("not the current day") !== -1), "must log the skip");
  });

  test("a future day makes zero network calls", () => {
    const f = loadFetch(GCAL, "_breakingNewsCacheGcal", "_breakingNewsCacheOrderGcal", "2026-09-27");
    eq(f.fetchBreakingNews("2026-09-28", "America/New_York"), null, "future day returns null");
    eq(f.calls.length, 0, "future day must not touch the network");
  });

  test("a malformed date makes zero network calls", () => {
    const f = loadFetch(GCAL, "_breakingNewsCacheGcal", "_breakingNewsCacheOrderGcal", "2026-09-27");
    eq(f.fetchBreakingNews("27-09-2026", "America/New_York"), null, "malformed date");
    eq(f.fetchBreakingNews("", "America/New_York"), null, "empty date");
    eq(f.fetchBreakingNews(undefined, "America/New_York"), null, "undefined date");
    eq(f.calls.length, 0, "malformed input must not touch the network");
  });

  test("a skipped day is not written to the in-memory cache", () => {
    const f = loadFetch(GCAL, "_breakingNewsCacheGcal", "_breakingNewsCacheOrderGcal", "2026-09-27");
    f.fetchBreakingNews("2026-09-26", "America/New_York");
    f.fetchBreakingNews("2026-09-26", "America/New_York");
    eq(f.calls.length, 0, "still no network traffic");
  });

  test("a missing API key is refused before any request", () => {
    const f = loadFetch(GCAL, "_breakingNewsCacheGcal", "_breakingNewsCacheOrderGcal", "2026-09-27");
    f.props.NEWS_API_KEY = null;
    eq(f.fetchBreakingNews("2026-09-27", "America/New_York"), null, "no key, no headlines");
    eq(f.calls.length, 0, "must not send a keyless request");
  });
});

run("fetchBreakingNews (ical) - current day only", () => {
  test("today fetches and returns validated headlines", () => {
    const f = loadFetch(ICAL, "_breakingNewsCacheIcal", "_breakingNewsCacheOrderIcal", "2026-09-27");
    const out = f.fetchBreakingNews("2026-09-27");
    eq(f.calls.length, 1, "endpoint count");
    eq(out, "• Reuters: Rate cut announced\n• AP: Storm makes landfall");
  });

  test("past, future and malformed dates make zero network calls", () => {
    const f = loadFetch(ICAL, "_breakingNewsCacheIcal", "_breakingNewsCacheOrderIcal", "2026-09-27");
    eq(f.fetchBreakingNews("2026-09-26"), null, "past");
    eq(f.fetchBreakingNews("2026-09-28"), null, "future");
    eq(f.fetchBreakingNews("nope"), null, "malformed");
    eq(f.calls.length, 0, "no traffic allowed off-today");
  });
});

run("redactSecretsForLog", () => {
  for (const [name, src] of [["gcal", GCAL], ["ical", ICAL]]) {
    const fn = load(extractFunction(src, "redactSecretsForLog"), {}, ["redactSecretsForLog"])
      .redactSecretsForLog;
    test(`${name} masks apiKey and token`, () => {
      eq(fn("https://newsapi.org/v2/top-headlines?apiKey=abcdef123456"),
        "https://newsapi.org/v2/top-headlines?apiKey=***");
      eq(fn("token=xyz987 was used"), "token=*** was used");
      ok(fn("APIKEY=leak").indexOf("leak") === -1, "must be case insensitive");
    });
  }
});

/* ------------------------------------------------------------------ */
/* Metric contexts                                                     */
/* ------------------------------------------------------------------ */

function loadMetrics(src) {
  const decls = [
    extractConstObject(src, "METRIC_CONTEXT_BANDS"),
    extractFunction(src, "getMetricContext"),
    extractFunction(src, "formatMetricContext"),
  ].join("\n\n");
  const t = (key, lang) => {
    const labels = { ctxGood: "Good", ctxFair: "Fair", ctxBad: "Bad" };
    return labels[key] || key;
  };
  return load(decls, { t }, ["METRIC_CONTEXT_BANDS", "getMetricContext", "formatMetricContext"]);
}

run("metric contexts (gcal)", () => {
  const m = loadMetrics(GCAL);

  test("band edges are inclusive at the top and exclusive at the bottom", () => {
    eq(m.getMetricContext(0, "uv", true, "en"), "Good", "uv 0");
    eq(m.getMetricContext(2, "uv", true, "en"), "Good", "uv 2 upper edge");
    eq(m.getMetricContext(2.1, "uv", true, "en"), "Fair", "uv just above");
    eq(m.getMetricContext(5, "uv", true, "en"), "Fair", "uv 5");
    eq(m.getMetricContext(5.1, "uv", true, "en"), "Bad", "uv just above 5");
  });

  test("a blank reading yields no context instead of a false Fair", () => {
    eq(m.getMetricContext("", "uv", true, "en"), "", "blank string");
    eq(m.getMetricContext("   ", "uv", true, "en"), "", "whitespace string");
    eq(m.getMetricContext(null, "uv", true, "en"), "", "null");
    eq(m.getMetricContext(undefined, "uv", true, "en"), "", "undefined");
  });

  test("NaN and Infinity never produce a context", () => {
    eq(m.getMetricContext(NaN, "uv", true, "en"), "", "NaN");
    eq(m.getMetricContext(Infinity, "uv", true, "en"), "", "Infinity");
    eq(m.getMetricContext(-Infinity, "uv", true, "en"), "", "-Infinity");
  });

  test("an unknown metric yields no context", () => {
    eq(m.getMetricContext(5, "notAMetric", true, "en"), "", "unknown metric");
  });

  test("Fahrenheit readings are converted before banding", () => {
    // 40 F is 4.4 C: Fair once converted, Bad if the raw value were compared
    // against the Celsius bands. Proves the conversion actually runs.
    eq(m.getMetricContext(40, "temperature", false, "en"), "Fair", "40F converts to Fair");
    eq(m.getMetricContext(40, "temperature", true, "en"), "Bad", "40C stays Bad");
    // 68 F is 20 C, inside the Good band for both.
    eq(m.getMetricContext(68, "temperature", false, "en"), "Good", "68F converts to Good");
    eq(m.getMetricContext(20, "temperature", true, "en"), "Good", "20C stays Good");
    // Non-temperature metrics are never converted: were 40 to be read as
    // Fahrenheit it would become 4.4, which is below the Fair band.
    eq(m.getMetricContext(40, "humidity", false, "en"), "Good", "humidity is never converted");
  });

  test("formatMetricContext wraps the label in parentheses and hides blanks", () => {
    eq(m.formatMetricContext(3, "uv", true, "en"), " (Fair)");
    eq(m.formatMetricContext("", "uv", true, "en"), "", "blank must contribute nothing");
  });
});

run("pushFiniteHourlyValue", () => {
  for (const [name, src] of [["gcal", GCAL], ["ical", ICAL]]) {
    const fn = load(extractFunction(src, "pushFiniteHourlyValue"), {}, ["pushFiniteHourlyValue"])
      .pushFiniteHourlyValue;

    test(`${name} drops non-finite and blank values`, () => {
      const arr = [1, 2];
      fn(arr, NaN);
      fn(arr, Infinity);
      fn(arr, -Infinity);
      fn(arr, null);
      fn(arr, undefined);
      fn(arr, "");
      fn(arr, "   ");
      eq(arr, [1, 2], "array must be untouched");
    });

    test(`${name} keeps finite numbers and numeric strings`, () => {
      const arr = [];
      fn(arr, 3.5);
      fn(arr, "4.5");
      fn(arr, 0);
      eq(arr, [3.5, 4.5, 0], "finite values must be appended in order");
    });
  }
});

/* ------------------------------------------------------------------ */

console.log("");
if (failures.length > 0) {
  console.log(`JS harness: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`\n${f.name}\n  ${f.err.message}`);
  process.exit(1);
}
console.log(`JS harness: ${passed} passed, 0 failed`);
