# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- 264 tests (was 234): +30 new tests covering OnThisDay functionality, robustness hardening, i18n translations, Wikipedia deduplication
- `python tests/run_tests.py` — all 264 pass
- `python tests/lint_balance.py` — all balanced, 4 expected cross-file collisions, 0 constant drift

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
