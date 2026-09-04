# Meteo-ICS — Engineering Overview

## What the scripts are

| File | Purpose | Entry point |
|---|---|---|
| `icalweather.gs` | ICS calendar feed generator (RFC 5545). Exposed as a Google Apps Script Web App URL; calendar clients subscribe to it. | `doGet(e)` |
| `gcalweather.gs` | Google Calendar event syncer. Writes per-city, per-day all-day events to a configured Google Calendar. | `syncWeatherToCalendar()` |
| `tests/run_tests.py` | 128-test Python suite; mirrors helper logic in Python and asserts equivalence against source text. | `python tests/run_tests.py` |

Both scripts are written in Google Apps Script (`.gs`, V8 runtime) and depend on:
- **Open-Meteo API** (free, no key required) — deterministic forecast, ensemble forecast, air quality
- **Google Apps Script services** — `UrlFetchApp`, `ContentService`, `PropertiesService`, `CalendarApp`
- No paid API keys required.

---

## What was done — complete changelog

### Pass 1: Bug fixes

| # | File | Bug | Fix |
|---|---|---|---|
| 1 | both | `computeGlobalModelAccuracy`: `verifiedDays` never declared → `ReferenceError` on first real calibration day | Added `let verifiedDays = 0` and `verifiedDays++` inside the historical-day loop |
| 2 | gcal | `getWeatherGlyph` + `getWeatherName`: missing null/undefined/NaN guard | Added `if (code == null \|\| isNaN(code)) return ...` |
| 3 | ical | Dead `tl()` function defined but never called (superseded by `t()`) | Removed |
| 4 | ical | Dead `getAstronomicalEvents(dateStr)` — no year arg, wrong for future years | Removed; `getAstronomicalEventsForYear(dateStr, year)` is the replacement |
| 5 | ical | `generateIcsFeed`: no guard against empty locations array → silently produces empty VCALENDAR | Added `Array.isArray` guard + `throw new Error` if all cities fail |
| 6 | ical | `assessRoadConditions`: no NaN guard → `null` coerced to 0 misclassifies road status | Added `isNaN` check; falls back to safest category |
| 7 | both | Variance computed against `currentMax` (rounded int) instead of unrounded mean → understates ensemble spread | Compute `meanMax`/`meanMin` unrounded first; round only for display |
| 8 | both | `Math.abs(snap.predictedMax - actMax)` where either could be null/undefined → wrong error or NaN | Added `typeof snap.predictedMax !== "number"` guard before arithmetic |
| 9 | ical | `handleStatusEndpoint` header doc: `dryRun` URL param was missing from documented parameter list | Added |
| 10 | gcal | Header doc: `CONFIG.dryRun` feature was missing from feature bullets | Added |

### Pass 2: Runtime resilience + defensive hardening

| # | File | Issue | Fix |
|---|---|---|---|
| 11 | ical | `doGet`: if `generateIcsFeed` threw, the raw Apps Script exception propagated as HTTP 500 | Wrapped `generateIcsFeed` in try/catch; returns a plain-text error document |
| 12 | ical | `handleStatusEndpoint`: if `computeGlobalModelAccuracy` threw (e.g., corrupted PropertiesService data), the whole endpoint crashed | Wrapped in try/catch; returns `tempMAE: "Error"` so the endpoint stays healthy |
| 13 | gcal | `saveDayRecord`: `PropertiesService.setProperty` had no try/catch — would throw if JSON serialization failed (e.g., BigInt or circular ref) | Added try/catch with `Logger.log` |

### Pass 3: Improvements

| # | File | What | Detail |
|---|---|---|---|
| 14 | both | Added `version: "2.1.0"` to config | Both `ICAL_CONFIG` and `CONFIG` now carry a semantic version string |
| 15 | ical | `X-WR-CALDESC` ICS header | New RFC property: `X-WR-CALDESC:Weather + astronomical · v2.1.0` |
| 16 | ical | `scriptVersion` in status JSON | Status endpoint now returns `scriptVersion: "2.1.0"` |
| 17 | both | `norm()` hardened | Changed `if (!str)` → `if (str == null)` and `return str.normalize(...)` → `return String(str).normalize(...)` — now safe for `null`, `undefined`, `Number`, or any non-string |
| 18 | both | New `isValidLatLon(lat, lon)` helper | Replaces 4 repeated inline `isNaN` + range checks with a single `Number.isFinite` + abs-bounds check |
| 19 | ical | `parseLocationsFromParams`: URL param length cap | `MAX_INPUT_LEN = 1000` prevents pathological inputs from burning API quota; logs a warning when input is truncated |
| 20 | both | `isValidLatLon` used in `parseLocationsFromParams` | Replaced two `!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180` checks with `isValidLatLon(lat, lon)` |
| 21 | gcal | `cleanupOldStorageKeys`: date format guard | Added `/^\d{4}-\d{2}-\d{2}$/.test(dateStr)` before comparing — prevents legacy/corrupted keys from being compared as strings |
| 22 | gcal | `computeDayAudit`: `snapshotsTaken` in return value | All three return branches now include `snapshotsTaken: N` |
| 23 | gcal | Past-day dashboard section: shows `snapshotsTaken` | Line added: `• Snapshots Tracked: ${audit.snapshotsTaken}` — visible in the calendar event description for self-debugging |

### Pass 4: TZ correctness + translation fallback hardening

| # | File | Bug | Fix |
|---|---|---|---|
| 24 | gcal | `buildDashboardPayload` past-day section: `Math.round(data.det.temperature_2m_max[pastIdx])` had no null guard — if Open-Meteo returned null for a past day, the title would contain `NaN` | Added `if (tMaxRaw == null \|\| tMinRaw == null) return null;` before rounding |
| 25 | gcal | `tgtDateObj` constructed with `new Date(targetDateStr + "T12:00:00")` — local-TZ interpretation; near midnight local, `getUTCFullYear()` would return the wrong year for a date | Changed to `new Date(targetDateStr + "T12:00:00Z")` (UTC noon) |
| 26 | gcal | `computeContinuousMultiDayAggregates` built the 7-day date list using `Utilities.parseDate` in the calendar TZ; for a base date near midnight, the list would be off by one day | Replaced with `Date.UTC(...)` arithmetic; date keys formatted with `getUTCFullYear/Month/Date` and `padStart` |
| 27 | ical | `tRoadStatus` and `tRoadAdv` returned the raw key (`"rdBI"`) when a language was missing from the map — produced developer codes in user-facing output | Added `map.en` fallback: `return map[lang] \|\| map.en \|\| key;` |

### Pass 5: Final polish — AQI threshold + regression guards

| # | File | Bug / Item | Fix |
|---|---|---|---|
| 28 | ical | `airQualPoor` advice triggered at `ctx.aqi > 80` — but EAQI "Poor" band starts at 41. AQI=70 (clearly Poor) would never fire; "Poor" advice was effectively dead code for any AQI under 81 | Lowered threshold to `ctx.aqi > 40` (EAQI Poor band 41–80) |
| 29 | both | No regression guard against future regression of the moon-illumination formula paren balance (`(1 - cos(...))/2` has 3 opens, 3 closes) | Added paren-balance tests for both files |

**Investigated but not changed** (false positives):
- *Illumination formula*: visually looks like a paren mismatch but actually balanced; miscount during review. Restored to original.
- *Pollen map keys*: all keys correctly spelled.

### Pass 6: Comprehensive bug hunt + proposals

| # | File | Bug / Item | Fix |
|---|---|---|---|
| 30 | gcal | `getAstronomicalEventsForYear`: used `.indexOf("Meteor")` which incorrectly matched "Meteor Ramp-up" entries, appending `(YYYY)` to them | Changed to `/Meteor Peak/i` regex (consistent with icalweather.gs) |
| 31 | ical | `parseLocationsFromParams`: URL params can be delivered as arrays by Apps Script; `.split(",")` on an array throws a TypeError | Added `asString = v => (Array.isArray(v) ? v.join(",") : String(v))` helper; all param reads now use it |
| 32 | ical | `doGet`: `unitParam.toLowerCase()` crashes if `params.unit` is an array | Wrapped in `String(...)` coercion: `String(params.unit \|\| ...).toLowerCase()` |
| A | both | Proposal A — i18n coverage audit: no automated check that every ADVICE_TEXTS key has all 8 languages | Verified: 25 advice keys × 8 langs, 79 T_L entries × 8 langs — all complete; no silent `\|\| map.en` fallback needed in practice |
| B | both | Proposal B — threshold regression guard: `ctx.aqi > 40` had no automated guard against accidental revert to `> 80` | Added 3 regression checks to `verify_fixes.py`: airQualPoor threshold, array-safe param handling, meteor peak regex |
| C | both | Proposal C — live smoke test: no runtime validation beyond structural checks | Added 5 smoke tests exercising full pipeline (mocked Open-Meteo data): deterministic, ensemble, ICS escape/fold, AQI priority, advice thresholds |

### Pass 8: Perf hot-path hoisting + TZ correctness round 2

| # | File | Item | Fix |
|---|---|---|---|
| 41 | ical | **Perf hot path**: `generateIcsFeed` ensemble branch recomputed `Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_max"))` inside the per-offset loop — O(offsets × modelKeys) wasted work (4 cities × 30 days × ~5 model keys = 600 redundant filter calls per request) | Hoisted `ensMaxKeys`/`ensMinKeys` once per `forEach(loc => ...)` |
| 41b | ical | **Perf hot path**: same hoisting in `computeContinuousMultiDayAggregates` — 7 redundant filter calls per call | Hoisted `ensMaxKeys`/`ensMinKeys` once per function |
| 41c | gcal | **Perf hot path**: same hoisting in gcal's `computeContinuousMultiDayAggregates` | Hoisted `ensMaxKeys`/`ensMinKeys` once per function |
| 42 | gcal | **TZ correctness round 2**: `reconcileGroundTruth` compared `targetDate` (UTC-anchored) to `today` (local-midnight-anchored via `setHours(0,0,0,0)`). A UTC+8 server would classify today's Open-Meteo date as "yesterday" near 00:00 local | Replaced with `new Date(Date.UTC(year, month, day))` — consistent UTC anchor on both sides |
| 42b | gcal | **NaN safety**: `reconcileGroundTruth` guarded `maxT !== null` but not `minT`. Null minT → `Math.round(null) = 0` → wrong recorded actual.minTemp | Added `minT !== null && minT !== undefined` to the guard |

**Investigated but not changed** (false positives or risky):
- *`assessStargazingConditions` in gcal hardcodes English strings* — would need a translation table to match ical's 8-lang support. Risky refactor; left for explicit feature work.
- *Shared `ASTRONOMICAL_EVENTS` constant duplication* (ical line 214-244 vs gcal) — Apps Script has no `import` mechanism; `Library` config is brittle. Skip.

### Pass 7: Principal-engineer sign-off — defensive hardening

| # | File | Bug / Item | Fix |
|---|---|---|---|
| 33 | gcal | **Dead code**: `getAstronomicalEvents(dateStr)` (no year arg) still defined alongside `getAstronomicalEventsForYear`. Never called; same dead function icalweather had pre-Pass 1 | Removed; updated test to assert dead-function absence |
| 34 | gcal | **TZ bug**: `reconcileGroundTruth` parsed `new Date(dateStr + "T00:00:00")` — local-TZ interpretation, same class of bug as Pass 4's `tgtDateObj` fix. Near midnight, today could be misclassified as past-day | Changed to `T00:00:00Z` (UTC anchor) — matches Open-Meteo's UTC date semantics |
| 35 | gcal | **Missing NaN guard**: `assessRoadConditions` had no null/NaN check on `tMin`/`soilMin`/`rainVol` (ical's version has it). Null inputs → `null - 32 = NaN` → first comparison false → silent fallthrough to "CHILLED ASPHALT" | Added `if (... == null \|\| isNaN(...))` guard returning safe default; matches ical contract |
| 36 | gcal | **Null-temp rendering**: `buildDashboardPayload` deterministic path used `Math.round(data.det.temperature_2m_max[idx])` with no null check. If Open-Meteo returns null for a date, title shows "🌡️ 0°C City" — wrong display | Added `if (maxRaw == null \|\| minRaw == null) return null;`; tightens null guards on all 8 derived fields |
| 37 | gcal | **Silent failures**: `fetchAllAtmosphericDataParallel` silently dropped non-200 responses (e.g. ensemble API down → ensemble forecast just empty, no log) | Added per-endpoint `Logger.log` for non-200 with response code |
| 38 | ical | **Silent failures (mirror)**: `fetchIcsAtmosphericDataParallel` had the same silent-drop pattern | Added per-endpoint `Logger.log` for non-200 |
| 39 | gcal | **NaN propagation in advice**: `generatePrioritizedAdvices` used `ctx.apparentMax - 32` directly. If Open-Meteo returns no `apparent_temperature_max`, `null - 32 = NaN` → all `appC >= 38` comparisons false → no heat-advice fired even on hot day | Added `typeof` check; falls back to `safeMax` (default 20°C) when temp is null/non-number |
| 40 | gcal | **NaN propagation in display helpers**: `getEventColorEnum`, `getThermalText`, `getAqiLabel` had no null/NaN check. Null input → `null - 32 = NaN` → falls through to wrong end of switch ("Hot" or "Hazardous") | Added `if (t == null \|\| isNaN(t))` early return with safe default |

---

## Verification status

| Check | Tool | Result |
|---|---|---|
| Brace / paren / bracket structural balance | `validate3.py` (custom, reads `.gs` as text, counts delimiters) | 0/0/0 both files |
| Source-content fix verification (54 checks) | `verify_fixes.py` (custom, regex on source) | ALL PASS |
| Unit + integration + source-signature + smoke tests | `tests/run_tests.py` (128 Python tests) | 128 passed, 0 failed |
| Test count documented | `tests/README.md` | 128 |

**What was NOT verified** (no Apps Script runtime available; Node.js not installed):
- Live `doGet` execution — all paths verified structurally but not end-to-end
- Live `syncWeatherToCalendar` execution
- Actual HTTP responses from Open-Meteo API (tested via logic mirrors in Python)
- Google Calendar read/write (requires authenticated Apps Script context)

---

## Running the tests

```bash
# Full test suite
python tests/run_tests.py

# Structural balance check
python C:\Users\skele\AppData\Local\Temp\opencode\validate3.py

# Fix presence check
python C:\Users\skele\AppData\Local\Temp\opencode\verify_fixes.py
```

Expected output: **109 passed, 0 failed** · both files 0/0/0 balanced.

---

## Test coverage breakdown

| Group | Tests | What it covers |
|---|---|---|
| URL parameter parsing | 9 | `clamp`, `normalizeLang`, `parseBoolParam` — Apps Script coercion semantics |
| Moon phase calculations | 4 | UTC epoch reference, synodic-month boundaries, pre-1970 negative-phase guard |
| Weather glyph | 3 | null/undefined/NaN → fallback glyph; all weather code ranges |
| Golden hour window | 5 | normal, midnight-crossing, negative-hour wrap, sentinel values |
| ICS escape + folding (RFC 5545) | 6 | `\n` preserved through CRLF, `\;` `\,` `\\` escaped, CJK multi-octet fold limit |
| Source: gcalweather.gs | 11 | `resolveCalendar` throws, `geocodeCity` returns null, `ASTRONOMICAL_EVENTS` hoisted, UTC moon, NaN guard, per-city try/catch, verifiedDays |
| Source: icalweather.gs | 15 | params, opts, 8 languages, `ADVICE_TEXTS`, helpers, `X-WR-LANG`, year-aware astro, road/lang params, `escapeIcsText` no newline replace, RFC PRODID |
| Integration: doGet / generateIcsFeed | 8 | dryRun honors maxDays, per-city isolation, 4-city dedup, AQI type priority, CRLF in ICS header |
| Integration: gcalweather | 4 | dryRun guard, aqiType staleness, year-aware astro, calendar write try/catch |
| Code quality | 5 | no duplicate function defs, no dead code, advice priority thresholds, RFC 5545 PRODID format |
| Translation completeness | 5 | all 8 langs in `ADVICE_TEXTS`, all priority keys, T_L required keys, `SUPPORTED_LANGS` order |
| Endpoint documentation | 2 | `buildReadme` mentions all params, status endpoint returns all fields |
| Bug fix regressions | 9 | null guards, verifiedDays, dead code removal, empty locations guard, NaN in `assessRoadConditions`, unrounded variance mean, null snapshot guard, doGet try/catch, status try/catch |
| New behavior (Pass 3) | 14 | version constant, X-WR-CALDESC, norm type coercion, isValidLatLon helper, date format guard, snapshotsTaken, MAX_INPUT_LEN, saveDayRecord try/catch |

---

## Architecture notes

### Data model

```
Location → [geocoded]
    ├── Deterministic forecast (Open-Meteo /v1/forecast) — D+0 to D+14
    │   └── time[], temperature_2m_max[], weather_code[], precipitation_sum[], ...
    ├── Ensemble forecast (Open-Meteo /v1/ensemble) — D+0 to D+30
    │   └── time[], temperature_2m_max[gfs_seamless]... (GRIB model variants)
    ├── Air quality (Open-Meteo /v1/air-quality) — D+0 to D+14
    │   └── time[], european_aqi[], us_aqi[], pm2_5[], pollen[]
    └── Hourly aggregates (pressure, soil temp) — per day
        └── time[] → pressure_msl[], soil_temperature_0cm[]

Calibration storage (PropertiesService):
    Key:   WTR_v10_<cityKey>_<yyyy-MM-dd>
    Value: JSON { actual: { maxTemp, minTemp, rain, aqi, aqiType, weatherCode }, snapshots: [{ daysBeforeDDay, recordedOn, predictedMax, predictedRain, predictedAqi }] }
```

### Storage lifecycle

- **Writes**: every `syncWeatherToCalendar` run, for every location+date (D-5 through D+30)
- **Snapshot cap**: 5 per `(cityKey, date)` — keeps `snapshots[0]` (earliest) + `snapshots.slice(-4)` (4 most recent)
- **Retention**: 45 days; `cleanupOldStorageKeys` sweeps keys where the date part is older than cutoff
- **Calibration**: once a day becomes historical (past days data arrives), `reconcileGroundTruth` fills `record.actual`

### AQI engine

Priority: **European AQI** (EAQI) first → fallback to **US EPA AQI** (USAQI) → `null` if neither is available. Type is tracked per-day so the dashboard shows which scale was used.

### Ensemble variance

```javascript
// Correct (Pass 1 fix):
const meanMax = maxVals.reduce((a, b) => a + b, 0) / maxVals.length;  // unrounded
currentMax = Math.round(meanMax);  // round only for display
const variance = maxVals.reduce((a, b) => a + Math.pow(b - meanMax, 2), 0) / maxVals.length;
// Wrong (before Pass 1):
const variance = maxVals.reduce((a, b) => a + Math.pow(b - currentMax, 2), 0) / maxVals.length;
// Using a quantized mean shrinks every squared deviation toward zero.
```
