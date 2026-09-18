/**
 * gcalweather.gs — Production Configuration
 * 
 * Copy this to your Apps Script project and modify the CONFIG block in gcalweather.gs
 * Or paste the CONFIG object directly into gcalweather.gs (lines 429-446)
 */

const PRODUCTION_CONFIG = {
  // ============================================================
  // REQUIRED — Set these before first run
  // ============================================================
  
  // Google Calendar ID to write events to.
  // "" (empty string) = auto-create calendar named "Weather Forecast" on first run
  // To use existing calendar: "your_calendar_id@group.calendar.google.com"
  calendarId: "",
  
  // Name of calendar to auto-create if calendarId is empty
  calendarName: "Weather Forecast",
  
  // Your locations — auto-geocoded via Open-Meteo
  // Max 10 recommended (API quota). Each entry can be:
  //   { name: "City" }                              // auto-geocoded
  //   { name: "City", country: "US" }               // disambiguated
  //   { name: "City", lat: 52.37, lon: 4.90 }       // explicit coords
  locations: [
    { name: "Amsterdam", country: "NL" },
    { name: "Rotterdam", country: "NL" },
    { name: "Utrecht", country: "NL" }
  ],
  
  // ============================================================
  // OPTIONAL — Adjust to your preferences
  // ============================================================
  
  // Temperature unit: "celsius" or "fahrenheit"
  temperatureUnit: "celsius",
  
  // Forecast window: 1-30 days (deterministic: 1-14, ensemble: 15-30)
  forecastDays: 30,
  
  // Deterministic forecast days (max 16 — Open-Meteo hard limit)
  deterministicDays: 14,
  
  // Historical verification window: past days to reconcile ground truth
  historyDays: 5,
  
  // Auto-detect locations from existing calendar events (fallback if locations empty)
  autoDetectFromEvents: true,
  
  // Dry run: true = log events only, no calendar writes
  dryRun: false,
  
  // Air quality provider: "auto" (CAMS→OpenAQ→WAQI), "openaq", "waqi"
  aqProvider: "auto",
  
  // OpenAQ station search radius in km (1-100)
  aqRadius: 25,
  
  // Display language: en, zh, hi, es, fr, ar, de, nl
  language: "en",
  
  // ============================================================
  // ADVANCED — Rarely need to change
  // ============================================================
  
  // Script version (auto-updated on deploy)
  version: "2.4.1"
};


/**
 * SCRIPT PROPERTIES — Set these in Apps Script UI: Project Settings → Script Properties
 * 
 * Key                     | Value                          | Required?
 * ------------------------|--------------------------------|----------
 * NEWS_API_KEY            | your_newsapi_org_key           | No (breaking news)
 * WAQI_PASSPHRASE         | YourStrongPassphrase123!       | No (enables WAQI)
 * AQ_CAP_PROBE_LAT        | 50.95                          | No (custom AQ probe)
 * AQ_CAP_PROBE_LON        | 5.97                           | No (custom AQ probe)
 * 
 * WAQI TOKEN SETUP (run once in Apps Script console):
 *   waqiTokenSave("your_waqi_token", "YourStrongPassphrase123!");
 *   // Then set WAQI_PASSPHRASE = "YourStrongPassphrase123!" in Script Properties
 */


/**
 * DEPLOYMENT TRIGGER — Add after first successful run:
 * 
 * 1. Open Apps Script project
 * 2. Click Triggers (clock icon) → Add Trigger
 * 3. Function: syncWeatherToCalendar
 * 4. Event source: Time-driven
 * 5. Type: Day timer
 * 6. Time: 06:00-07:00 AM (your local timezone)
 * 7. Save
 * 
 * This runs daily at 6 AM to refresh forecasts and reconcile past days.
 */


/**
 * FIRST RUN CHECKLIST:
 * 
 * [ ] Set locations array above
 * [ ] (Optional) Set NEWS_API_KEY in Script Properties
 * [ ] (Optional) Set up WAQI token for global AQI
 * [ ] Run syncWeatherToCalendar() manually once
 * [ ] Verify "Weather Forecast" calendar created with events
 * [ ] Add daily trigger (06:00-07:00)
 * [ ] Verify events have colored titles (temp-based)
 * [ ] Check event descriptions have full dashboard
 */