/**
 * icalweather.gs — Production Configuration & URL Guide
 * 
 * This script is deployed as a Google Apps Script Web App.
 * Users subscribe via URL parameters — no code changes needed per user.
 * 
 * ============================================================
 * DEPLOYMENT STEPS
 * ============================================================
 * 
 * 1. Create new Apps Script project at script.google.com
 * 2. Paste icalweather.gs content
 * 3. Deploy → New deployment → Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone (or "Anyone with link" for privacy)
 * 4. Copy the deployment URL (format: https://script.google.com/macros/s/DEPLOYMENT_ID/exec)
 * 5. Share custom URLs with users (see examples below)
 * 
 * ============================================================
 * URL PARAMETERS — Build custom URLs per user
 * ============================================================
 * 
 * Base URL: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
 * 
 * REQUIRED (at least one):
 *   cities=City1,City2,City3,City4          // Auto-geocoded (max 4)
 *   locations=Name:lat:lon,Name:lat:lon     // Explicit coords (max 4)
 *   lat=52.37&lon=4.90&name=Amsterdam       // Single location
 * 
 * OPTIONAL:
 *   unit=celsius|fahrenheit                 // Default: celsius
 *   days=1-30                               // Default: 30
 *   lang=en|zh|hi|es|fr|ar|de|nl            // Default: en
 *   hazards=true|false                      // Default: true (road alerts ≤7°C)
 *   aqProvider=auto|openaq|waqi             // Default: auto
 *   aqRadius=1-100                          // Default: 25 (OpenAQ radius km)
 *   dryRun=true|false                       // Default: false (returns ICS)
 *   action=status|metrics                   // Returns JSON diagnostics
 * 
 * ============================================================
 * EXAMPLE URLS — Copy and customize
 * ============================================================
 * 
 * # Netherlands (Dutch, 30 days)
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?cities=Amsterdam,Rotterdam,Utrecht,Den%20Haag&lang=nl&days=30
 * 
 * # US Cities (Fahrenheit, 14 days)
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?cities=New%20York,Chicago,Los%20Angeles,Seattle&unit=fahrenheit&days=14
 * 
 * # UK + Ireland (English, hazards off)
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?cities=London,Edinburgh,Dublin,Belfast&hazards=false
 * 
 * # Explicit coordinates (bypasses geocoder)
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?locations=Tokyo:35.6762:139.6503,Osaka:34.6937:135.5023&lang=ja
 * 
 * # Single location with all options
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?lat=51.5074&lon=-0.1278&name=London&unit=celsius&days=30&lang=en&hazards=true&aqProvider=auto
 * 
 * # Diagnostics endpoint (JSON)
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?action=status
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?action=metrics
 * 
 * # Preview as plain text (no calendar subscription)
 * https://script.google.com/macros/s/DEPLOYMENT_ID/exec?cities=Paris&dryRun=true
 * 
 * ============================================================
 * SUBSCRIPTION INSTRUCTIONS FOR USERS
 * ============================================================
 * 
 * Apple Calendar (iOS): Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar
 * Apple Calendar (macOS): File → New Calendar Subscription (⌥⌘S)
 * Google Calendar (Web): Other calendars (+) → From URL (refreshes ~6-12 hrs)
 * Outlook (Web/App): Calendar → Add calendar → Subscribe from web
 * Thunderbird: File → New → Calendar → On the Network → iCalendar (ICS)
 * 
 * IMPORTANT: Always SUBSCRIBE to the URL — never download the .ics file.
 * Updates arrive automatically on the calendar app's refresh schedule.
 * 
 * ============================================================
 * SCRIPT PROPERTIES — Set in Apps Script UI: Project Settings → Script Properties
 * ============================================================
 * 
 * Key                     | Value                          | Required?
 * ------------------------|--------------------------------|----------
 * NEWS_API_KEY            | your_newsapi_org_key           | No (today's weather headlines)
 * WAQI_PASSPHRASE         | YourStrongPassphrase123!       | No (enables WAQI global AQI)
 * AQ_CAP_PROBE_LAT        | 50.95                          | No (custom AQ probe location)
 * AQ_CAP_PROBE_LON        | 5.97                           | No (custom AQ probe location)
 * 
 * ============================================================
 * WAQI TOKEN SETUP (for global AQI outside EU/US)
 * ============================================================
 * 
 * 1. Get free token from https://aqicn.org/api/
 * 2. In Apps Script console, run:
 *    waqiTokenSave("your_waqi_token_here", "YourStrongPassphrase123!");
 * 3. Set Script Property: WAQI_PASSPHRASE = "YourStrongPassphrase123!"
 * 
 * The token is AES-encrypted and stored in Google Drive (file: waqi_token.enc).
 * Collaborators with editor access CANNOT read the token.
 * 
 * ============================================================
 * CUSTOMIZING DEFAULTS (edit ICAL_CONFIG in icalweather.gs)
 * ============================================================
 * 
 * const ICAL_CONFIG = {
 *   calendarName: "Weather & Celestial Feed",
 *   version: "2.4.1",
 *   temperatureUnit: "celsius",        // Default if unit not in URL
 *   forecastDays: 30,                  // Max if days not in URL
 *   deterministicDays: 14,             // Must be ≤16 (Open-Meteo limit)
 *   minForecastDays: 1,
 *   maxForecastDays: 30,
 *   maxCities: 4,                      // Hard limit (quota protection)
 *   defaultLang: "en",
 *   hazardsEnabled: true
 * };
 * 
 * ============================================================
 * MONITORING & DEBUGGING
 * ============================================================
 * 
 * View logs: Apps Script → Executions (filter by deployment)
 * Status endpoint: ?action=status returns JSON with:
 *   - scriptVersion, configHealth (deterministicDays cap check)
 *   - model accuracy (temp MAE, rain MAE, reliability grade)
 *   - AQI engine state (active provider, Open-Meteo AQ cap)
 *   - WAQI token status
 * 
 * Common issues:
 * - "Max 4 cities" → Reduce cities/locations in URL
 * - "Empty calendar" → Check geocoder (use explicit locations=)
 * - "No AQI data" → Set up WAQI token or check aqProvider
 * - "Timeout" → Reduce days or cities; check circuit breaker logs
 */