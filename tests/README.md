# Tests for meteo-ics

## Automated Tests

Run the Python test suite (requires Python 3.8+):

```bash
python tests/run_tests.py
```

Expected output: **149 passed, 0 failed**.

The suite covers:
- **URL parameter parsing**: `clamp`, `normalizeLang`, `parseBoolParam` (8 supported languages, defaults, coercion)
- **Moon phase**: UTC-reference calculation, correct synodic-month phase boundaries, pre-1970 safety, 8-phase boundary midpoints
- **Weather glyph**: all major WMO codes, null/NaN guard
- **Golden hour window**: hour-crossing logic, NaN guard, sentinel values
- **ICS escape + folding**: RFC 5545 CRLF, special-character escaping, octet-count folding for UTF-8
- **gcalweather.gs**: 22 source-code checks (resolveCalendar throws, CONFIG.dryRun, FETCH_TIMEOUT_MS, ASTRONOMICAL_EVENTS hoisted, moon UTC fix, boundaries, geocode null-return, whitespace trim, per-city try/catch, NaN audit guard, verifiedDays in accuracy metrics, config version, norm() hardened, isValidLatLon helper, tgtDateObj UTC, aggregates UTC, buildDashboardPayload past-day null guard, moon formula balanced parens, meteor peak regex, reconcileGroundTruth UTC anchor, dead getAstronomicalEvents removed, generatePrioritizedAdvices null-guard, null-temp guard, fetch logs failures)
- **icalweather.gs**: 25 source-code checks (all 4 new URL params, SUPPORTED_LANGS, ADVICE_TEXTS, adv() helper, escapeIcsText RFC fix, foldIcsLines octet-count, moon UTC fix, getAstronomicalEventsForYear, assessRoadConditions/StargazingConditions lang-param, 5 helper lang-param, buildReadme, X-WR-LANG, status supportedLanguages, config version, norm() hardened, isValidLatLon helper, MAX_INPUT_LEN cap, cleanupOldStorageKeys strict date, computeDayAudit snapshotsTaken, X-WR-CALDESC, saveDayRecord try/catch, AQI poor threshold at 40, moon formula balanced parens, parseLocationsFromParams array-safe, doGet unitParam string-coerced, meteor peak regex, smoke tests)
- **RFC 5545**: VCALENDAR/VEVENT structure, PRODID format, CRLF line endings
- **Integration**: doGet/generateIcsFeed parameter flow, per-city error isolation, AQI type priority (EAQI before USAQI), 4-city limit + dedup, gcalweather dryRun, AQI staleness safety, calendar write try/catch
- **Code quality**: no duplicate function defs, no dead code, advice priority ordering, PRODID RFC compliance
- **Translation completeness**: all 25 advice keys in all 8 languages, T_L/T_SEC all expected keys, SUPPORTED_LANGS order

---

## Manual Integration Tests

### gcalweather.gs

1. **Location geocoding** (city-only config):
   - Set `locations: [{ name: "Brunnsum" }]` — no lat/lon
   - Run `syncWeatherToCalendar()`
   - Expected: script auto-geocodes "Brunnsum" via Open-Meteo and fetches weather data
   - Expected: calendar events appear with correct coordinates

2. **Country hint geocoding**:
   - Set `locations: [{ name: "Cambridge", country: "UK" }]`
   - Expected: resolves to Cambridge, UK (not Cambridge, US)

3. **Dynamic location from calendar events**:
   - Set `autoDetectFromEvents: true`
   - Create a calendar event with location "Tokyo, Japan"
   - Run `syncWeatherToCalendar()`
   - Expected: weather events created for Tokyo automatically

4. **Road hazard auto-trigger**:
   - Set a location with T_min ≤ 7°C forecast
   - Run `syncWeatherToCalendar()`
   - Expected: "🚗 ROAD SAFETY" section appears in event description

5. **AQI availability**:
   - EU location (e.g., "Paris") → European AQI displayed
   - US location (e.g., "New York") → US EPA AQI displayed
   - Non-EU/US location (e.g., "Tokyo") → raw pollutant data or "Monitoring"

6. **Model accuracy tracking**:
   - Run script daily for 7+ days
   - Run with `action=status` (iCal endpoint)
   - Expected: `tempMAE` and `rainMAE` show real values after verification

7. **dryRun mode**:
   - Set `CONFIG.dryRun = true` in gcalweather.gs
   - Run `syncWeatherToCalendar()`
   - Expected: logs payloads without creating/modifying calendar events

8. **resolveCalendar error message**:
   - Set `CONFIG.calendarId = "nonexistent-id"` and run
   - Expected: clear error explaining the problem (not a cryptic null-pointer crash)

### icalweather.gs

1. **City-only parameter**:
   - Open: `?cities=Brunnsum`
   - Expected: valid .ics with weather for Brunnsum
   - Expected: HTTP 200 with `Content-Type: text/calendar`

2. **Mixed parameters (new)**:
   - Open: `?cities=London,Edinburgh&unit=fahrenheit&days=14&lang=de`
   - Expected: 14-day .ics with Fahrenheit temps, German descriptions
   - `days` param: clamped to 1–30

3. **All 8 languages**:
   - Test `&lang=zh`, `&lang=hi`, `&lang=es`, `&lang=fr`, `&lang=ar`, `&lang=de`, `&lang=nl`
   - Expected: translated section headers, labels, road safety, model status
   - Arabic (`ar`) should render right-to-left

4. **hazards=false suppresses road safety**:
   - Open: `?cities=London&hazards=false`
   - Expected: no road safety section in event descriptions

5. **dryRun=true preview mode**:
   - Open: `?cities=London&dryRun=true`
   - Expected: plain-text weather preview, no ICS output

6. **Malformed city name (per-city isolation)**:
   - Open: `?cities=London,XYZNonExistentCity123,Paris`
   - Expected: London and Paris succeed; error logged for XYZ; no crash

7. **Max cities limit**:
   - Open: `?cities=London,Paris,Berlin,Tokyo,Sydney`
   - Expected: processes first 4 cities, ignores excess

8. **Status endpoint (enhanced)**:
   - Open: `?action=status`
   - Expected: JSON with `status`, `timestamp`, `accuracyMetrics`, `supportedLanguages`, `endpoints`

9. **Moon phase UTC accuracy**:
   - The moon phase no longer depends on host server timezone
   - A specific date (e.g., 2024-06-21) should give the same moon phase regardless of where the script runs

10. **Astronomical events year-aware**:
    - 2026 meteor showers should be labeled "(2026)"
    - Year transitions correctly

## Regression Checklist

- [ ] `gcalweather.gs` loads without error in Apps Script editor
- [ ] `icalweather.gs` loads without error in Apps Script editor
- [ ] No `ReferenceError` on `geocodeCity` in gcalweather.gs
- [ ] All template literals use backticks, not single quotes
- [ ] All emoji glyphs render correctly in calendar event titles
- [ ] `.ics` output conforms to RFC 5545 (line folding, CRLF, UTF-8 octet count)
- [ ] No API key required — all data sources are open/free
- [ ] `resolveCalendar` throws actionable error (not auto-creates calendar)
- [ ] Per-city fetch failures are isolated — one bad city doesn't crash the feed
- [ ] Moon phase consistent regardless of Apps Script host timezone
- [ ] Astronomical events show year qualifier for date-dependent events
