# Tests for meteo-ics

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
   - Run with `action=metrics` (iCal endpoint)
   - Expected: `tempMAE` and `rainMAE` show real values after verification

### icalweather.gs

1. **City-only parameter**:
   - Open: `?cities=Brunnsum`
   - Expected: valid .ics with weather for Brunnsum
   - Expected: HTTP 200 with `Content-Type: text/calendar`

2. **Mixed parameters**:
   - Open: `?cities=London,Edinburgh&unit=fahrenheit&days=14&lang=de`
   - Expected: 14-day .ics with Fahrenheit temps, German descriptions

3. **Malformed city name**:
   - Open: `?cities=XYZNonExistentCity123`
   - Expected: graceful fallback, no crash

4. **Max cities limit**:
   - Open: `?cities=London,Paris,Berlin,Tokyo,Sydney`
   - Expected: processes first 4 cities, ignores excess

5. **Status endpoint**:
   - Open: `?action=status`
   - Expected: JSON with `status`, `timestamp`, `accuracyMetrics`

## Regression Checklist

- [ ] `gcalweather.gs` loads without error in Apps Script editor
- [ ] `icalweather.gs` loads without error in Apps Script editor
- [ ] No `ReferenceError` on `geocodeCity` in gcalweather.gs
- [ ] All template literals use backticks, not single quotes
- [ ] All emoji glyphs render correctly in calendar event titles
- [ ] `.ics` output conforms to RFC 5545 (line folding, CRLF)
- [ ] No API key required — all data sources are open/free
