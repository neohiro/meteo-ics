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
    extractConstObject(src, "METRIC_CONTEXT_LABEL_KEYS"),
    extractFunction(src, "metricContextLabel"),
    extractFunction(src, "getMetricContext"),
    extractFunction(src, "formatMetricContext"),
  ].join("\n\n");
  // Mirrors the real t(): returns the entry for the requested language, falls
  // back to English, and echoes the key back when no entry exists at all.
  const TABLE = {
    ctxGood: { en: "Good", zh: "良好", de: "Gut" },
    ctxFair: { en: "Fair", zh: "一般", de: "Mäßig" },
    ctxBad: { en: "Bad", zh: "较差", de: "Schlecht" },
  };
  const t = (key, lang) => {
    const entry = TABLE[key];
    if (!entry) return key;
    return entry[lang] || entry.en || key;
  };
  return load(decls, { t }, [
    "METRIC_CONTEXT_BANDS", "METRIC_CONTEXT_LABEL_KEYS",
    "metricContextLabel", "getMetricContext", "formatMetricContext",
  ]);
}

run("metric contexts", () => {
    for (const [name, src] of [["gcal", GCAL], ["ical", ICAL]]) {
      run(`metric contexts (${name})`, () => {
        const m = loadMetrics(src);

    test("band edges are inclusive at the top and exclusive at the bottom", () => {
      eq(m.getMetricContext(0, "uv", true, "en"), "Low", "uv 0");
      eq(m.getMetricContext(2, "uv", true, "en"), "Low", "uv 2 upper edge");
      eq(m.getMetricContext(2.1, "uv", true, "en"), "Moderate", "uv just above");
      eq(m.getMetricContext(5, "uv", true, "en"), "Moderate", "uv 5");
      eq(m.getMetricContext(5.1, "uv", true, "en"), "High", "uv just above 5");
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
      eq(m.getMetricContext(40, "temperature", false, "en"), "Cool", "40F converts to Cool");
      eq(m.getMetricContext(40, "temperature", true, "en"), "Extreme", "40C stays Extreme");
      // 68 F is 20 C, inside the Good band for both.
      eq(m.getMetricContext(68, "temperature", false, "en"), "Mild", "68F converts to Mild");
      eq(m.getMetricContext(20, "temperature", true, "en"), "Mild", "20C stays Mild");
      // Non-temperature metrics are never converted: were 40 to be read as
      // Fahrenheit it would become 4.4, which is below the Fair band.
      eq(m.getMetricContext(40, "humidity", false, "en"), "Comfortable", "humidity is never converted");
    });

    test("formatMetricContext wraps the label in parentheses and hides blanks", () => {
      eq(m.formatMetricContext(3, "uv", true, "en"), " (Moderate)");
      eq(m.formatMetricContext("", "uv", true, "en"), "", "blank must contribute nothing");
    });

    test("labels with vetted translations are localized", () => {
      // aggregateAqi good/fair reuse the generic Good/Fair copy, which exists in
      // all eight languages, so a non-English locale must not see English.
      eq(m.getMetricContext(10, "aggregateAqi", true, "zh"), "良好", "zh good");
      eq(m.getMetricContext(30, "aggregateAqi", true, "zh"), "一般", "zh fair");
      eq(m.getMetricContext(30, "aggregateAqi", true, "de"), "Mäßig", "de fair");
    });

    test("metric-specific labels fall back to English without echoing a key", () => {
      // "Mild" has no vetted T_L entry. It must render as English text, never as
      // the lookup key, and never as a raw "ctxMild" artefact.
      eq(m.getMetricContext(20, "temperature", true, "zh"), "Mild", "zh untranslated label");
      const out = m.getMetricContext(20, "temperature", true, "de");
      ok(out !== "ctxMild" && out !== "Mildde", "must not leak the translation key");
    });

    test("an unknown locale degrades to English rather than blanking out", () => {
      eq(m.getMetricContext(10, "aggregateAqi", true, "xx"), "Good", "unknown locale");
      eq(m.getMetricContext(20, "temperature", true, "xx"), "Mild", "unknown locale, English label");
    });
    });
  }
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
/* ICS escape + folding: executed against the real icalweather.gs code  */
/* ------------------------------------------------------------------ */

/** Both helpers live only in icalweather.gs; gcal targets the Calendar API. */
function loadIcsText() {
  const decls = [
    extractFunction(ICAL, "escapeIcsText"),
    extractFunction(ICAL, "foldIcsLines"),
  ].join("\n\n");
  return load(decls, {}, ["escapeIcsText", "foldIcsLines"]);
}

/** True UTF-8 octet length, independent of the implementation under test. */
function utf8Len(s) {
  return Buffer.byteLength(s, "utf8");
}

/** Undoes RFC 5545 folding so a folded line can be compared to its original. */
function unfold(text) {
  return text.split("\r\n").map((seg, i) => (i ? seg.slice(1) : seg)).join("");
}

function assertNoLoneSurrogates(s, where) {
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    if (cu < 0xd800 || cu > 0xdfff) continue;
    const isHigh = cu <= 0xdbff;
    const next = i + 1 < s.length ? s.charCodeAt(i + 1) : NaN;
    const prev = i > 0 ? s.charCodeAt(i - 1) : NaN;
    const paired =
      (isHigh && next >= 0xdc00 && next <= 0xdfff) ||
      (!isHigh && prev >= 0xd800 && prev <= 0xdbff);
    if (!paired) throw new Error(`${where}: lone surrogate U+${cu.toString(16)} at ${i}`);
  }
}

const ics = loadIcsText();

run("escapeIcsText (ical)", () => {
  test("escapes the characters RFC 5545 reserves in TEXT values", () => {
    eq(ics.escapeIcsText("a,b;c\\d"), "a\\,b\\;c\\\\d", "comma, semicolon, backslash");
  });

  test("turns a newline into a literal escape and drops carriage returns", () => {
    // A raw CR or LF inside a value would terminate the content line and let
    // the remainder be parsed as arbitrary calendar properties.
    eq(ics.escapeIcsText("line1\nline2"), "line1\\nline2", "newline becomes literal \\n");
    eq(ics.escapeIcsText("line1\r\nline2"), "line1\\nline2", "CRLF collapses to one \\n");
  });

  test("escapes before folding so injected newlines cannot survive", () => {
    const folded = ics.foldIcsLines([ics.escapeIcsText("a\nBEGIN:VEVENT")]);
    eq(folded.includes("\r\nBEGIN:VEVENT"), false, "must not forge a new content line");
  });

  test("null and empty input produce an empty string", () => {
    eq(ics.escapeIcsText(null), "", "null");
    eq(ics.escapeIcsText(undefined), "", "undefined");
    eq(ics.escapeIcsText(""), "", "empty string");
  });
});

run("foldIcsLines (ical)", () => {
  test("leaves a short line untouched and does not terminate the stream", () => {
    eq(ics.foldIcsLines(["SUMMARY:Short title"]), "SUMMARY:Short title", "short line");
    eq(ics.foldIcsLines(["SUMMARY:x"]).endsWith("\r\n"), false, "caller owns stream termination");
  });

  test("folds a long ASCII line and marks each continuation with a space", () => {
    const line = "DESCRIPTION:" + "x".repeat(200);
    const parts = ics.foldIcsLines([line]).split("\r\n");
    ok(parts.length > 1, "long line must fold");
    for (let i = 1; i < parts.length; i++) {
      ok(parts[i].startsWith(" "), `continuation ${i} must start with a space`);
    }
    eq(unfold(ics.foldIcsLines([line])), line, "unfolding must restore the original");
  });

  test("every folded segment stays within 75 octets of true UTF-8 length", () => {
    // 3-byte CJK. Counting two octets per non-ASCII char (the old estimator)
    // reported 68 octets here and left the line unfolded at 98 real octets,
    // which strict clients reject.
    const cjk = "SUMMARY:" + "\u4e2d".repeat(30);
    ok(utf8Len(cjk) > 75, "fixture must genuinely exceed 75 octets");
    const parts = ics.foldIcsLines([cjk]).split("\r\n");
    ok(parts.length > 1, "a 98-octet CJK line must fold");
    parts.forEach((p, i) => {
      ok(utf8Len(p) <= 75, `segment ${i} is ${utf8Len(p)} octets, over the 75 limit`);
    });
    eq(unfold(ics.foldIcsLines([cjk])), cjk, "unfolding must restore the original");
  });

  test("two-byte characters are counted at their real width", () => {
    // "é" is 2 octets; 34 of them plus SUMMARY: is 76, so it must fold.
    const latin = "SUMMARY:" + "\u00e9".repeat(34);
    ok(utf8Len(latin) > 75, "fixture must genuinely exceed 75 octets");
    const parts = ics.foldIcsLines([latin]).split("\r\n");
    ok(parts.length > 1, "must fold");
    parts.forEach((p, i) => ok(utf8Len(p) <= 75, `segment ${i} is ${utf8Len(p)} octets`));
  });

  test("four-byte characters are counted at 4 octets and never split", () => {
    // Emoji are supplementary-plane: 4 UTF-8 octets across two UTF-16 units.
    // Slicing between the units emits lone surrogates, which strict parsers
    // reject outright.
    const emoji = "SUMMARY:" + "\u{1F324}\uFE0F".repeat(20);
    const out = ics.foldIcsLines([emoji]);
    const parts = out.split("\r\n");
    ok(parts.length > 1, "long emoji line must fold");
    parts.forEach((p, i) => {
      ok(utf8Len(p) <= 75, `segment ${i} is ${utf8Len(p)} octets`);
      assertNoLoneSurrogates(p, `segment ${i}`);
    });
    eq(unfold(out), emoji, "emoji must round-trip exactly");
  });

  test("a single oversize character still terminates the loop", () => {
    // Guards against a budget check that only breaks when used > 0: a leading
    // 4-octet character must be emitted even when it cannot fit the budget.
    const mixed = "SUMMARY:" + "\u{1F324}".repeat(3) + "x";
    const out = ics.foldIcsLines([mixed]);
    assertNoLoneSurrogates(out, "folded output");
    ok(out.length > 0, "must emit output");
  });

  test("folding is content-preserving across mixed scripts", () => {
    const mixed = "SUMMARY:" + "\u00e9".repeat(20) + "\u4e2d".repeat(10) + "\u{1F324}".repeat(5);
    const out = ics.foldIcsLines([mixed]);
    out.split("\r\n").forEach((p, i) => {
      ok(utf8Len(p) <= 75, `segment ${i} is ${utf8Len(p)} octets`);
      assertNoLoneSurrogates(p, `segment ${i}`);
    });
    eq(unfold(out), mixed, "mixed-script line must round-trip exactly");
  });

  test("multi-line input folds each line independently and joins with CRLF", () => {
    const out = ics.foldIcsLines(["BEGIN:VEVENT", "DESCRIPTION:" + "y".repeat(120), "END:VEVENT"]);
    ok(out.startsWith("BEGIN:VEVENT\r\n"), "first line preserved");
    ok(out.endsWith("\r\nEND:VEVENT"), "last line preserved");
    for (const part of out.split("\r\n")) ok(utf8Len(part) <= 75, `segment over 75: ${part}`);
  });

  test("exactly 75 octets is left unfolded (boundary is inclusive)", () => {
    const exact = "SUMMARY:" + "z".repeat(67); // 8 + 67 = 75 octets
    eq(utf8Len(exact), 75, "fixture must be exactly 75 octets");
    eq(ics.foldIcsLines([exact]), exact, "a 75-octet line needs no folding");
  });
});

/* ------------------------------------------------------------------ */

console.log("");
if (failures.length > 0) {
  console.log(`JS harness: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`\n${f.name}\n  ${f.err.message}`);
  process.exit(1);
}
console.log(`JS harness: ${passed} passed, 0 failed`);
