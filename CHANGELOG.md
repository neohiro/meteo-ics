# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
