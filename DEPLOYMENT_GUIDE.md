# meteo-ics — Production Deployment Guide

**Version:** 2.4.0  
**Test Status:** 322/322 passing | Structural balance: OK | Cross-file collisions: 0

---

## Quick Start — Choose Your Path

| Goal | Script | Output |
|------|--------|--------|
| Personal Google Calendar with **color-coded events** | `gcalweather.gs` | Events in your Google Calendar |
| Shareable subscription for **family/team** | `icalweather.gs` | `.ics` feed URL (Apple/Google/Outlook) |

---

## Path A: gcalweather.gs — Personal Color-Coded Calendar

### 1. Create Apps Script Project
```
1. Go to https://script.google.com
2. New Project → Name: "Weather Calendar Sync"
3. Delete default Code.gs
4. Paste entire gcalweather.gs content
5. Save (Ctrl+S)
```

### 2. Configure Your Locations
Edit the `CONFIG` object (lines 429-446) with your cities:

```javascript
const CONFIG = {
  calendarId: "",                    // "" = auto-create "Weather Forecast"
  calendarName: "Weather Forecast",
  temperatureUnit: "celsius",
  forecastDays: 30,
  deterministicDays: 14,
  historyDays: 5,
  autoDetectFromEvents: true,
  dryRun: false,
  aqProvider: "auto",
  aqRadius: 25,
  language: "en",
  locations: [
    { name: "Amsterdam", country: "NL" },
    { name: "Rotterdam", country: "NL" },
    { name: "Utrecht", country: "NL" }
  ]
};
```

**Location formats supported:**
```javascript
{ name: "City" }                              // Auto-geocoded
{ name: "City", country: "US" }               // Disambiguated
{ name: "City", lat: 52.37, lon: 4.90 }       // Explicit coords
```

### 3. Optional: Enable Breaking News & Global AQI
In Apps Script UI: **Project Settings (⚙) → Script Properties**

| Property | Value | Purpose |
|----------|-------|---------|
| `NEWS_API_KEY` | Your NewsAPI.org key | Today's weather headlines |
| `WAQI_PASSPHRASE` | `YourStrongPassphrase123!` | Enables WAQI (global AQI) |

**WAQI Setup (one-time):**
```javascript
// Run once in Apps Script console (Ctrl+Enter):
waqiTokenSave("your_waqi_token_from_aqicn.org", "YourStrongPassphrase123!");
```

### 4. First Run (Bootstrap)
```javascript
// In Apps Script editor, run this function:
syncWeatherToCalendar()
```
- Creates "Weather Forecast" calendar (if `calendarId: ""`)
- Populates 30 days of color-coded events
- Check Execution log for any errors

### 5. Add Daily Trigger
```
1. Triggers (clock icon) → Add Trigger
2. Function: syncWeatherToCalendar
3. Event source: Time-driven
4. Type: Day timer
5. Time: 06:00–07:00 AM
6. Save
```

### 6. Verify Colors Work
Open your "Weather Forecast" calendar — events show:
- 🔵 **Blue** (≤0°C) — Freezing
- 💙 **Cyan** (1-10°C) — Cold
- 💚 **Green** (11-20°C) — Cool
- 💛 **Yellow** (21-26°C) — Mild
- 🧡 **Orange** (27-32°C) — Warm
- ❤️ **Red** (33°C+) — Hot
- ⚫ **Gray** — Ensemble (D15+) forecasts

---

## Path B: icalweather.gs — Multi-User ICS Feed

### 1. Create Apps Script Project
```
1. Go to https://script.google.com
2. New Project → Name: "Weather ICS Feed"
3. Delete default Code.gs
4. Paste entire icalweather.gs content
5. Save (Ctrl+S)
```

### 2. Deploy as Web App
```
1. Deploy → New deployment
2. Type: Web App (select from gear icon)
3. Execute as: Me
4. Who has access: Anyone (or "Anyone with link")
5. Deploy → Copy the URL
```
**URL format:** `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`

### 3. Build Custom URLs Per User
Each user gets their own subscription URL with parameters:

| Parameter | Example | Description |
|-----------|---------|-------------|
| `cities` | `cities=Amsterdam,Rotterdam` | Auto-geocode (max 4) |
| `locations` | `locations=Tokyo:35.6762:139.6503` | Explicit coords |
| `unit` | `unit=fahrenheit` | °C or °F |
| `days` | `days=14` | 1-30 forecast window |
| `lang` | `lang=nl` | en, zh, hi, es, fr, ar, de, nl |
| `hazards` | `hazards=false` | Disable road alerts |
| `aqProvider` | `aqProvider=openaq` | Force AQI source |

**Example URLs:**
```
# Netherlands (Dutch)
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?cities=Amsterdam,Rotterdam,Utrecht,Den%20Haag&lang=nl&days=30

# US Cities (Fahrenheit)
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?cities=New%20York,Chicago,Los%20Angeles,Seattle&unit=fahrenheit&days=14

# Explicit coordinates (bypass geocoder)
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?locations=Tokyo:35.6762:139.6503,Osaka:34.6937:135.5023&lang=ja

# Diagnostics
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?action=status
```

### 4. Share URLs with Users
Users subscribe in their calendar app:
- **Apple Calendar:** Settings → Calendar → Add Subscribed Calendar
- **Google Calendar:** Other calendars (+) → From URL
- **Outlook:** Calendar → Add calendar → Subscribe from web
- **Thunderbird:** File → New → Calendar → On the Network → iCalendar

**⚠️ Critical:** Subscribe to the URL — never download the .ics file.

---

## Optional: WAQI Token for Global AQI

**Required for:** Africa, South America, South/Southeast Asia, Pacific Islands (outside CAMS/EPA coverage)

```
1. Get free token: https://aqicn.org/api/
2. In Apps Script console (both scripts):
   waqiTokenSave("your_token", "YourStrongPassphrase123!");
3. Set Script Property: WAQI_PASSPHRASE = "YourStrongPassphrase123!"
```

Token is AES-encrypted to Drive (`waqi_token.enc`). Editors cannot read it.

---

## Monitoring & Debugging

### View Execution Logs
Apps Script → **Executions** (filter by deployment)

### Status Endpoint (icalweather.gs)
```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?action=status
```
Returns JSON with:
- `scriptVersion`, `configHealth` (deterministicDays ≤16 check)
- `modelAccuracy`: temp MAE, rain MAE, reliability grade
- `airQuality`: active provider, Open-Meteo AQ cap, WAQI token status
- `circuitBreakers`: state of all 7 circuits

### Dry Run Preview (both scripts)
```
# gcalweather: set CONFIG.dryRun = true, run syncWeatherToCalendar()
# icalweather: append ?dryRun=true to any URL
```
Returns plain text preview — no calendar writes.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Max 4 cities" | URL has >4 cities | Reduce cities/locations |
| Empty calendar | Geocoder failed | Use explicit `locations=Name:lat:lon` |
| No AQI data | Outside CAMS/EPA | Set up WAQI token |
| Timeout (6 min) | Too many cities/days | Reduce `days` or cities; check circuit logs |
| "NaN°C" in title | Open-Meteo data gap | Auto-handled (shows 0°C fallback) |
| Events not updating | Calendar app cache | Google: 6-12 hrs; Apple: set to Hourly |

---

## Architecture Highlights (Why It's Reliable)

| Feature | Implementation |
|---------|----------------|
| **Circuit Breakers** | 7 circuits (openmeteo, wikipedia, newsapi, openaq, waqi, timezone, geocoder) — 3 failures → 30s cooldown → half-open test |
| **Retry Logic** | 3 attempts, exponential backoff + jitter for 429/502/503/504 |
| **Execution Budget** | Hard abort at 5m45s (15s margin under 6-min limit) |
| **Timezone Safety** | All dates UTC-anchored (`T00:00:00Z`, `Date.UTC()`) — no drift |
| **NaN Immunity** | `Number.isFinite()` guards on ALL arithmetic |
| **Fallback Coords** | 427 cities built-in — works even if geocoder down |
| **AQI Cascade** | CAMS → EPA → OpenAQ → WAQI (auto) |
| **Deduplication** | Keyed `[KEY:YYYY-MM-DD_city]` + orphan sweep |
| **Storage** | PropertiesService, 45-day retention, 5 snapshots/day |

---

## File Checklist

```
meteo-ics/
├── gcalweather.gs              # Google Calendar sync (color events)
├── icalweather.gs              # ICS feed generator (multi-user)
├── CONFIG.gcalweather.example.js   # Your config template
├── CONFIG.icalweather.example.js   # URL building guide
├── DEPLOYMENT_GUIDE.md         # This file
├── tests/
│   ├── run_tests.py            # 322 tests (run: python tests/run_tests.py)
│   └── lint_balance.py         # Structural balance check
├── CHANGELOG.md                # Full history
├── OVERVIEW.md                 # Engineering overview
└── README.md                   # User-facing docs
```

---

## Verification Commands

```bash
# Full test suite (322 tests)
cd meteo-ics && python tests/run_tests.py
# Expected: Passed: 322, Failed: 0

# Structural balance (braces/parens/brackets)
python tests/lint_balance.py
# Expected: OK on both files, 0 cross-file collisions

# Manual smoke test
# gcalweather: Run syncWeatherToCalendar() with dryRun: true
# icalweather: Visit ?cities=Amsterdam&dryRun=true
```

---

## Security Notes

- **No secrets in code** — API keys in Script Properties only
- **WAQI token encrypted** — AES-256 in Drive, passphrase in Script Properties
- **Web App access** — "Anyone" = public URL; "Anyone with link" = unguessable URL
- **No user data stored** — Only forecast snapshots in PropertiesService (45-day TTL)
- **CORS safe** — Web App returns proper Content-Type headers

---

## Support

- **Issues:** https://github.com/neohiro/meteo-ics/issues
- **Changelog:** CHANGELOG.md
- **Architecture:** OVERVIEW.md
- **User docs:** README.md (multi-language)