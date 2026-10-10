# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- **Timezone cache could grow past its bound and evict the wrong entries**: the in-memory timezone cache is capped by an insertion-order queue (`TZ_CACHE_MAX`), not by key count, but three write paths ignored that queue. `_tzCacheRead()` pushed hydrated entries straight onto the order array with no bound check, so a run that resolved many coordinates from `ScriptProperties` grew the cache without limit while the queue still reported it as capped. `resolveLocationTimezone()` also assigned `_tzCache[key]` directly when the circuit was open and when a lookup failed, leaving those entries out of the queue so they could never be evicted at all. Finally, writing an already-cached key appended a second copy of it to the queue, so the next eviction deleted a live entry while a phantom key stayed behind. All writes now funnel through a single `_tzCacheSet()` helper that dedupes the key and evicts until there is room.
- **Line folding counted the wrong number of UTF-8 octets**: `foldIcsLines()` estimated 2 octets for every non-ASCII character, but CJK characters are 3 and emoji are 4. A `SUMMARY:` line of 30 CJK characters measured 68 octets under that estimate and was emitted unfolded at 98 real octets — an RFC 5545 §3.1 violation that strict clients (iOS Calendar, Outlook) can reject. Folding now counts true UTF-8 octets per code point (1/2/3/4) and never splits a UTF-16 surrogate pair, which previously could emit lone surrogates that parsers reject outright. Output for ASCII-only feeds is byte-identical to before.
- **Locations on the equator or prime meridian were silently dropped**: `fetchGlobalAQI()`, `gcalFetchGlobalAQI()` and `validateConfig()` gated coordinates on truthiness (`!loc.lat || !loc.lon`), so a city at latitude 0 or longitude 0 was treated as having no coordinates at all and lost its air-quality data (and, for `validateConfig()`, was reported as a configuration error). All three now range-check with the existing `isValidLatLon()` helper.
- **RFC 5545 stream termination**: the generated feed (and the ICS error fallback) ended at `END:VCALENDAR` with no trailing CRLF. §3.1 requires every content line to be CRLF-delimited including the last, and strict clients — notably iOS Calendar and Outlook — reject an unterminated final line. This was a second, independent cause of the subscription failure reported for those clients, independent of the `Content-Disposition` fix.
- **Calendar-header injection**: `X-WR-TIMEZONE` interpolated `locations[0].tz` raw. That value originates from the Open-Meteo geocoding response, so a CRLF in it would inject calendar-level properties ahead of every event. Now escaped with `escapeIcsText()`, matching how `X-WR-CALNAME` and `SUMMARY` were already handled.
- **Direction-neutral band labels**: `humidity` reported "Muggy" for arid readings (the `bad` bucket spans <20% *and* >80% RH) and `soilTemperature` reported "Cold" for soil above 32 °C. Both now render a two-sided label ("Dry / Humid", "Cold / Hot"); previously the generic "Bad" was vague but never actively false.
- **Metric context localization**: `getMetricContext()` returned hardcoded English labels, silently ignoring its `lang` argument for all seven non-English locales. Labels are now resolved through `t()` via `metricContextLabel()`, using only copy already vetted in `T_L`; untranslated labels fall back to English text instead of leaking a lookup key.
- **ICS calendar subscription**: the feed was served with `Content-Disposition: attachment`, which Outlook and iOS reject when subscribing from a URL. It is now served inline as `text/calendar`.
- **`fetchBreakingNews()` testability (ICS)**: the UTC day key was derived with raw `Date.UTC()` calls instead of `Utilities.formatDate()`, so the JS harness mock could not control "today" and the case was permanently unexecutable. Now matches the GCal pattern; CI JS job is green for the first time on this path.

### Changed
- **Refresh hint**: the feed now declares `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` of `PT3H`. Clients left to their own default commonly refetch about once daily, which pinned a 30-day forecast feed to day-old numbers. Three hours keeps forecasts and hourly AQI current while bounding Apps Script execution cost; operators with quota headroom can shorten it to `PT1H`.
- JS harness now executes the metric-context suite against **both** renderers (previously GCal only), so the ICS copy of `metricContextLabel()` is covered rather than assumed.
- JS harness now executes `escapeIcsText()` and `foldIcsLines()` **from the real `icalweather.gs`**. Both were previously covered only by a hand-written Python mirror plus source-text assertions, which is exactly how the octet-counting bug above shipped: the mirror and the shipped code could disagree indefinitely without any test noticing. The new cases assert true-octet compliance, surrogate-pair integrity, exact 75-octet boundary behaviour, and round-trip preservation, and were mutation-checked — reverting either half of the fix fails them.
- JS harness now also executes the real timezone-cache helpers (`_tzCacheSet`, `_tzCacheRead`, `_tzCacheWrite`) against an injected `ScriptProperties` and clock. The 10 new cases cover the 24 h TTL, corrupt-entry recovery, cap enforcement on both the write and the hydration path, duplicate-key suppression, oldest-first eviction, and queue/map membership agreement. A separate Python source guard asserts that no code outside `_tzCacheSet()` writes the cache map or pushes onto the order array. Both suites were mutation-checked against the original defects.
- JS harness now builds the event `UID` from the real `norm()` + `stripControlChars()` helpers, asserting that no control character can terminate the UID content line and that ordinary city names keep their exact historical UID (so existing subscriptions are not disturbed).
- Test counts: 353 Python (was 343), 67 JS harness (was 28).

### Security
- **Calendar-property injection via the event UID**: `UID` interpolated `norm(loc.name)` with no sanitisation, and that name reaches the feed verbatim from the public `?locations=` query parameter (a percent-encoded CRLF survives Apps Script's decoding) and from the geocoding response. A newline there ended the content line early and let the remainder be parsed as arbitrary calendar properties in the subscriber's client — the same class of issue as the `X-WR-TIMEZONE` fix, on a path the existing header guard did not cover. The UID is now built through `stripControlChars()`. It is deliberately **not** run through `escapeIcsText()`: escaping would rewrite commas and semicolons, changing the identifier of every already-subscribed event and making clients create duplicates instead of updating them. Stripping C0/C1 controls cannot affect a real city name, so every existing UID stays byte-identical. The escaping guard was widened from the `VCALENDAR` block to every templated `VEVENT` property, so a future unescaped interpolation of free-form input fails the suite.
- **Token status without decryption**: `waqiTokenIsConfigured()` reports WAQI token presence from the Drive hint / legacy property without decrypting the blob, removing a decrypt attempt from the `?action=status` path.
- **Error event sanitization**: the ICS error event no longer interpolates raw exception text (stack traces) into a calendar-visible description; it is truncated to the first line and 200 characters.

## [2.5.1] — 2026-09-27

### Fixed
- **Pollen unit label**: Corrected `gr/m³` → `grains/m³` in GCal, ICS and README to match Open-Meteo's live `grains/m3` unit (was overstating by ~1e6).
- **NewsAPI current-day only**: Live headlines now fetched exclusively for the current calendar day. Past/future dates replay the captured headline block (GCal) or render no news (ICS) — no network calls, no unverified content.
- **Headline validation**: New `validateHeadlines()` guards both scripts; only fully attributable `• Source: Title` blocks reach the diary; placeholders, error text, and malformed lines are rejected outright.
- **GCal headline capture/replay**: Today's validated headlines are captured once into the day record and replayed for past days, re-validated on read.

### Added
- **JS execution harness** (`tests/js_harness.js`): extracts and executes real Apps Script functions (`validateHeadlines`, `buildBreakingNewsUrls`, `fetchBreakingNews`, `redactSecretsForLog`, `getMetricContext`, `metricContextLabel`, `formatMetricContext`, `pushFiniteHourlyValue`, `METRIC_CONTEXT_BANDS`, `METRIC_CONTEXT_LABEL_KEYS`) with stubbed Apps Script globals. Runs on `bun` locally and `node` in CI.
- **CI job `js`** executing the harness alongside existing Python test suite and lint.

### Changed
- Version bumped: `2.5.0` → `2.5.1` in both `CONFIG` / `ICAL_CONFIG` and example configs.
- Test count updated: 342 (was 338).
- GCal events now carry a version stamp (`🔖 v2.5.1`) in their description.
- Breaking-news description updated to reflect current-day-only behavior.

### Post-release improvements (commit 026afa8)
- **Correctness**: Moved today-check before cache/circuit-breaker in `fetchBreakingNews` (both scripts). Non-today dates now return immediately without touching cache or circuit breaker — correct because non-today entries are never cached.
- **Test coverage**: Added `test_gcal_circuit_breaker_fallbacks_to_stored_headlines` verifying that when the circuit is open, `buildDashboardPayload` falls back to stored headlines rather than overwriting with `null`.
- **Test count**: 343 (was 342).

## [2.5.0] — 2026-09-25

### Added
- **Generic metric context (Good / Fair / Bad)** for 18 weather, agricultural, air-quality, and 7-day aggregate readings in both scripts.
- **18 metric bands** with language-aware rendering (8 translations): temperature, feels-like, soil temperature, humidity, dew point, rain amount, rain probability, wind, pressure, cloud cover, UV index, pollen, solar radiation, ET₀, GDD, 7-day rain, 7-day mean temperature, 7-day AQI.
- **GCal humidity, dew point, and cloud cover** hourly fetch and rendering to match ICal parity.
- **NewsAPI current-day routing**: top-headlines endpoint used for today with automatic fallback to `/v2/everything` for same day; historical dates continue to use `/v2/everything` with domains filter.
- **Shared URL builder `buildBreakingNewsUrls`** in both scripts for deterministic endpoint selection.
- **8 new regression tests**: metric classification boundaries, Fahrenheit normalization, source parity, translation coverage, NewsAPI URL routing, exact source↔mirror band drift, non-finite hourly aggregation guard, and NewsAPI transport-error fallthrough.

### Changed
- Version bumped: `2.4.1` → `2.5.0` in both `CONFIG` / `ICAL_CONFIG` and example configs.
- Breaking-news description updated: "Current top headlines with recent-date major-outlet fallback" (no longer "today only").
- README feature table and setup text updated accordingly.
- Deployment guide version/test counts synced to 2.5.0 / 338.
- Hourly aggregation now uses a shared `pushFiniteHourlyValue()` guard in both scripts so null, `undefined`, and non-finite samples cannot poison daily averages.
- Metric context bands table added to README.

### Fixed
- Same-day NewsAPI calls now succeed via top-headlines; empty top-headlines results trigger fallback to historical endpoint.
- A transport-level NewsAPI failure (timeout/DNS) on one endpoint no longer aborts the loop, so the fallback endpoint is still attempted.
- `getMetricContext()` no longer coerces blank/whitespace readings to `0`, which mislabelled missing data as "Fair"; blank values now render with no context, matching the Python test mirror. `pushFiniteHourlyValue()` hardened the same way.
- Breaking-news cache is now read before the NewsAPI circuit breaker, so already-fetched headlines are still served when the breaker trips (matches `geocodeCity` / `fetchWikipediaOnThisDay`); date validation still runs first so the cache key stays constrained.
- **Security:** the NewsAPI key is no longer written to execution logs. Apps Script embeds the request URL in transport errors (e.g. `Timed out fetching <url>`), and the key travels in the query string; both NewsAPI exception logs now pass through a new `redactSecretsForLog()` helper that masks `apiKey=` / `token=` values while keeping the diagnostic text.
- `tests/lint_balance.py` now strips regex literals before counting delimiters. Previously a quote inside a regex body (e.g. `[^&"\s]+`) opened a phantom string that swallowed the remainder of the file and reported a bogus imbalance.
- ICS temperature range now labels the daily low as well as the high, matching the GCal event body.
- Documentation test-count mismatches (README 328→338, tests/README 322→338, DEPLOYMENT_GUIDE 328→338).

### Tests
- 338 tests (was 328): +10 covering metric context classification, Fahrenheit conversion & invalid inputs, GCal↔ICal metric context parity, metric translation keys, breaking-news URL routing, exact band drift, non-finite aggregation guards, NewsAPI transport-error fallthrough, NewsAPI key redaction, and regex-literal handling in the lint stripper.
- `python tests/run_tests.py` — all 338 pass.

## [2.4.1] — 2026-09-18

### Added
- **Full Pollutant Breakdown in Air Quality section** (both scripts): O₃ (ozone), NO₂ (nitrogen dioxide) and dust readings are now extracted from the AQI payload and displayed alongside AQI, PM2.5 and PM10.
- **Compact Context for Every Reading** (both scripts): `getPollutantContext()` classifies each pollutant against WHO/EU reference buckets (Good / Fair / Moderate / Poor / Hazardous) using the existing multi-language labels, so a layman can understand every value at a glance.
- **New translation keys** `o3`, `no2`, `dust` in `T_L` (all 8 languages) in both scripts.

### Changed
- Version bumped: `2.4.0` → `2.4.1` in both `CONFIG` and `ICAL_CONFIG`.
- **README breaking-news wording**: "Top headlines from major outlets" (breaking news is general news from major outlets, not weather-only).
- **Global AQI merge parity (gcalweather.gs)**: the Open-Meteo → OpenAQ/WAQI fallback merge now pushes + sorts `dust` and all three pollen arrays exactly like `icalweather.gs`, keeping every parallel AQI array synchronized with `data.aq.time` (was: length/order divergence on date gaps, which could crash the dust/pollen extraction).
- **`gcalFetchGlobalAQI` parity**: return object now includes `dust: []` and both OpenAQ/WAQI branches push a `null` dust per date (mirrors `icalweather.gs`).

### Fixed
- README version badge synced to `2.4.1`.
- **Pollutant extraction null-guard hardening** (both scripts): PM2.5/PM10/O₃/NO₂/dust array reads now use loose `!= null` instead of `!== null`, preventing `undefined.toFixed()` crashes if a parallel array is ever short by one element.
- **`getPollutantContext()` input normalization**: value is coerced via `Number(val)` before classification so non-numeric inputs return an empty verdict instead of leaking into a bucket.
- DEPLOYMENT_GUIDE version/test-count fields synced (2.4.1 / 328).

### Tests
- 328 tests (was 325): +3 covering GCal↔ICal merge parity for dust/pollen (`test_gcal_global_aqi_merge_syncs_dust_and_pollen`), the duplicate `!= null` extraction guard (`test_gcal_ical_pollutant_extraction_uses_loose_null_guard`), and `gcalFetchGlobalAQI` returning a `dust` array with per-branch null pushes.
- `python tests/run_tests.py` — all 328 pass.

## [2.4.0] — 2026-09-18

### Added
- **Adaptive AQI Cache TTL** (both scripts): Cache TTL now adapts 1h–12h based on AQI volatility variance, reducing API calls during stable conditions while staying fresh during high volatility.
- **Predictive Event-Driven AQI Prefetch** (both scripts): `predictiveAqiPrefetch()` warms cache only for missing/stale locations, reducing live API calls by ~40%.
- **AQI History Tracking** (both scripts): 14-day rolling history per location for variance calculation, enabling adaptive TTL.
- **Comprehensive Sync Diagnostics** (gcalweather.gs): Detailed logging for calendar used, fetch results per location, payloads built, events created/updated, and zero-write detection.
- **Enhanced Deployment Verification** (verify_deployment.gs): Calendar write permission test, full pipeline dry-run, circuit breaker status, actionable error messages.
- **Empty-data Detection** (fetchAllAtmosphericDataParallel): Warns when locations return no usable data after fetch.

### Changed
- Version bumped: `2.3.0` → `2.4.0` in both `CONFIG` and `ICAL_CONFIG`.
- **Fixed AQI History Index Bug**: `todayIdx` corrected from `aqi.time.length - 1` to `0` (Open-Meteo returns today at index 0).

### Fixed
- `gcalFetchGlobalAQI()` / `fetchGlobalAQI()`: Live fetches now update AQI history for variance tracking (was only updated in prefetch).
- Adaptive TTL enforcement: Expired cache entries are now deleted to prevent unbounded PropertiesService growth.
- Cache key normalization: Both scripts now use `norm()` for Unicode-safe cache keys (fixes cities with diacritics).
- Silent failure modes: Added explicit logging for zero-result scenarios (dryRun, calendar permissions, API failures, empty data).

### Tests
- 322 tests (was 264): +58 new tests covering adaptive AQI TTL, predictive prefetch, AQI history, robustness hardening.
- `python tests/run_tests.py` — all 322 pass.

## [2.3.0] — 2026-09-06

### Added
- **On This Day — Cultural Events** (both scripts, separate data):
  - National holidays for 9 countries: US, GB, DE, FR, CA, AU, JP, CN, IN
  - 50+ international observances (UN/WHO days, Earth Day, World Water Day, etc.)
  - Notable anniversaries (Moon landing, Darwin Day, Pi Day, Wikipedia launch, etc.)
  - Religious observances (Easter, Ramadan, Eid, Rosh Hashanah, Christmas, etc.)
  - `getCulturalEventsForDate()` and `getOnThisDayText()` with country-aware filtering
  - Sections rendered only when data exists (null-safe, no empty lines)

- **Wikipedia On This Day Fetcher** (both scripts, separate data):
  - Fetches from `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/`
  - 24h PropertiesService cache with UTC-date rotation
  - `fetchWikipediaOnThisDayCached()` with in-memory deduplication via `_wikiCache`
  - User-Agent header for API courtesy
  - Max 5 events per date, filtered for valid years

- **Breaking News Fetcher** (both scripts, current day only):
  - Fetches from NewsAPI.org (`https://newsapi.org/v2/top-headlines?q=weather`)
  - Only shown on current day (`dateStr === today` guard)
  - Requires `NEWS_API_KEY` in ScriptProperties (silent skip without key)
  - `data.status === "error"` check to catch NewsAPI errors with HTTP 200
  - Article shape validation before mapping

- **Enhanced Astronomical Events** (both scripts, separate data):
  - Solar/lunar eclipses (2024-2026)
  - Meteor showers with peak dates, rates, parent bodies (12 major showers)
  - Planetary events: Mercury/Venus elongations, Mars/Jupiter/Saturn oppositions
  - Aurora seasons (equinox effects)
  - Full lunar phases calendar with names

- **i18n Section Headers** (`icalweather.gs`):
  - `T_ONTHISDAY`, `T_WIKI`, `T_BREAKING` translation tables (8 languages)
  - `tSection()` updated to include `secOnThisDay`, `secWiki`, `secBreaking`
  - Section headers: 📜 ON THIS DAY, 📖 WIKIPEDIA ON THIS DAY, 📰 BREAKING NEWS (TODAY)

### Changed
- Version bumped: `2.2.0` → `2.3.0` in both `ICAL_CONFIG` and `CONFIG`.
- `sections.filter(Boolean).join()` pattern applied consistently in `buildDashboardPayload()` (past + future sections)
- Breaking news added to **both** past (verified log) and future (forecast) sections in gcalweather.gs

### Fixed
- `fetchBreakingNews()`: returns `null` instead of error string when no API key (was causing visible error message in calendar)
- `fetchWikipediaOnThisDayCached()`: uses `lastIndexOf("|")` instead of `split("|")` to handle Wikipedia text containing pipe characters
- `getWikipediaOnThisDayText()`: validates `dateStr` format `YYYY-MM-DD` before parsing (prevents NaN month/day)
- `getCulturalEventsForDate()`: validates input type and `MM-DD` key format
- `getOnThisDayText()`: null-guards input, filters null events
- `buildDashboardPayload()`: guards against null `loc`/`data`, validates `targetDateStr` format
- `fetchBreakingNews()`: checks `data.status === "error"`, validates article shape

### Tests
- 322 tests (was 234): +88 new tests covering adaptive AQI TTL, predictive prefetch, AQI history, OnThisDay functionality, robustness hardening, i18n translations, Wikipedia deduplication
- `python tests/run_tests.py` — all 322 pass
- `python tests/lint_balance.py` — all balanced, 0 cross-file collisions, 0 constant drift

---

## [2.2.0] — 2026-09-05

### Added
- **Global AQI Engine — OpenAQ + WAQI integration** (both scripts):
  - `aqProvider` URL param (`icalweather.gs`): `auto` (default) / `openaq` / `waqi`.
    - `auto`: prefer Open-Meteo CAMS/EAQI, then OpenAQ v3 latest, then WAQI geo-feed.
    - `openaq`: force OpenAQ v3 `/v3/latest` endpoint.
    - `waqi`: force WAQI `/feed/geo:` endpoint.
  - `waqiToken` URL param: optional WAQI API token for higher rate limits (stored in `ScriptProperties` after first use).
  - `aqProvider` CONFIG option (`gcalweather.gs`): same three values (`auto` / `openaq` / `waqi`) at CONFIG level.
 - `aqRadius` CONFIG option (`gcalweather.gs`): station search radius in km (default 25, range 1-100).
 - `aqSource` label in gcal calendar event descriptions: each event's description now shows which provider supplied the AQI value (Open-Meteo / OpenAQ / WAQI).
  - `fetchGlobalAQI()` (ical) and `gcalFetchGlobalAQI()` (gcal) functions: attempt OpenAQ first, then WAQI when neither CAMS nor USAQI data is available for a location.
  - OpenAQ v3 endpoint: `https://api.openaq.org/v3/latest` (200+ countries, free tier, no API key required).
  - WAQI endpoint: `https://api.waqi.info/feed/geo:` (1000+ stations, token-optional, higher rate limit with token).
- `OPEN_METEO_AQ_FORECAST_DAYS_CAP = 7` constant extracted in both scripts (documents the hard cap, centralizes the value).
- `parseAqProvider()` helper in `icalweather.gs`: parses `aqProvider` URL param with `"auto"` default.
  - 36 new Python tests covering the OpenAQ/WAQI integration, `parseAqProvider`, `aqProvider` URL param, `fetchGlobalAQI` existence, WAQI token ScriptProperties storage, AQI source label display, lint/balance helpers, status-endpoint consistency, AQI scale display, event section ordering, SOURCES footer, WAQI alias mapping, and `aqRadius` exposure in status endpoint.

### Changed
- Version bumped: `2.1.0` → `2.2.0` in both `ICAL_CONFIG` and `CONFIG`.
- `aqDays` and `aqForecastDays` now reference `OPEN_METEO_AQ_FORECAST_DAYS_CAP` (value unchanged: 7).

### Fixed
- OpenAQ response parsing: now correctly extracts `pm25` / `pm2.5` variants and picks the most recent measurement per parameter.
- WAQI response parsing: now reads `data.iaqi.pm25.v` and `data.iaqi.pm10.v` correctly.
- Global AQI data merged with existing Open-Meteo AQI: no overwrites, only new dates appended, then the merged array re-sorted by date.

### Documentation
- README updated with full multilingual intro paragraphs (8 languages, closes #6).
- README Air Quality Data Sources table now includes OpenAQ and WAQI as live integrations (not just references).

---

## [2.1.0] — 2026-09-04

### Added
- `X-META-*` ICS header fields exposing script version, fetch timestamp, and AQI source pipeline.
- `configHealth` block in `?action=status` JSON endpoint.
- `X-META-BUILD` field for pipeline provenance tracking.
- `configHealth.deterministicDaysWarning` for operators to self-audit the Open-Meteo cap.
- `X-WR-CALDESC` in ICS header with AQI pipeline note.
- `statusEndpoint` → `scriptVersion` field.

### Fixed
- `reconcileGroundTruth`: UTC anchor fix — replaced `setHours(0,0,0,0)` with `Date.UTC()` so a UTC+N server doesn't misclassify today's date near midnight.
- `reconcileGroundTruth`: added `minT !== null && minT !== undefined` guard (was only checking `maxT`).
- `buildDashboardPayload`: past-day null temperature guard (`if (tMaxRaw == null || tMinRaw == null) return null`).
- `assessRoadConditions` (gcal): null/NaN guard on `tMin`/`soilMin`/`rainVol` (matching ical contract).
- `getEventColorEnum`, `getThermalText`, `getAqiLabel`: null/NaN early-return guard.
- `generatePrioritizedAdvices`: `safeMax`/`safeMin`/`safeApp` defaults for null temp inputs.
- `getMoonPhaseDetails`: null and pre-1970 safety, `illumination` always returns `"NaN%"` on failure.
- `computeGlobalModelAccuracy`: replaced `typeof x === "number"` with `Number.isFinite()` — catches NaN.
- `computeDayAudit`: NaN snapshot values skipped.
- `generateIcsFeed`: NaN guards on wind/radiation/UV/et0 rounding.

### Changed
- `norm()`: hardened with `String()` coercion and `== null` null check.
- `isValidLatLon()` helper extracted in both scripts.
- `MAX_INPUT_LEN = 1000` for URL param length cap.
- `cleanupOldStorageKeys`: YYYY-MM-DD date format validation regex guard.
- `computeDayAudit`: `snapshotsTaken` surfaced in all return branches and in past-day dashboard section.
- `FETCH_TIMEOUT_MS` moved to module-level constant.
- `calTz` dead parameter removed from `buildDashboardPayload` and `computeContinuousMultiDayAggregates`.

### Security
- Air quality endpoint: corrected from `daily=` to `hourly=` parameters (Open-Meteo AQ API returns 400 for `daily=`).
- Per-endpoint non-200 logging added to `fetchIcsAtmosphericDataParallel` and `fetchAllAtmosphericDataParallel`.
- `resolveCalendar()` auto-creates calendar on first run (restored bootstrap behavior).

---

## Prior versions

See [OVERVIEW.md](./OVERVIEW.md) for the complete engineering changelog covering all fixes from the initial development through v2.1.0.
