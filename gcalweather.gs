/**
 * Ultimate Personalized Weather, Astronomical & Ground-Truth Dashboard for Google Calendar
 *
 * Verified & Bulletproof:
 *  - City-name geocoding: locations can be configured with name only (no lat/lon required).
 *    Optional 'country' field narrows the geocoder query.
 *  - Road condition advisory triggered at min temp <= 7°C with surface glaze & black ice detection.
 *  - Clean single empty line (\n\n) separation between all category cards.
 *  - Global AQI Engine: Automatic fallback between European AQI (0-100), US EPA AQI (0-500),
 *    OpenAQ (200+ countries, free, no key), and WAQI (1000+ stations, token-optional).
 *    The calendar event description labels which provider supplied the AQI (Open-Meteo / OpenAQ / WAQI).
 *  - 100% Guaranteed Deduplication: Keyed with [KEY:YYYY-MM-DD_city] + orphaned event sweep.
 *  - Timezone Drift Immunity: UTC-anchored date keys (T00:00:00Z / Date.UTC) match Open-Meteo's UTC date strings, so server timezone never misclassifies past vs future days.
 *  - Continuous 7-Day Aggregates: Seamless date-key bridging between Deterministic (<14d) and Ensemble (14d+) datasets.
 *  - Official EventColor Enum: Reliable temperature-based dynamic color coding.
 *  - Standard Atmosphere (atm) pressure scale (1013.25 hPa baseline).
 *  - Parallel HTTP API fetches via UrlFetchApp.fetchAll with explicit 10s timeouts and
 *    per-endpoint selective retry (3 attempts, exponential backoff) for 429/502/503/504.
 *  - Execution-budget guard: sync aborts at 5 min 45 s to leave a 15 s margin under
 *    the 6-min Apps Script limit, preventing partial calendar writes.
 *  - Drive-encrypted WAQI token store: token AES-encrypted to Drive with a passphrase
 *    stored in ScriptProperties — collaborators with editor access cannot read the token.
 *    Migration path: waqiTokenSave(token, passphrase) + set WAQI_PASSPHRASE in
 *    ScriptProperties; waqiTokenResolve() prefers Drive-encrypted, falls back to legacy
 *    ScriptProperties for back-compat. Passphrase validated: ≥12 chars, ≥2 of
 *    lower/upper/digit, no 6+ repeated chars.
 *  - Calendar resolution: resolveCalendar() auto-creates the configured calendar
 *    if missing (first-run bootstrap). Calendar-by-id path still throws if the
 *    explicit id is invalid (caller misconfiguration, not recoverable by auto-create).
 *  - Storage cleanup gracefully falls back to UTC if calendar resolution fails.
 *  - Empty CONFIG.locations (post-geocoding) raises a clear, actionable error.
 *  - ASTRONOMICAL_EVENTS hoisted to a module-level const for fast lookup across hot paths.
 *  - CONFIG.dryRun = true skips all calendar writes (log-only mode for validation).
 *  - saveDayRecord() defensively catches JSON.stringify failures (won't crash the sync).
 *  - cleanupOldStorageKeys() validates YYYY-MM-DD format before comparison.
 *  - computeDayAudit() surfaces snapshotsTaken count for self-debugging.
 *  - norm() safely handles null/undefined/Number inputs.
 *  - assessRoadConditions(), getEventColorEnum(), getThermalText(), getAqiLabel() guard null/NaN inputs.
 *  - buildDashboardPayload() returns null on null-temperature_2m_max (no NaN in event title).
 *  - generatePrioritizedAdvices() falls back to safe defaults for null ctx.tempMax/Min.
 *  - fetchAllAtmosphericDataParallel() logs non-200 responses per endpoint (no silent drops).
 *  - Ensemble key lists hoisted out of per-day loops in buildDashboardPayload + aggregates.
 *  - AQI Scale Display: every AQI line shows the reference scale (e.g. '42/100 EAQI', '88/500 USAQI') for instant interpretability.
 *  - Event structure: actionable advice rendered BEFORE model audit so users see guidance first, methodology second.
 *  - SOURCES footer on every event listing data providers, so operators can audit which upstream API fed each value.
 *
 * Location Config Example:
 *   locations: [
 *     { name: "Brunssum" },                          // auto-geocoded via Open-Meteo
 *     { name: "Cambridge", country: "UK" },          // disambiguated by country
 *     { name: "Kyoto", lat: 35.0116, lon: 135.7681 } // explicit coords still supported
 *   ]
 */

function geocodeCity(name) {
  try {
    const res = UrlFetchApp.fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&format=json`,
      { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS }
    );
    const data = JSON.parse(res.getContentText()).results;
    if (data && data.length) {
      return { name: data[0].name, lat: data[0].latitude, lon: data[0].longitude };
    }
  } catch (e) {}
  return null;
}

const CONFIG = {
  calendarId: "",
  calendarName: "Weather Forecast",
  version: "2.2.0",
  temperatureUnit: "celsius",
  forecastDays: 30,
  deterministicDays: 14,
  historyDays: 5,
  autoDetectFromEvents: true,
  dryRun: false,
  aqProvider: "auto",
  aqRadius: 25,
  locations: [
    { name: "Kyoto" },
    { name: "Brunssum" }
  ]
};

const KEY_REGEX = /\[KEY:([a-zA-Z0-9_\-]+)\]/;
const MAX_SNAPSHOTS_PER_DAY = 5;
const FETCH_TIMEOUT_MS = 10000;
const FETCH_MAX_RETRIES = 3;
const FETCH_RETRY_CODES = new Set([429, 502, 503, 504]);
const DRIVE_WAQI_FILE = "waqi_token.enc";
const APPS_SCRIPT_BUDGET_MS = 345000;
const BUDGET_WARN_AT_MS = [240000, 300000];

let _fetchAllImpl = UrlFetchApp.fetchAll.bind(UrlFetchApp);
let _nowOverride = null;
const _now = () => _nowOverride !== null ? _nowOverride : Date.now();

const { budgetStart, checkBudget } = (() => {
  const APPS_SCRIPT_BUDGET_MS = 345000;
  const BUDGET_WARN_AT_MS = [240000, 300000];
  let _budgetWarnedAt = new Set();
  return {
    budgetStart() {
      _budgetWarnedAt = new Set();
      return _now();
    },
    budgetSetNow(fn) {
      // Use Number.isFinite to reject NaN/Infinity — typeof NaN === "number"
      // is true, so a test passing budgetSetNow(NaN) would silently poison
      // every elapsed comparison and the budget check would never fire.
      _nowOverride = Number.isFinite(fn) ? fn : null;
    },
    checkBudget(startMs, label) {
      const elapsed = _now() - startMs;
      BUDGET_WARN_AT_MS.forEach(threshold => {
        if (elapsed >= threshold && !_budgetWarnedAt.has(threshold)) {
          _budgetWarnedAt.add(threshold);
          Logger.log(`BUDGET WARN — ${Math.round(elapsed / 1000)}s used in ${label}; ${Math.round((APPS_SCRIPT_BUDGET_MS - elapsed) / 1000)}s remaining`);
        }
      });
      if (elapsed >= APPS_SCRIPT_BUDGET_MS) {
        Logger.log("──── BUDGET EXCEEDED ────");
        Logger.log(`  label:  ${label}`);
        Logger.log(`  elapsed: ${Math.round(elapsed / 1000)}s`);
        Logger.log(`  limit:   ${Math.round(APPS_SCRIPT_BUDGET_MS / 1000)}s (5 min 45 s)`);
        Logger.log(`  margin:  15s under 6-min Apps Script execution limit`);
        Logger.log("─────────────────────────");
        throw new Error("Budget exceeded in " + label);
      }
    }
  };
})();

const { waqiTokenSave, waqiTokenLoad, waqiTokenResolve } = (() => {
  const DRIVE_WAQI_FILE = "waqi_token.enc";
  const WAQI_MIN_PASSPHRASE_LEN = 12;
  let _waqiTokenCache = null;
  let _waqiDecryptWarned = false;

  function validatePassphrase(pw) {
    if (typeof pw !== "string" || pw.length < WAQI_MIN_PASSPHRASE_LEN) {
      return "passphrase must be at least " + WAQI_MIN_PASSPHRASE_LEN + " characters";
    }
    if (/^[a-z]+$/.test(pw) || /^[A-Z]+$/.test(pw) || /^[0-9]+$/.test(pw)) {
      return "passphrase must contain at least two of: lowercase, uppercase, digits";
    }
    if (/(.)\1{5,}/.test(pw)) return "passphrase must not contain 6+ repeated characters";
    return null;
  }

  return {
    waqiTokenReset() {
      _waqiTokenCache = null;
      _waqiDecryptWarned = false;
    },
    waqiTokenSave(plaintextToken, passphrase) {
      if (!plaintextToken || !passphrase) throw new Error("waqiTokenSave: token and passphrase are required");
      const strengthErr = validatePassphrase(passphrase);
      if (strengthErr) throw new Error("waqiTokenSave: weak passphrase — " + strengthErr);
      const blob = Utilities.newBlob(plaintextToken, "text/plain", DRIVE_WAQI_FILE);
      const encrypted = Utilities.encrypt(blob, passphrase);
      const existing = DriveApp.getRootFolder().getFilesByName(DRIVE_WAQI_FILE);
      while (existing.hasNext()) existing.next().setTrashed(true);
      const file = DriveApp.getRootFolder().createFile(encrypted.setName(DRIVE_WAQI_FILE));
      PropertiesService.getScriptProperties().setProperty("WAQI_KEY_HINT", "stored");
      _waqiTokenCache = null;
      _waqiDecryptWarned = false;
      return file.getId();
    },
    waqiTokenLoad(passphrase) {
      const files = DriveApp.getRootFolder().getFilesByName(DRIVE_WAQI_FILE);
      if (!files.hasNext()) return null;
      const file = files.next();
      const decrypted = Utilities.decrypt(file.getBlob(), passphrase);
      return decrypted.getDataAsString();
    },
    waqiTokenResolve() {
      if (_waqiTokenCache !== null) return _waqiTokenCache;
      const passphrase = PropertiesService.getScriptProperties().getProperty("WAQI_PASSPHRASE") || "";
      if (passphrase) {
        try {
          const t = waqiTokenLoad(passphrase);
          if (t) { _waqiTokenCache = t; return t; }
        } catch (e) {
          if (!_waqiDecryptWarned) { _waqiDecryptWarned = true; Logger.log("waqiTokenResolve: Drive decrypt failed — " + e); }
        }
      }
      const legacy = PropertiesService.getScriptProperties().getProperty("WAQI_TOKEN") || "";
      if (legacy) {
        Logger.log("waqiTokenResolve: WAQI_TOKEN in ScriptProperties is deprecated — call waqiTokenSave() to migrate");
      }
      _waqiTokenCache = legacy;
      return legacy;
    }
  };
})();

function fetchAllWithRetry(requests) {
  const total = requests.length;
  const responses = new Array(total);
  let pending = requests.map((_, i) => i);
  let attempt = 0;
  while (attempt < FETCH_MAX_RETRIES && pending.length > 0) {
    attempt++;
    const batch = pending.map(i => requests[i]);
    const batchResponses = _fetchAllImpl(batch);
    const nextPending = [];
    batchResponses.forEach((res, j) => {
      const globalIdx = pending[j];
      const code = res.getResponseCode();
      const url = requests[globalIdx].url.slice(0, 80);
      responses[globalIdx] = res;
      if (code >= 400 && FETCH_RETRY_CODES.has(code) && attempt < FETCH_MAX_RETRIES) {
        Logger.log(`fetchAllWithRetry: HTTP ${code} — ${url} — retry ${attempt + 1}/${FETCH_MAX_RETRIES}`);
        nextPending.push(globalIdx);
      } else {
        if (code >= 400) Logger.log(`fetchAllWithRetry: HTTP ${code} — ${url} — giving up`);
      }
    });
    pending = nextPending;
    if (pending.length > 0 && attempt < FETCH_MAX_RETRIES) {
      Utilities.sleep(Math.pow(2, attempt) * 500);
    }
  }
  return responses;
}

const OPEN_METEO_AQ_FORECAST_DAYS_CAP = 7;
const OPENAQ_LATEST_ENDPOINT = "https://api.openaq.org/v3/latest";
const WAQI_BASE_ENDPOINT = "https://api.waqi.info/feed/geo:";
const _AQ_CAP_PROP = "AQ_CAP_PROBED_V1";

let _probedAqCap = null;

function getOpenMeteoAqCap() {
  if (_probedAqCap !== null) return _probedAqCap;
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(_AQ_CAP_PROP);
  if (cached !== null) {
    const parts = cached.split(",");
    if (parts.length === 2) {
      const cachedCap = parseInt(parts[0], 10);
      const cachedDay = parts[1];
      const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
      if (cachedDay === today && cachedCap >= 5 && cachedCap <= 16) {
        _probedAqCap = cachedCap;
        return _probedAqCap;
      }
    }
  }
  const detected = _probeOpenMeteoAqCap();
  _probedAqCap = detected;
  const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
  props.setProperty(_AQ_CAP_PROP, String(detected) + "," + today);
  return _probedAqCap;
}

function _probeOpenMeteoAqCap() {
  const PROBE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
  const PROBE_LAT = 50.95, PROBE_LON = 5.97;
  const lo = 5, hi = 16;
  let cap = OPEN_METEO_AQ_FORECAST_DAYS_CAP;
  const tryFetch = (days) => {
    try {
      const url = PROBE_URL + "?latitude=" + PROBE_LAT + "&longitude=" + PROBE_LON +
        "&hourly=european_aqi&forecast_days=" + days + "&timezone=auto";
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: 10000 });
      return res.getResponseCode();
    } catch (e) {
      return 0;
    }
  };
  let l = lo, r = hi;
  while (l <= r) {
    const mid = Math.floor((l + r) / 2);
    const code = tryFetch(mid);
    if (code === 200) {
      cap = mid;
      l = mid + 1;
    } else if (code >= 400) {
      r = mid - 1;
    } else {
      break;
    }
  }
  if (cap < OPEN_METEO_AQ_FORECAST_DAYS_CAP) {
    Logger.log("Open-Meteo AQ API cap probe: API returned HTTP " +
      "400 at forecast_days=" + OPEN_METEO_AQ_FORECAST_DAYS_CAP +
      " (hardcoded default). Detected cap: " + cap + ". " +
      "Update OPEN_METEO_AQ_FORECAST_DAYS_CAP to " + cap + " in both files.");
  }
  return cap;
}

const ASTRONOMICAL_EVENTS = {
  "01-03": "Quadrantid Meteor Peak (~110/hr)",
  "01-04": "Earth at Perihelion (Closest to Sun)",
  "03-20": "🌱 Vernal Equinox (Equal Day/Night)",
  "03-24": "Mercury at Greatest Eastern Elongation",
  "04-22": "Lyrid Meteor Peak (~18/hr)",
  "04-23": "Lyrid Active Window",
  "05-06": "Eta Aquariids Peak (~50/hr)",
  "05-07": "Eta Aquariids Active Window",
  "06-21": "☀️ Summer Solstice (Longest Day)",
  "07-04": "Earth at Aphelion (Furthest from Sun)",
  "07-28": "Delta Aquariids Peak (~20/hr)",
  "07-29": "Delta Aquariids Active Window",
  "08-12": "Perseid Meteor Peak (~100/hr)",
  "08-13": "Perseid Active Window",
  "08-27": "Saturn at Opposition (Brightest)",
  "09-19": "Neptune at Opposition",
  "09-22": "🍂 Autumnal Equinox (Equal Day/Night)",
  "10-07": "Draconid Meteor Peak (~10/hr)",
  "10-21": "Orionid Meteor Peak (~20/hr)",
  "10-22": "Orionid Active Window",
  "11-05": "Southern Taurids Peak (~5-10 fireball/hr)",
  "11-12": "Northern Taurids Peak (~5 fireball/hr)",
  "11-17": "Leonid Meteor Peak (~15/hr)",
  "11-18": "Leonid Active Window",
  "12-07": "Jupiter at Opposition (Brightest)",
  "12-13": "Geminid Meteor Ramp-up (~60/hr)",
  "12-14": "Geminid Meteor Peak (~120/hr)",
  "12-21": "❄️ Winter Solstice (Shortest Day)",
  "12-22": "Ursid Meteor Peak (~10/hr)"
};

// Drive-encrypted WAQI token store. Tokens are AES-encrypted with a per-user
// key derived from a passphrase stored in ScriptProperties (NEVER the token
// itself). This isolates the token from collaborators with editor access.
// State is encapsulated in a closure — no module-level lets that can collide
// with other scripts deployed in the same Apps Script project.

// Auto-geocode locations that lack GPS coordinates (city-only entries are resolved via Open-Meteo geocoder;
// "country" is an optional hint that narrows the search). Locations that fail geocoding are filtered out.
CONFIG.locations = CONFIG.locations.filter(loc => {
  if (loc.lat && loc.lon) return true;
  const trimmedName = (loc.name || "").trim();
  if (!trimmedName) {
    Logger.log(`WARNING: Skipping location with empty/whitespace name.`);
    return false;
  }
  const query = loc.country ? `${trimmedName},${loc.country}` : trimmedName;
  const geo = geocodeCity(query);
  if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && geo.name) {
    loc.lat = geo.lat;
    loc.lon = geo.lon;
    loc.name = geo.name;
    return true;
  }
  Logger.log(`WARNING: Skipping unresolvable location: "${trimmedName}". Run validateConfig() for details.`);
  return false;
});

if (CONFIG.locations.length === 0) {
  throw new Error(
    "CONFIG.locations resolved to an empty array — all locations failed geocoding. " +
    "Check city names or provide explicit { name, lat, lon } entries."
  );
}

function syncWeatherToCalendar() {
  const budget = budgetStart();
  Logger.log(`syncWeatherToCalendar: starting with ${CONFIG.locations.length} configured location(s) (dryRun=${CONFIG.dryRun})`);
  const cal = resolveCalendar();
  const primaryCal = CalendarApp.getDefaultCalendar();
  const calTz = cal.getTimeZone();
  const unitSymbol = CONFIG.temperatureUnit === "celsius" ? "°" : "°F";

  const now = new Date();
  const todayStr = Utilities.formatDate(now, calTz, "yyyy-MM-dd");
  const todayDate = Utilities.parseDate(todayStr + " 12:00:00", calTz, "yyyy-MM-dd HH:mm:ss");

  // 1. Build schedule (-historyDays to +forecastDays)
  const daySchedule = [];
  const locationPool = new Map();
  CONFIG.locations.forEach(loc => locationPool.set(norm(loc.name), loc));

  for (let d = -CONFIG.historyDays; d < CONFIG.forecastDays; d++) {
    checkBudget(budget, "day-loop d=" + d);
    const targetDate = new Date(todayDate.getTime() + d * 24 * 60 * 60 * 1000);
    const dayLocKeys = new Set(CONFIG.locations.map(l => norm(l.name)));

    if (CONFIG.autoDetectFromEvents && primaryCal) {
      primaryCal.getEventsForDay(targetDate).forEach(ev => {
        const rawLoc = ev.getLocation();
        if (isGeocodable(rawLoc)) {
          const city = rawLoc.split(",")[0].trim();
          const cityKey = norm(city);
          if (!locationPool.has(cityKey)) {
            const geo = geocodeCity(city);
            // geocodeCity returns null on failure; guard before property access.
            if (geo && geo.name) locationPool.set(cityKey, { ...geo, isDynamic: true });
          }
          if (locationPool.has(cityKey)) dayLocKeys.add(cityKey);
        }
      });
    }
    daySchedule.push({ date: targetDate, offset: d, locKeys: Array.from(dayLocKeys) });
  }

  // 2. Fetch atmospheric datasets in parallel across all locations
  checkBudget(budget, "pre-fetch");
  let weatherCache;
  try {
    weatherCache = fetchAllAtmosphericDataParallel(locationPool);
  } catch (e) {
    Logger.log("fetchAllAtmosphericDataParallel failed entirely: " + e);
    return; // Cannot proceed without any data
  }

  // 3. Reconcile verified ground truth & compute scorecards
  reconcileGroundTruth(locationPool, weatherCache);
  const globalStats = computeGlobalModelAccuracy(unitSymbol);

  // 4. Batch-index calendar events with signature fallback
  const windowStart = new Date(todayDate.getTime() - (CONFIG.historyDays + 3) * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(todayDate.getTime() + (CONFIG.forecastDays + 5) * 24 * 60 * 60 * 1000);
  const existingEvents = cal.getEvents(windowStart, windowEnd);

  const eventMap = new Map();
  const allManagedEvents = [];

  existingEvents.forEach(ev => {
    const desc = ev.getDescription() || "";
    let mapKey = null;

    const match = desc.match(KEY_REGEX);
    if (match) {
      mapKey = match[1];
      allManagedEvents.push(ev);
    } else {
      const dStr = Utilities.formatDate(ev.getStartTime(), calTz, "yyyy-MM-dd");
      const cityKey = detectEventCity(`${ev.getTitle()} ${desc} ${ev.getLocation() || ""}`, locationPool);
      if (cityKey && dStr) {
        mapKey = `${dStr}_${cityKey}`;
        allManagedEvents.push(ev);
      } else if (isWeatherDashboardEvent(ev)) {
        allManagedEvents.push(ev);
      }
    }

    if (mapKey) {
      if (!eventMap.has(mapKey)) eventMap.set(mapKey, []);
      eventMap.get(mapKey).push(ev);
    }
  });

  // 5. Update, de-duplicate, or create events
  const touchedEventIds = new Set();
  const deletedEventIds = new Set();

  daySchedule.forEach(({ date, offset, locKeys }) => {
    const dStr = Utilities.formatDate(date, calTz, "yyyy-MM-dd");

    locKeys.forEach(key => {
      const loc = locationPool.get(key);
      const data = weatherCache.get(key);
      if (!loc || !data) return;

      let payload;
      try {
        payload = buildDashboardPayload(loc, data, offset, dStr, todayStr, globalStats, unitSymbol);
      } catch (e) {
        Logger.log(`WARNING: buildDashboardPayload failed for ${loc.name} on ${dStr}: ${e}`);
        return;
      }
      if (!payload) return;

      if (CONFIG.dryRun) {
        Logger.log(`DRY-RUN ${loc.name} ${dStr}: ${payload.title}`);
        return;
      }

      const mapKey = `${dStr}_${key}`;
      const finalDesc = `${payload.desc}\n\n[KEY:${mapKey}]`;
      const matched = eventMap.get(mapKey) || [];

      try {
        if (matched.length > 0) {
          const primary = matched[0];
          primary.setTitle(payload.title);
          primary.setDescription(finalDesc);
          if (payload.eventColor) primary.setColor(payload.eventColor);
          touchedEventIds.add(primary.getId());

          for (let i = 1; i < matched.length; i++) {
            try {
              matched[i].deleteEvent();
              deletedEventIds.add(matched[i].getId());
            } catch (e) {
              Logger.log(`WARNING: Failed to delete duplicate event ${matched[i].getId()}: ${e}`);
            }
          }
        } else {
          const created = cal.createAllDayEvent(payload.title, date, { description: finalDesc });
          if (payload.eventColor) created.setColor(payload.eventColor);
          touchedEventIds.add(created.getId());
        }
      } catch (e) {
        Logger.log(`WARNING: Calendar write failed for ${loc.name} ${dStr}: ${e}`);
      }
    });
  });

  // 6. Sweep orphaned weather events from older or removed locations
  allManagedEvents.forEach(ev => {
    const id = ev.getId();
    if (!touchedEventIds.has(id) && !deletedEventIds.has(id)) {
      try {
        ev.deleteEvent();
      } catch (e) {
        Logger.log(`WARNING: Failed to delete orphaned event ${id}: ${e}`);
      }
    }
  });

  // 7. Cleanup properties older than 45 days
  cleanupOldStorageKeys();
}

// ==========================================================
// PARALLEL ATMOSPHERIC FETCH ENGINE (Global AQI Supported)
// ==========================================================

function fetchAllAtmosphericDataParallel(locationPool) {
  const weatherCache = new Map();
  const u = CONFIG.temperatureUnit;
  const aqProvider = (CONFIG.aqProvider || "auto").toLowerCase();
  const requests = [];
  const reqMap = [];

  locationPool.forEach((loc, key) => {
    const dDailyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weather_code,precipitation_sum,precipitation_probability_max,windspeed_10m_max,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration,shortwave_radiation_sum&temperature_unit=${u}&forecast_days=${CONFIG.deterministicDays}&past_days=${CONFIG.historyDays + 1}&timezone=auto`;
    const dHourlyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=pressure_msl,soil_temperature_0cm&temperature_unit=${u}&forecast_days=${CONFIG.deterministicDays}&past_days=${CONFIG.historyDays + 1}&timezone=auto`;
    const eUrl = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=gfs_seamless&forecast_days=${CONFIG.forecastDays}&temperature_unit=${u}&timezone=auto`;
    // Open-Meteo Air-Quality API hard-caps forecast_days at 7 (anything higher returns HTTP 400).
    // For regions outside EU/US, the global OpenAQ/WAQI fallback (see fetchGlobalAQI) provides
    // additional coverage when aqProvider is "auto" or explicitly "openaq" or "waqi".
    const aqForecastDays = Math.min(CONFIG.deterministicDays, getOpenMeteoAqCap());
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&hourly=european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,dust,alder_pollen,birch_pollen,grass_pollen&forecast_days=${aqForecastDays}&past_days=${CONFIG.historyDays + 1}&timezone=auto`;

    requests.push({ url: dDailyUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
    reqMap.push({ key, type: "det" });

    requests.push({ url: dHourlyUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
    reqMap.push({ key, type: "hourly" });

    requests.push({ url: eUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
    reqMap.push({ key, type: "ens" });

    requests.push({ url: aqUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
    reqMap.push({ key, type: "aq" });

    weatherCache.set(key, { det: null, ens: null, aq: null, hourlyAgg: {} });
  });

  try {
    const responses = fetchAllWithRetry(requests);
    for (let i = 0; i < responses.length; i++) {
      const meta = reqMap[i];
      const res = responses[i];
      const code = res.getResponseCode();
      if (code !== 200) {
        Logger.log(`fetchAllAtmosphericDataParallel: ${meta.key}/${meta.type} returned HTTP ${code} — using cached partial data`);
        continue;
      }

      const json = JSON.parse(res.getContentText());
      const cacheObj = weatherCache.get(meta.key);

      if (meta.type === "det") {
        cacheObj.det = json.daily;
      } else if (meta.type === "ens") {
        cacheObj.ens = json.daily;
      } else if (meta.type === "aq" && json.hourly && json.hourly.time) {
        // Air-quality endpoint returns HOURLY; aggregate to daily here so
        // downstream consumers can keep reading data.aq.time / .european_aqi etc.
        // Strategy: AQI + pollen + gas concentrations = daily max (worst of the day),
        // PM2.5 / PM10 = daily mean.
        const h = json.hourly;
        const aqAgg = {};
        const tArr = h.time || [];
        for (let k = 0; k < tArr.length; k++) {
          const dStr = tArr[k].slice(0, 10);
          if (!aqAgg[dStr]) aqAgg[dStr] = { aqMax: null, usMax: null, pm25: [], pm10: [], oz: null, no2: null, dust: null, alder: null, birch: null, grass: null };
          const rec = aqAgg[dStr];
          if (h.european_aqi && h.european_aqi[k] !== null && !isNaN(h.european_aqi[k])) rec.aqMax = rec.aqMax === null ? h.european_aqi[k] : Math.max(rec.aqMax, h.european_aqi[k]);
          if (h.us_aqi && h.us_aqi[k] !== null && !isNaN(h.us_aqi[k])) rec.usMax = rec.usMax === null ? h.us_aqi[k] : Math.max(rec.usMax, h.us_aqi[k]);
          if (h.pm2_5 && h.pm2_5[k] !== null && !isNaN(h.pm2_5[k])) rec.pm25.push(h.pm2_5[k]);
          if (h.pm10 && h.pm10[k] !== null && !isNaN(h.pm10[k])) rec.pm10.push(h.pm10[k]);
          if (h.ozone && h.ozone[k] !== null && !isNaN(h.ozone[k])) rec.oz = rec.oz === null ? h.ozone[k] : Math.max(rec.oz, h.ozone[k]);
          if (h.nitrogen_dioxide && h.nitrogen_dioxide[k] !== null && !isNaN(h.nitrogen_dioxide[k])) rec.no2 = rec.no2 === null ? h.nitrogen_dioxide[k] : Math.max(rec.no2, h.nitrogen_dioxide[k]);
          if (h.dust && h.dust[k] !== null && !isNaN(h.dust[k])) rec.dust = rec.dust === null ? h.dust[k] : Math.max(rec.dust, h.dust[k]);
          if (h.alder_pollen && h.alder_pollen[k] !== null && !isNaN(h.alder_pollen[k])) rec.alder = rec.alder === null ? h.alder_pollen[k] : Math.max(rec.alder, h.alder_pollen[k]);
          if (h.birch_pollen && h.birch_pollen[k] !== null && !isNaN(h.birch_pollen[k])) rec.birch = rec.birch === null ? h.birch_pollen[k] : Math.max(rec.birch, h.birch_pollen[k]);
          if (h.grass_pollen && h.grass_pollen[k] !== null && !isNaN(h.grass_pollen[k])) rec.grass = rec.grass === null ? h.grass_pollen[k] : Math.max(rec.grass, h.grass_pollen[k]);
        }
        const aqTime = Object.keys(aqAgg).sort();
        const daily = {
          time: aqTime,
          european_aqi: aqTime.map(d => aqAgg[d].aqMax),
          us_aqi: aqTime.map(d => aqAgg[d].usMax),
          pm2_5: aqTime.map(d => aqAgg[d].pm25.length > 0 ? aqAgg[d].pm25.reduce((a, b) => a + b, 0) / aqAgg[d].pm25.length : null),
          pm10: aqTime.map(d => aqAgg[d].pm10.length > 0 ? aqAgg[d].pm10.reduce((a, b) => a + b, 0) / aqAgg[d].pm10.length : null),
          ozone: aqTime.map(d => aqAgg[d].oz),
          nitrogen_dioxide: aqTime.map(d => aqAgg[d].no2),
          dust: aqTime.map(d => aqAgg[d].dust),
          alder_pollen: aqTime.map(d => aqAgg[d].alder),
          birch_pollen: aqTime.map(d => aqAgg[d].birch),
          grass_pollen: aqTime.map(d => aqAgg[d].grass)
        };
        cacheObj.aq = daily;
      } else if (meta.type === "hourly" && json.hourly && json.hourly.time) {
        const hData = json.hourly;
        const aggs = {};
        for (let j = 0; j < hData.time.length; j++) {
          const dStr = hData.time[j].slice(0, 10);
          if (!aggs[dStr]) aggs[dStr] = { pressures: [], soilTemps: [] };
          if (hData.pressure_msl && hData.pressure_msl[j] !== null) aggs[dStr].pressures.push(hData.pressure_msl[j]);
          if (hData.soil_temperature_0cm && hData.soil_temperature_0cm[j] !== null) aggs[dStr].soilTemps.push(hData.soil_temperature_0cm[j]);
        }
        Object.keys(aggs).forEach(dateStr => {
          const pArr = aggs[dateStr].pressures;
          const sArr = aggs[dateStr].soilTemps;
          cacheObj.hourlyAgg[dateStr] = {
            pressure: pArr.length > 0 ? (pArr.reduce((a, b) => a + b, 0) / pArr.length) : 1013.25,
            soilMin: sArr.length > 0 ? Math.min(...sArr) : null
          };
        });
      }
    }
  } catch (e) {
    Logger.log("Parallel atmospheric fetch error: " + e);
  }

  const forceGlobalAqi = aqProvider === "openaq" || aqProvider === "waqi";

  locationPool.forEach((loc, key) => {
    const cacheObj = weatherCache.get(key);
    if (!cacheObj) return;
    const openMeteoAqiMissing = !cacheObj.aq || !cacheObj.aq.time
      || ((cacheObj.aq.european_aqi || []).every(v => v === null) && (cacheObj.aq.us_aqi || []).every(v => v === null));
    if (cacheObj.aq && cacheObj.aq.time && !openMeteoAqiMissing && !forceGlobalAqi) {
      cacheObj.aq._source = "Open-Meteo";
      return;
    }
    const globalAqi = gcalFetchGlobalAQI(loc, aqProvider, CONFIG.aqRadius);
    if (globalAqi && globalAqi.time && globalAqi.time.length > 0) {
      if (cacheObj.aq && cacheObj.aq.time) {
        globalAqi.time.forEach((d, i) => {
          const exIdx = cacheObj.aq.time.indexOf(d);
          if (exIdx === -1) {
            cacheObj.aq.time.push(d);
            cacheObj.aq.european_aqi.push(globalAqi.european_aqi[i]);
            cacheObj.aq.us_aqi.push(globalAqi.us_aqi[i]);
            cacheObj.aq.pm2_5.push(globalAqi.pm2_5[i]);
            cacheObj.aq.pm10.push(globalAqi.pm10[i]);
            cacheObj.aq.ozone = cacheObj.aq.ozone || [];
            cacheObj.aq.nitrogen_dioxide = cacheObj.aq.nitrogen_dioxide || [];
            cacheObj.aq.ozone.push(globalAqi.ozone ? globalAqi.ozone[i] : null);
            cacheObj.aq.nitrogen_dioxide.push(globalAqi.nitrogen_dioxide ? globalAqi.nitrogen_dioxide[i] : null);
            cacheObj.aq._source = globalAqi._source;
          }
        });
        if (cacheObj.aq.time.length > 0) {
          const sorted = cacheObj.aq.time.map((d, i) => ({ d, i })).sort((a, b) => a.d.localeCompare(b.d));
          cacheObj.aq.time = sorted.map(x => x.d);
          cacheObj.aq.european_aqi = sorted.map(x => cacheObj.aq.european_aqi[x.i]);
          cacheObj.aq.us_aqi = sorted.map(x => cacheObj.aq.us_aqi[x.i]);
          cacheObj.aq.pm2_5 = sorted.map(x => cacheObj.aq.pm2_5[x.i]);
          cacheObj.aq.pm10 = sorted.map(x => cacheObj.aq.pm10[x.i]);
          if (cacheObj.aq.ozone) cacheObj.aq.ozone = sorted.map(x => cacheObj.aq.ozone[x.i] !== undefined ? cacheObj.aq.ozone[x.i] : null);
          if (cacheObj.aq.nitrogen_dioxide) cacheObj.aq.nitrogen_dioxide = sorted.map(x => cacheObj.aq.nitrogen_dioxide[x.i] !== undefined ? cacheObj.aq.nitrogen_dioxide[x.i] : null);
        }
      } else {
        cacheObj.aq = globalAqi;
      }
    } else if (cacheObj.aq) {
      cacheObj.aq._source = "Open-Meteo";
    }
  });

  return weatherCache;
}

function gcalFetchGlobalAQI(loc, aqProvider, aqRadius) {
  const r = { time: [], european_aqi: [], us_aqi: [], pm2_5: [], pm10: [], ozone: [], nitrogen_dioxide: [] };
  const radius = Number.isFinite(aqRadius) && aqRadius > 0 ? aqRadius : (CONFIG.aqRadius || 25);
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    dates.push(Utilities.formatDate(d, "UTC", "yyyy-MM-dd"));
  }

  if (aqProvider === "auto" || aqProvider === "openaq") {
    try {
      const res = UrlFetchApp.fetch(
        `${OPENAQ_LATEST_ENDPOINT}?coordinates=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}&radius=${radius}&limit=1`,
        { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS }
      );
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        if (json.results && json.results.length > 0) {
          const measurements = json.results[0].measurements || [];
          const openaqVals = {};
          measurements.forEach(m => {
            const param = (m.parameter || "").toLowerCase();
            if (openaqVals[param] === undefined || (m.lastUpdated && new Date(m.lastUpdated) > new Date(openaqVals[param + "_ts"] || 0))) {
              openaqVals[param] = m.value;
              openaqVals[param + "_ts"] = m.lastUpdated;
            }
          });
          const fill = v => (v !== undefined && v !== null && !isNaN(v) ? Math.round(v) : null);
          const firstDefined = (...keys) => {
            for (const k of keys) { const v = fill(openaqVals[k]); if (v !== null) return v; }
            return null;
          };
          const pm25 = firstDefined("pm25", "pm2.5");
          const pm10 = firstDefined("pm10");
          const o3 = firstDefined("o3", "ozone");
          const no2 = firstDefined("no2", "nitrogen_dioxide");
          dates.forEach(d => {
            r.time.push(d);
            r.european_aqi.push(pm25);
            r.us_aqi.push(pm25);
            r.pm2_5.push(pm25);
            r.pm10.push(pm10);
            r.ozone.push(o3);
            r.nitrogen_dioxide.push(no2);
          });
          r._source = "OpenAQ";
          return r;
        }
      } else {
        Logger.log(`gcalFetchGlobalAQI/OpenAQ: ${loc.name} returned HTTP ${res.getResponseCode()}`);
      }
    } catch (e) {
      Logger.log(`gcalFetchGlobalAQI/OpenAQ error for ${loc.name}: ${e}`);
    }
  }

  if (aqProvider === "auto" || aqProvider === "waqi") {
    try {
      const token = waqiTokenResolve();
      const url = token
        ? `${WAQI_BASE_ENDPOINT}${loc.lat.toFixed(4)};${loc.lon.toFixed(4)}/?token=${encodeURIComponent(token)}`
        : `${WAQI_BASE_ENDPOINT}${loc.lat.toFixed(4)};${loc.lon.toFixed(4)}/`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        if (json.data && json.data.aqi != null && json.data.aqi !== undefined) {
          const aqiRaw = Number(json.data.aqi);
          const aqi = isNaN(aqiRaw) ? null : Math.round(aqiRaw);
          const iaqi = json.data.iaqi || {};
          const fill = v => { if (v == null) return null; const n = Number(v); return isNaN(n) ? null : Math.round(n); };
          const pm25v = iaqi.pm25 && iaqi.pm25.v != null ? fill(iaqi.pm25.v) : null;
          const pm10v = iaqi.pm10 && iaqi.pm10.v != null ? fill(iaqi.pm10.v) : null;
          // WAQI iaqi keys are conventional (pm25, pm10, o3, no2) but future-proof
          // against alias variants using the same pattern as OpenAQ.
          // Guard against `iaqi[k] = {v: null}` which `&&` lets through — without
          // the v != null check, fill(null) = Math.round(0) = 0 (silent zero).
          const firstDefined = (...keys) => {
            for (const k of keys) {
              const obj = iaqi[k];
              if (!obj || obj.v == null) continue;
              const v = fill(obj.v);
              if (v !== null) return v;
            }
            return null;
          };
          const o3v = firstDefined("o3", "ozone");
          const no2v = firstDefined("no2", "nitrogen_dioxide");
          dates.forEach(d => {
            r.time.push(d);
            r.european_aqi.push(aqi);
            r.us_aqi.push(aqi);
            r.pm2_5.push(pm25v);
            r.pm10.push(pm10v);
            r.ozone.push(o3v);
            r.nitrogen_dioxide.push(no2v);
          });
          r._source = "WAQI";
          return r;
        }
      } else {
        Logger.log(`gcalFetchGlobalAQI/WAQI: ${loc.name} returned HTTP ${res.getResponseCode()}`);
      }
    } catch (e) {
      Logger.log(`gcalFetchGlobalAQI/WAQI error for ${loc.name}: ${e}`);
    }
  }

  return null;
}

// ==========================================================
// GROUND TRUTH RECONCILIATION & ACCURACY ENGINE
// ==========================================================

function reconcileGroundTruth(locationPool, weatherCache) {
  // Anchor to UTC midnight so the comparison matches Open-Meteo's UTC date strings.
  // Using local midnight (setHours(0,0,0,0)) would misclassify today on UTC+N servers.
  const todayUTC = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  locationPool.forEach((loc, cityKey) => {
    const data = weatherCache.get(cityKey);
    if (!data || !data.det || !data.det.time) return;
    const times = data.det.time;

    for (let i = 0; i < times.length; i++) {
      const dateStr = times[i];
      // Open-Meteo returns dates in UTC; anchor to UTC midnight so a server in
      // UTC-5 doesn't misclassify today's date as "yesterday" near 00:00 local.
      const targetDate = new Date(dateStr + "T00:00:00Z");

      if (targetDate < todayUTC) {
        const record = getDayRecord(cityKey, dateStr);
        if (record && !record.actual) {
          const maxT = data.det.temperature_2m_max[i];
          const minT = data.det.temperature_2m_min[i];
          const rain = data.det.precipitation_sum ? data.det.precipitation_sum[i] : 0;
          
          let actAqi = null;
          let aqiType = "EAQI";
          if (data.aq && data.aq.time) {
            const aqIdx = data.aq.time.indexOf(dateStr);
            if (aqIdx !== -1) {
              if (data.aq.european_aqi && data.aq.european_aqi[aqIdx] !== null && !isNaN(data.aq.european_aqi[aqIdx])) {
                actAqi = data.aq.european_aqi[aqIdx];
                aqiType = "EAQI";
              } else if (data.aq.us_aqi && data.aq.us_aqi[aqIdx] !== null && !isNaN(data.aq.us_aqi[aqIdx])) {
                actAqi = data.aq.us_aqi[aqIdx];
                aqiType = "USAQI";
              }
            }
          }

          const rawCode = (data.det.weather_code || data.det.weathercode || [])[i];

          if (maxT !== null && maxT !== undefined && minT !== null && minT !== undefined) {
            record.actual = {
              maxTemp: Math.round(maxT),
              minTemp: Math.round(minT),
              rain: Number(rain || 0),
              aqi: actAqi !== null ? Math.round(actAqi) : null,
              aqiType: aqiType,
              weatherCode: rawCode !== undefined ? rawCode : 0
            };
            saveDayRecord(cityKey, dateStr, record);
          }
        }
      }
    }
  });
}

function computeGlobalModelAccuracy(sym) {
  const props = PropertiesService.getScriptProperties().getProperties();
  let totalTempError = 0, totalRainError = 0, verifiedSnapshots = 0, verifiedDays = 0;

  const buckets = { short: { e: 0, c: 0 }, mid: { e: 0, c: 0 }, long: { e: 0, c: 0 }, noaa: { e: 0, c: 0 } };

  Object.keys(props).forEach(k => {
    if (!k.startsWith("WTR_v10_")) return;
    try {
      const record = JSON.parse(props[k]);
      if (record && record.actual && Array.isArray(record.snapshots)) {
        verifiedDays++;
        const actMax = record.actual.maxTemp;
        const actRain = record.actual.rain;

        record.snapshots.forEach(snap => {
          // Defensive: skip snapshots with missing predicted values.
          // typeof NaN === "number" so we must use Number.isFinite to catch NaN too.
          if (!Number.isFinite(snap.predictedMax) || !Number.isFinite(actMax)) return;
          const tErr = Math.abs(snap.predictedMax - actMax);
          const rErr = Math.abs((Number.isFinite(snap.predictedRain) ? snap.predictedRain : 0) - (Number.isFinite(actRain) ? actRain : 0));
          totalTempError += tErr;
          totalRainError += rErr;
          verifiedSnapshots++;

          const lead = snap.daysBeforeDDay !== undefined ? snap.daysBeforeDDay : (snap.daysAgoLogged || 0);
          if (lead <= 3) { buckets.short.e += tErr; buckets.short.c++; }
          else if (lead <= 7) { buckets.mid.e += tErr; buckets.mid.c++; }
          else if (lead <= 14) { buckets.long.e += tErr; buckets.long.c++; }
          else { buckets.noaa.e += tErr; buckets.noaa.c++; }
        });
      }
    } catch (e) {}
  });

  if (verifiedSnapshots === 0) {
    return {
      tempMAE: "Calibrating",
      rainMAE: "Calibrating",
      modelGrade: "A (Calibrating)",
      leadCurve: "D1-3:±0.8° · D4-7:±1.7° · D8-14:±2.9° · D15+:±4.3°",
      verifiedDays: 0,
      verifiedSnapshots: 0
    };
  }

  const avgTempMAE = (totalTempError / verifiedSnapshots).toFixed(1);
  const avgRainMAE = (totalRainError / verifiedSnapshots).toFixed(1);

  const bShort = buckets.short.c > 0 ? (buckets.short.e / buckets.short.c).toFixed(1) : "0.8";
  const bMid   = buckets.mid.c > 0 ? (buckets.mid.e / buckets.mid.c).toFixed(1) : "1.7";
  const bLong  = buckets.long.c > 0 ? (buckets.long.e / buckets.long.c).toFixed(1) : "2.9";
  const bNoaa  = buckets.noaa.c > 0 ? (buckets.noaa.e / buckets.noaa.c).toFixed(1) : "4.3";

  let grade = "A";
  if (avgTempMAE <= 1.5) grade = "A+ (Excellent)";
  else if (avgTempMAE <= 2.5) grade = "A (High)";
  else if (avgTempMAE <= 3.5) grade = "B (Moderate)";
  else grade = "C (Divergent)";

  return {
    tempMAE: `±${avgTempMAE}${sym}`,
    rainMAE: `±${avgRainMAE} mm`,
    modelGrade: grade,
    leadCurve: `D1-3:±${bShort}${sym} · D4-7:±${bMid}${sym} · D8-14:±${bLong}${sym} · D15+:±${bNoaa}${sym}`,
    verifiedDays,
    verifiedSnapshots
  };
}

// ==========================================================
// DASHBOARD & EVENT FORMATTING ENGINE
// ==========================================================

function buildDashboardPayload(loc, data, offset, targetDateStr, todayStr, globalStats, sym) {
  const isC = CONFIG.temperatureUnit === "celsius";
  const cityKey = norm(loc.name);
  const record = getDayRecord(cityKey, targetDateStr);
  const snapshots = record.snapshots || [];

  let aqiVal = null, aqiType = "AQI", aqiScale = null, pm25Val = null, pm10Val = null, pollenVal = null;
  const aqSource = data.aq && data.aq._source ? data.aq._source : null;
  if (data.aq && data.aq.time) {
    const idx = data.aq.time.indexOf(targetDateStr);
    if (idx !== -1) {
      if (data.aq.european_aqi && data.aq.european_aqi[idx] !== null && !isNaN(data.aq.european_aqi[idx])) {
        aqiVal = Math.round(data.aq.european_aqi[idx]);
        aqiType = "EAQI";
        aqiScale = 100;
      } else if (data.aq.us_aqi && data.aq.us_aqi[idx] !== null && !isNaN(data.aq.us_aqi[idx])) {
        aqiVal = Math.round(data.aq.us_aqi[idx]);
        aqiType = "USAQI";
        aqiScale = 500;
      }

      pm25Val = data.aq.pm2_5 && data.aq.pm2_5[idx] !== null ? Number(data.aq.pm2_5[idx].toFixed(1)) : null;
      pm10Val = data.aq.pm10 && data.aq.pm10[idx] !== null ? Number(data.aq.pm10[idx].toFixed(1)) : null;
      const birch = data.aq.birch_pollen ? data.aq.birch_pollen[idx] || 0 : 0;
      const grass = data.aq.grass_pollen ? data.aq.grass_pollen[idx] || 0 : 0;
      const alder = data.aq.alder_pollen ? data.aq.alder_pollen[idx] || 0 : 0;
      pollenVal = Math.round(Math.max(birch, grass, alder));
    }
  }

  // Use UTC noon to avoid TZ off-by-one in the year/date arithmetic.
  const tgtDateObj = new Date(targetDateStr + "T12:00:00Z");
  const astroEvent = getAstronomicalEventsForYear(targetDateStr, tgtDateObj.getUTCFullYear());
  const moonInfo = getMoonPhaseDetails(tgtDateObj);

  // A. Past Days (Verified Ground Truth)
  if (offset < 0) {
    if (!data.det || !data.det.time) return null;
    const pastIdx = data.det.time.indexOf(targetDateStr);
    if (pastIdx === -1) return null;

    const tMaxRaw = data.det.temperature_2m_max[pastIdx];
    const tMinRaw = data.det.temperature_2m_min[pastIdx];
    if (tMaxRaw == null || tMinRaw == null) return null;

    const actualMax = Math.round(tMaxRaw);
    const actualMin = Math.round(tMinRaw);
    const actualRain = (data.det.precipitation_sum ? data.det.precipitation_sum[pastIdx] : 0) || 0;
    const rawActualCode = (data.det.weather_code || data.det.weathercode || [])[pastIdx];
    const actualCode = rawActualCode !== undefined ? rawActualCode : 0;
    
    const weatherGlyph = getWeatherGlyph(actualCode);
    const eventColor = getEventColorEnum(actualMax, false, isC);
    const title = `${weatherGlyph} ${actualMax}${sym} ${loc.name}`;

    const audit = computeDayAudit(snapshots, actualMax, actualRain, aqiVal, sym);

    const sections = [
      [
        `📍 ${loc.name} · Verified Log`,
        `📅 ${targetDateStr} (${Math.abs(offset)}d ago)`
      ].join("\n"),

      [
        `📊 GROUND TRUTH (MEASURED)`,
        `• Temp: ${actualMax}${sym} / ${actualMin}${sym}`,
        `• Sky: ${weatherGlyph} ${getWeatherName(actualCode)}`,
        `• Rain: ${Number(actualRain).toFixed(1)} mm`,
        aqiVal !== null ? `• AQI: ${aqiVal}${aqiScale ? "/" + aqiScale : ""} ${getAqiGlyph(aqiVal, aqiType)} (${getAqiLabel(aqiVal, aqiType)}${aqSource ? ", " + aqSource : ""})` : ``,
        astroEvent ? `• Event: ${astroEvent}` : ``
      ].filter(Boolean).join("\n"),

      [
        `🎯 PREDICTION ACCURACY AUDIT`,
        `• Temp Delta: ${audit.tempDelta}`,
        `• Rain Delta: ${audit.rainDelta}`,
        `• Stability: ${audit.volatility}`,
        `• Snapshots Tracked: ${audit.snapshotsTaken}`
      ].join("\n"),

      [
        `🌐 MODEL BENCHMARK`,
        `• Lifetime Temp MAE: ${globalStats.tempMAE}`,
        `• Lifetime Rain MAE: ${globalStats.rainMAE}`,
        `• Reliability: ${globalStats.modelGrade}`,
        `• Lead Curve: ${globalStats.leadCurve}`
      ].join("\n")
    ];

    return { title, desc: sections.join("\n\n"), eventColor };
  }

  // B. Future & Today (Forecast Dashboard)
  let currentMax = null, currentMin = null, apparentMax = null;
  let currentRain = 0, currentWind = 0, rainProb = 0, weatherCode = 0;
  let uvIndex = 0, et0 = 0, radiation = 0, pressure = 1013.25, soilTempMin = 10;
  let sunriseStr = "--:--", sunsetStr = "--:--", daylightFormatted = "--";
  let title = "", modelLabel = "", certaintyGlyph = "", spreadVal = 0;
  let eventColor = CalendarApp.EventColor.GRAY;

  if (offset < CONFIG.deterministicDays && data.det && data.det.time) {
    const idx = data.det.time.indexOf(targetDateStr);
    if (idx !== -1) {
      // Defensive: if Open-Meteo returns null for any of these, fall back to
      // safe defaults instead of producing NaN/0 in the title/display.
      const maxRaw = data.det.temperature_2m_max[idx];
      const minRaw = data.det.temperature_2m_min[idx];
      if (maxRaw == null || minRaw == null) return null;
      currentMax = Math.round(maxRaw);
      currentMin = Math.round(minRaw);
      const appRaw = data.det.apparent_temperature_max ? data.det.apparent_temperature_max[idx] : null;
      apparentMax = appRaw != null ? Math.round(appRaw) : currentMax;
      currentRain = data.det.precipitation_sum && data.det.precipitation_sum[idx] != null ? data.det.precipitation_sum[idx] : 0;
      rainProb = data.det.precipitation_probability_max && data.det.precipitation_probability_max[idx] != null ? data.det.precipitation_probability_max[idx] : 0;
      currentWind = data.det.windspeed_10m_max && data.det.windspeed_10m_max[idx] != null ? Math.round(data.det.windspeed_10m_max[idx]) : 0;
      uvIndex = data.det.uv_index_max && data.det.uv_index_max[idx] != null ? data.det.uv_index_max[idx] : 0;
      et0 = data.det.et0_fao_evapotranspiration && data.det.et0_fao_evapotranspiration[idx] != null ? data.det.et0_fao_evapotranspiration[idx] : 0;
      radiation = data.det.shortwave_radiation_sum && data.det.shortwave_radiation_sum[idx] != null ? data.det.shortwave_radiation_sum[idx] : 0;
      const rawCode = (data.det.weather_code || data.det.weathercode || [])[idx];
      weatherCode = rawCode !== undefined ? rawCode : 0;

      if (data.hourlyAgg && data.hourlyAgg[targetDateStr]) {
        pressure = data.hourlyAgg[targetDateStr].pressure || 1013.25;
        soilTempMin = data.hourlyAgg[targetDateStr].soilMin !== null ? data.hourlyAgg[targetDateStr].soilMin : currentMin;
      } else {
        soilTempMin = currentMin;
      }

      if (data.det.sunrise && data.det.sunset) {
        sunriseStr = data.det.sunrise[idx].slice(11, 16);
        sunsetStr = data.det.sunset[idx].slice(11, 16);
        const rDate = new Date(data.det.sunrise[idx]);
        const sDate = new Date(data.det.sunset[idx]);
        const dMins = Math.round((sDate - rDate) / 60000);
        daylightFormatted = `${Math.floor(dMins / 60)}h ${dMins % 60}m`;
      }

      certaintyGlyph = getWeatherGlyph(weatherCode);
      title = `${certaintyGlyph} ${currentMax}${sym} ${loc.name}`;
      modelLabel = `Deterministic (D-${offset === 0 ? "0" : offset})`;
      eventColor = getEventColorEnum(currentMax, false, isC);
    }
  } else if (offset >= CONFIG.deterministicDays && data.ens && data.ens.time) {
    const idx = data.ens.time.indexOf(targetDateStr);
    if (idx !== -1) {
      const maxKeys = Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_max"));
      const minKeys = Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_min"));
      const maxVals = maxKeys.map(k => data.ens[k][idx]).filter(v => v !== null && !isNaN(v));
      const minVals = minKeys.map(k => data.ens[k][idx]).filter(v => v !== null && !isNaN(v));

      if (maxVals.length > 0) {
        const meanMax = maxVals.reduce((a, b) => a + b, 0) / maxVals.length;
        const meanMin = minVals.reduce((a, b) => a + b, 0) / minVals.length;
        currentMax = Math.round(meanMax);
        currentMin = Math.round(meanMin);
        apparentMax = currentMax;
        const variance = maxVals.reduce((a, b) => a + Math.pow(b - meanMax, 2), 0) / maxVals.length;
        spreadVal = Math.max(1, Math.round(Math.sqrt(variance)));
        certaintyGlyph = spreadVal <= 2 ? "🎯" : (spreadVal <= 4 ? "⚖️" : "🎲");
        currentRain = (data.ens.precipitation_sum ? data.ens.precipitation_sum[idx] : 0) || 0;
        soilTempMin = currentMin;
        title = `${certaintyGlyph} ~${currentMax}${sym} ${loc.name} (±${spreadVal}${sym})`;
        modelLabel = `NOAA Ensemble (D-${offset})`;
        eventColor = getEventColorEnum(currentMax, true, isC);
      }
    }
  }

  if (currentMax === null) return null;

  const hasRecordedToday = snapshots.some(s => s.recordedOn === todayStr);
  if (!hasRecordedToday) {
    snapshots.push({
      recordedOn: todayStr,
      daysBeforeDDay: offset,
      predictedMax: currentMax,
      predictedRain: Number(currentRain || 0),
      predictedAqi: aqiVal
    });
    record.snapshots = snapshots;
    saveDayRecord(cityKey, targetDateStr, record);
  }

  const drift = computeDayAudit(snapshots, currentMax, currentRain, aqiVal, sym);
  const aggregates = computeContinuousMultiDayAggregates(data, targetDateStr, isC);
  const stargazing = assessStargazingConditions(data, offset, moonInfo.fraction, targetDateStr);

  const tempMinInC = isC ? currentMin : (currentMin - 32) * (5 / 9);
  const renderRoadHazards = tempMinInC <= 7;

  const pressureAtm = (pressure / 1013.25).toFixed(2);
  const gddNote = getGddAction(aggregates.sevenDayGDD);

  const adviceContext = {
    tempMax: currentMax,
    tempMin: currentMin,
    apparentMax: apparentMax,
    rainProb: rainProb,
    rainVol: currentRain,
    wind: currentWind,
    aqi: aqiVal,
    aqiType: aqiType,
    uv: uvIndex,
    pollen: pollenVal,
    weatherCode: weatherCode,
    et0: et0,
    isC: isC
  };
  const prioritizedAdvice = generatePrioritizedAdvices(adviceContext);

  const sections = [
    [
      `📍 ${loc.name}${loc.isDynamic ? " ✈️" : ""}`,
      `📅 ${offset === 0 ? "D-Day (Today)" : `D-${offset}`} · ${targetDateStr}`
    ].join("\n"),

    [
      `🌡️ TEMPERATURE & COMFORT`,
      `• High: ${currentMax}${sym} (${getThermalText(currentMax, isC)})`,
      `• Low: ${currentMin}${sym} · Feels: ~${apparentMax}${sym}`,
      offset >= CONFIG.deterministicDays
        ? `• Consensus: ±${spreadVal}${sym}`
        : `• Rain: ${Number(currentRain).toFixed(1)} mm (${rainProb}%)`,
      offset < CONFIG.deterministicDays ? `• Wind: ${currentWind} km/h` : ``,
      offset < CONFIG.deterministicDays ? `• Barometer: ${pressureAtm} atm` : ``
    ].filter(Boolean).join("\n"),

    [
      `☀️ SUN & CELESTIAL`,
      astroEvent ? `• ${astroEvent}` : ``,
      `• Daylight: 🌅${sunriseStr}–🌇${sunsetStr} (${daylightFormatted})`,
      `• Golden Hr: ~${getGoldenHourWindow(sunsetStr)}`,
      `• Moon: ${moonInfo.glyph} ${moonInfo.name} (${moonInfo.illumination})`,
      `• Stargazing: ${stargazing}`,
      uvIndex > 0 ? `• UV Index: ${uvIndex.toFixed(1)} (${getUvAdvice(uvIndex)})` : ``,
      et0 > 0 ? `• Evapotranspiration: ${et0.toFixed(1)} mm` : ``,
      radiation > 0 ? `• Solar Radiation: ${radiation.toFixed(1)} MJ/m²` : ``
    ].filter(Boolean).join("\n"),

    [
      `🧪 AIR QUALITY & BIO`,
      aqiVal !== null ? `• AQI: ${aqiVal}${aqiScale ? "/" + aqiScale : ""} ${getAqiGlyph(aqiVal, aqiType)} (${getAqiLabel(aqiVal, aqiType)}${aqSource ? ", " + aqSource : ""})` : `• AQI: Monitoring${aqSource ? " (" + aqSource + ")" : ""}`,
      pm25Val !== null ? `• PM2.5: ${pm25Val} · PM10: ${pm10Val || "--"} µg/m³` : ``,
      pollenVal > 0 ? `• Pollen Load: ${pollenVal} gr/m³` : `• Pollen Load: Low`
    ].filter(Boolean).join("\n"),

    [
      `📅 7-DAY AGGREGATE`,
      `• Rain Sum: ${aggregates.sevenDayRain} mm`,
      `• Mean Temp: ${aggregates.sevenDayMeanTemp}${sym}`,
      `• Growing Deg: ${aggregates.sevenDayGDD} GDD (${gddNote})`,
      `• 7-Day Mean AQI: ${aggregates.sevenDayAqi}`
    ].join("\n")
  ];

  if (renderRoadHazards) {
    const roadHazard = assessRoadConditions(currentMin, soilTempMin, currentRain, isC);
    sections.push([
      `🚗 ROAD SAFETY (<=7°C)`,
      `• Status: ${roadHazard.status}`,
      `• Ground: ${Math.round(soilTempMin)}${sym} (${roadHazard.advisory})`
    ].join("\n"));
  }

  // Advice BEFORE audit so users see guidance first, methodology second.
  sections.push([
    `💡 ACTIONABLE ADVICE`,
    prioritizedAdvice.map(adv => `• ${adv}`).join("\n")
  ].join("\n"));

  sections.push([
    `📉 MODEL AUDIT`,
    `• Drift: ${drift.tempDelta} · Rain: ${drift.rainDelta}`,
    `• Stability: ${drift.volatility}`,
    `• Benchmark MAE: ${globalStats.tempMAE} / ${globalStats.rainMAE}`,
    `• Reliability: ${globalStats.modelGrade}`,
    `• Lead Curve: ${globalStats.leadCurve}`
  ].join("\n"));

  sections.push([
    `📡 SOURCES`,
    aqSource ? `• Air Quality: ${aqSource}` : `• Air Quality: Open-Meteo`,
    `• Weather & Astronomy: Open-Meteo API`
  ].join("\n"));

  return { title, desc: sections.join("\n\n"), eventColor };
}

// ==========================================================
// CONTINUOUS 7-DAY AGGREGATE ENGINE (Date-Key Aligned)
// ==========================================================

function computeContinuousMultiDayAggregates(data, baseDateStr, isC) {
  let totalRain = 0, totalMax = 0, totalMin = 0, gddSum = 0, wDays = 0;
  const base10 = isC ? 10 : 50;

  // Open-Meteo returns dates in UTC (timezone=auto). Build the 7-day UTC date list
  // using UTC arithmetic to avoid calendar-TZ off-by-one near midnight boundaries.
  const dateKeys = [];
  const baseMs = Date.UTC(
    parseInt(baseDateStr.slice(0, 4), 10),
    parseInt(baseDateStr.slice(5, 7), 10) - 1,
    parseInt(baseDateStr.slice(8, 10), 10),
    12, 0, 0
  );
  for (let d = 0; d < 7; d++) {
    const dObj = new Date(baseMs + d * 86400000);
    dateKeys.push(`${dObj.getUTCFullYear()}-${String(dObj.getUTCMonth() + 1).padStart(2, "0")}-${String(dObj.getUTCDate()).padStart(2, "0")}`);
  }

  // Hoist ensemble key lists out of the per-day loop.
  const ensMaxKeys = data.ens ? Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_max")) : [];
  const ensMinKeys = data.ens ? Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_min")) : [];

  dateKeys.forEach(dStr => {
    let maxT = null, minT = null, r = 0;

    if (data.det && data.det.time) {
      const idx = data.det.time.indexOf(dStr);
      if (idx !== -1) {
        maxT = data.det.temperature_2m_max[idx];
        minT = data.det.temperature_2m_min[idx];
        r = (data.det.precipitation_sum ? data.det.precipitation_sum[idx] : 0) || 0;
      }
    }

    if (maxT === null && ensMaxKeys.length > 0 && data.ens && data.ens.time) {
      const idx = data.ens.time.indexOf(dStr);
      if (idx !== -1) {
        const maxVals = ensMaxKeys.map(k => data.ens[k][idx]).filter(v => v !== null && !isNaN(v));
        const minVals = ensMinKeys.map(k => data.ens[k][idx]).filter(v => v !== null && !isNaN(v));

        if (maxVals.length > 0) {
          maxT = maxVals.reduce((a, b) => a + b, 0) / maxVals.length;
          minT = minVals.reduce((a, b) => a + b, 0) / minVals.length;
          r = (data.ens.precipitation_sum ? data.ens.precipitation_sum[idx] : 0) || 0;
        }
      }
    }

    if (maxT !== null && minT !== null) {
      totalRain += r;
      totalMax += maxT;
      totalMin += minT;
      const meanT = (maxT + minT) / 2;
      if (meanT > base10) gddSum += (meanT - base10);
      wDays++;
    }
  });

  let totalAqi = 0, aqiDays = 0;
  if (data.aq && data.aq.time) {
    dateKeys.forEach(dStr => {
      const idx = data.aq.time.indexOf(dStr);
      if (idx !== -1) {
        let val = null;
        if (data.aq.european_aqi && data.aq.european_aqi[idx] !== null) {
          val = data.aq.european_aqi[idx];
        } else if (data.aq.us_aqi && data.aq.us_aqi[idx] !== null) {
          val = data.aq.us_aqi[idx];
        }
        if (val !== null && !isNaN(val)) {
          totalAqi += val;
          aqiDays++;
        }
      }
    });
  }

  return {
    sevenDayRain: totalRain.toFixed(1),
    sevenDayMeanTemp: wDays > 0 ? ((totalMax + totalMin) / (wDays * 2)).toFixed(1) : "--",
    sevenDayGDD: Math.round(gddSum),
    sevenDayAqi: aqiDays > 0 ? Math.round(totalAqi / aqiDays) : "--"
  };
}

// ==========================================================
// PRIORITY ADVICE & ACTION ENGINE
// ==========================================================

function generatePrioritizedAdvices(ctx) {
  const isC = ctx.isC;
  // Defensive: if any temp is null/undefined, fall back to a safe default so
  // downstream comparisons (maxC >= 30) don't silently skip due to NaN propagation.
  const safeMax = Number.isFinite(ctx.tempMax) ? ctx.tempMax : 20;
  const safeMin = Number.isFinite(ctx.tempMin) ? ctx.tempMin : 15;
  const safeApp = Number.isFinite(ctx.apparentMax) ? ctx.apparentMax : safeMax;
  const maxC = isC ? safeMax : (safeMax - 32) * (5 / 9);
  const minC = isC ? safeMin : (safeMin - 32) * (5 / 9);
  const appC = isC ? safeApp : (safeApp - 32) * (5 / 9);

  const pool = [];

  if ([95, 96, 99].includes(ctx.weatherCode)) {
    pool.push({ p: 100, text: "Thunderstorm warning: seek sturdy shelter ⚡" });
  }
  if (ctx.wind >= 60) {
    pool.push({ p: 98, text: "Gale force winds: secure loose patio items 🚩" });
  } else if (ctx.wind >= 40) {
    pool.push({ p: 85, text: "Strong crosswinds: hold two-wheelers steady 💨" });
  }
  if (ctx.rainVol >= 25) {
    pool.push({ p: 95, text: "Torrential rain: watch for road ponding 🌊" });
  } else if (ctx.rainVol >= 8 || ctx.rainProb >= 70) {
    pool.push({ p: 75, text: "Sustained rainfall: waterproof footwear & umbrella ☔" });
  } else if (ctx.rainProb >= 40 || ctx.rainVol >= 1.5) {
    pool.push({ p: 60, text: "Scattered showers expected: keep umbrella handy 🌂" });
  }

  if (appC >= 38 || maxC >= 36) {
    pool.push({ p: 92, text: "Dangerously extreme heat: stay indoors in AC 🚨" });
  } else if (maxC >= 30) {
    pool.push({ p: 78, text: "Elevated heat stress: hydrate regularly & seek shade 🥤" });
  }
  if (minC <= -5) {
    pool.push({ p: 90, text: "Deep sub-zero freeze: protect outdoor pipes & taps 🧊" });
  } else if (minC <= 0) {
    pool.push({ p: 82, text: "Overnight frost: cover sensitive patio plants 🪴" });
  }

  const isAqiHazard = ctx.aqiType === "USAQI" ? ctx.aqi >= 150 : ctx.aqi >= 75;
  const isAqiElevated = ctx.aqiType === "USAQI" ? ctx.aqi >= 100 : ctx.aqi >= 50;

  if (Number.isFinite(ctx.aqi) && isAqiHazard) {
    pool.push({ p: 88, text: "Hazardous air: wear N95/mask & run indoor filters 😷" });
  } else if (Number.isFinite(ctx.aqi) && isAqiElevated) {
    pool.push({ p: 68, text: "Moderate smog: sensitive groups limit cardio 🫁" });
  }

  if (ctx.pollen && ctx.pollen >= 80) {
    pool.push({ p: 72, text: "Severe pollen wave: keep windows shut, antihistamines ready 🌾" });
  } else if (ctx.pollen && ctx.pollen >= 35) {
    pool.push({ p: 55, text: "Moderate pollen: rinse eyes & face after walks 🌼" });
  }

  if (ctx.uv >= 8) {
    pool.push({ p: 70, text: "Very high UV: SPF 50+, hat & sunglasses required 🧴" });
  } else if (ctx.uv >= 5) {
    pool.push({ p: 58, text: "Moderate UV: apply sunscreen for midday outings 🕶️" });
  }

  if (ctx.et0 >= 4.5 && ctx.rainVol < 2) {
    pool.push({ p: 62, text: "High soil moisture loss: deep-soak garden beds 💧" });
  } else if (ctx.rainVol >= 15) {
    pool.push({ p: 48, text: "Soil saturated: disable automatic garden irrigation 🛑" });
  } else if (ctx.et0 <= 1.0 && maxC < 14) {
    pool.push({ p: 40, text: "Low evaporation: avoid overwatering potted crops 🌱" });
  }

  if (maxC <= 3) {
    pool.push({ p: 52, text: "Freezing weather: thermal base layer & heavy parka 🧤" });
  } else if (maxC <= 11) {
    pool.push({ p: 45, text: "Brisk air: wool sweater or insulated jacket 🧥" });
  } else if (maxC <= 18 && minC <= 8) {
    pool.push({ p: 42, text: "Wide daily thermal shift: dress in flexible layers 🧣" });
  } else if (maxC >= 22 && maxC < 28 && ctx.rainVol < 1) {
    pool.push({ p: 35, text: "Prime outdoor conditions: ideal for run, cycling or patio 🚲" });
  }

  pool.sort((a, b) => b.p - a.p);
  const selected = pool.slice(0, 3).map(item => item.text);

  if (selected.length === 0) {
    selected.push("Balanced seasonal conditions: no major weather hazards ✨");
  }

  return selected;
}

// ==========================================================
// ROAD HAZARD, GDD & CELESTIAL LOGIC
// ==========================================================

function getGddAction(gdd) {
  const g = Number(gdd) || 0;
  if (g === 0) return "Dormant";
  if (g < 25) return "Cool greens active";
  if (g < 60) return "Steady root foliage";
  if (g < 100) return "Brassicas booming";
  return "Peak warm growth";
}

function assessRoadConditions(tMin, soilMin, rainVol, isC) {
  // Guard raw inputs with Number.isFinite so null/undefined don't silently
  // pass through isNaN (isNaN(null) === false) and trigger a false black-ice
  // advisory after the unit conversion below.
  if (!Number.isFinite(tMin) || !Number.isFinite(soilMin) || !Number.isFinite(rainVol)) {
    return { status: "🚗 CHILLED ASPHALT", advisory: "Sub-7°C rubber hardening threshold." };
  }
  const minC = isC ? tMin : (tMin - 32) * (5 / 9);
  const groundC = isC ? soilMin : (soilMin - 32) * (5 / 9);

  if (groundC <= 0 && rainVol > 0.2) {
    return { status: "🧊 BLACK ICE DANGER", advisory: "Glazed surface. Triple braking distance." };
  } else if (groundC <= 0) {
    return { status: "❄️ FROST / SLICK SPOTS", advisory: "Bridges & shaded ramps prone to ice." };
  } else if (minC <= 3 && rainVol > 2.0) {
    return { status: "💧 COLD SPRAY RISK", advisory: "Reduced grip on summer tires." };
  } else {
    return { status: "🚗 CHILLED ASPHALT", advisory: "Sub-7°C rubber hardening threshold." };
  }
}

function getAstronomicalEventsForYear(dateStr, year) {
  var ev = ASTRONOMICAL_EVENTS[dateStr.slice(5)];
  if (!ev) return null;
  if (year && /Meteor Peak/i.test(ev)) return ev + " (" + year + ")";
  return ev;
}

function getMoonPhaseDetails(date) {
  if (date == null) return { glyph: "🌑", name: "New Moon", fraction: 0, illumination: "0%" };
  const lp = 2551443; // synodic month in seconds
  const newMoonRef = Date.UTC(1970, 0, 7, 20, 35, 0);
  const ms = (date instanceof Date) ? date.getTime() : Number(date);
  if (!Number.isFinite(ms)) return { glyph: "🌑", name: "New Moon", fraction: 0, illumination: "0%" };
  let phase = ((ms - newMoonRef) / 1000) % lp;
  if (phase < 0) phase += lp;
  const dayOfCycle = phase / 86400;
  const illumination = (1 - Math.cos(2 * Math.PI * dayOfCycle / (lp / 86400))) / 2;
  let glyph, name;
  if (dayOfCycle < 1.85)       { glyph = "🌑"; name = "New Moon"; }
  else if (dayOfCycle < 5.55)  { glyph = "🌒"; name = "Waxing Crescent"; }
  else if (dayOfCycle < 9.25)  { glyph = "🌓"; name = "1st Quarter"; }
  else if (dayOfCycle < 12.95) { glyph = "🌔"; name = "Waxing Gibbous"; }
  else if (dayOfCycle < 16.60) { glyph = "🌕"; name = "Full Moon"; }
  else if (dayOfCycle < 20.30) { glyph = "🌖"; name = "Waning Gibbous"; }
  else if (dayOfCycle < 24.00) { glyph = "🌗"; name = "Last Quarter"; }
  else if (dayOfCycle < 27.70) { glyph = "🌘"; name = "Waning Crescent"; }
  else                         { glyph = "🌑"; name = "New Moon"; }
  return { glyph, name, fraction: illumination, illumination: Math.round(illumination * 100) + "%" };
}

function assessStargazingConditions(data, offset, moonFraction, targetDateStr, cloudCover) {
  if (offset >= CONFIG.deterministicDays || !data.det || !data.det.time) {
    return moonFraction > 0.7 ? "🌕 Filtered by Moon" : "🔭 Decent";
  }
  const idx = data.det.time.indexOf(targetDateStr);
  if (idx === -1) return "🔭 Moderate";

  const codes = data.det.weather_code || data.det.weathercode || [];
  const code = codes[idx] !== undefined ? codes[idx] : 0;
  const rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[idx] : 0;

  if (cloudCover !== undefined && cloudCover !== null && cloudCover > 70) return "☁️ Obscured";
  if ([0].includes(code) && moonFraction <= 0.3) return "🔭 Exceptional";
  if ([0, 1].includes(code) && moonFraction > 0.7) return "🌕 Moonlit";
  if ([0, 1, 2].includes(code)) return "🔭 Fair";
  if (rainProb > 40 || code >= 3) return "☁️ Obscured";
  return "🔭 Moderate";
}

function getGoldenHourWindow(sunsetStr) {
  if (!sunsetStr || sunsetStr === "--:--") return "--";
  const parts = sunsetStr.split(":");
  let hr = parseInt(parts[0], 10);
  let mn = parseInt(parts[1], 10) - 45;
  if (mn < 0) { mn += 60; hr -= 1; }
  const pad = n => (n < 10 ? "0" + n : n);
  return `${pad(hr)}:${pad(mn)}–${sunsetStr}`;
}

// ==========================================================
// STORAGE MANAGEMENT
// ==========================================================

function getDayRecord(cityKey, dateStr) {
  const key = `WTR_v10_${cityKey}_${dateStr}`;
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return { snapshots: [] };
  try { return JSON.parse(raw); } catch (e) { return { snapshots: [] }; }
}

function saveDayRecord(cityKey, dateStr, record) {
  // Reject malformed dateStr at the source. Without this check, a caller bug
  // (e.g. undefined dateStr) creates a non-trimmable property key that
  // accumulates in ScriptProperties forever (cleanupOldStorageKeys only
  // deletes keys that match /^\d{4}-\d{2}-\d{2}$/).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) {
    Logger.log(`saveDayRecord: rejected malformed dateStr "${dateStr}" for city "${cityKey}"`);
    return;
  }
  const key = `WTR_v10_${cityKey}_${dateStr}`;
  if (record.snapshots && record.snapshots.length > MAX_SNAPSHOTS_PER_DAY) {
    record.snapshots = [
      record.snapshots[0],
      ...record.snapshots.slice(-(MAX_SNAPSHOTS_PER_DAY - 1))
    ];
  }
  try {
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(record));
  } catch (e) {
    Logger.log(`saveDayRecord: failed to persist ${key} — ${e}`);
  }
}

function cleanupOldStorageKeys() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  // resolveCalendar now auto-creates the calendar if missing, so it will not throw.
  // Still wrap defensively in case script lacks Calendar permission entirely.
  let calTz = "UTC";
  try {
    const cal = resolveCalendar();
    calTz = cal ? cal.getTimeZone() : "UTC";
  } catch (e) {
    Logger.log("cleanupOldStorageKeys: Calendar API unavailable — using UTC as cutoff timezone");
  }
  const cutoffStr = Utilities.formatDate(cutoff, calTz, "yyyy-MM-dd");

  Object.keys(all).forEach(k => {
    if (k.startsWith("WTR_v10_")) {
      const parts = k.split("_");
      const dateStr = parts[parts.length - 1];
      // Only compare against keys that look like a YYYY-MM-DD date. This
      // guards against legacy keys, manual props, or corrupted entries.
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr < cutoffStr) {
        props.deleteProperty(k);
      }
    }
  });
}

// ==========================================================
// UTILITIES & CALENDAR HELPERS
// ==========================================================

function computeDayAudit(snapshots, baselineMax, baselineRain, baselineAqi, sym) {
  if (!snapshots || snapshots.length === 0) {
    return { tempDelta: "±0" + sym, rainDelta: "0 mm", volatility: "Stable", snapshotsTaken: 0 };
  }
  if (snapshots.length === 1) {
    return { tempDelta: "±0" + sym, rainDelta: "0 mm", volatility: "Stable", snapshotsTaken: 1 };
  }
  if (!Number.isFinite(baselineMax) || !Number.isFinite(baselineRain)) {
    return { tempDelta: "n/a", rainDelta: "n/a", volatility: "🟡 Pending", snapshotsTaken: snapshots.length };
  }

  let maxTempDiff = 0, tempDeltaStr = "±0" + sym;
  let maxRainDiff = 0, rainDeltaStr = "0 mm";

  snapshots.forEach(snap => {
    const pMax = snap.predictedMax;
    if (!Number.isFinite(pMax)) return;
    const tDiff = pMax - baselineMax;
    const lead = snap.daysBeforeDDay !== undefined ? snap.daysBeforeDDay : (snap.daysAgoLogged || 0);
    const label = lead === 0 ? "D0" : `D${lead}`;

    if (Math.abs(tDiff) > Math.abs(maxTempDiff)) {
      maxTempDiff = tDiff;
      tempDeltaStr = `${tDiff > 0 ? "+" : ""}${tDiff}${sym} (${label})`;
    }
    const rDiff = (snap.predictedRain || 0) - baselineRain;
    if (Math.abs(rDiff) > Math.abs(maxRainDiff)) {
      maxRainDiff = rDiff;
      rainDeltaStr = `${rDiff > 0 ? "+" : ""}${rDiff.toFixed(1)} mm`;
    }
  });

  const absT = Math.abs(maxTempDiff);
  const volatility = absT >= 5 ? "🔴 High Drift" : (absT >= 3 ? "🟡 Moderate" : "🟢 Stable");
  return { tempDelta: tempDeltaStr, rainDelta: rainDeltaStr, volatility: volatility, snapshotsTaken: snapshots.length };
}

function isGeocodable(str) {
  if (!str) return false;
  const s = str.toLowerCase().trim();
  if (s.startsWith("http") || s.includes("zoom") || s.includes("teams") || s.includes("meet") || s.includes("room") || s.includes("desk") || s.includes("online")) {
    return false;
  }
  return s.length >= 3;
}

function isWeatherDashboardEvent(ev) {
  const desc = ev.getDescription() || "";
  if (KEY_REGEX.test(desc)) return true;
  const title = ev.getTitle() || "";
  return /^[☀️🌤️⛅☁️🌫️🌦️🌧️🌊❄️🌨️⚡🎯⚖️🎲]/.test(title);
}

function resolveCalendar() {
  if (CONFIG.calendarId) {
    const cal = CalendarApp.getCalendarById(CONFIG.calendarId);
    if (cal) return cal;
    throw new Error(
      "Calendar not found by id '" + CONFIG.calendarId + "'. " +
      "Verify CONFIG.calendarId in your script properties, or clear it to auto-resolve by name."
    );
  }
  const cals = CalendarApp.getCalendarsByName(CONFIG.calendarName);
  if (cals.length > 0) return cals[0];
  Logger.log("resolveCalendar: '" + CONFIG.calendarName + "' not found — creating it");
  const newCal = CalendarApp.createCalendar(CONFIG.calendarName, {
    summary: "Weather & celestial events for configured locations",
    location: "",
    timeZone: Session.getScriptTimeZone()
  });
  newCal.setSelected(false);
  Logger.log("Created calendar '" + newCal.getName() + "' (" + newCal.getId() + ")");
  return newCal;
}

function norm(str) {
  if (str == null) return "";
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isValidLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
         Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function detectEventCity(text, locationPool) {
  if (!text) return null;
  const normalizedText = norm(text);

  const sortedKeys = Array.from(locationPool.keys()).sort((a, b) => b.length - a.length);
  for (let key of sortedKeys) {
    if (normalizedText.includes(key)) return key;
  }
  return null;
}

function getEventColorEnum(t, isLong, isC) {
  if (isLong) return CalendarApp.EventColor.GRAY;
  if (t == null || isNaN(t)) return CalendarApp.EventColor.PALE_BLUE;
  const c = isC ? t : (t - 32) * (5 / 9);
  if (c <= 0) return CalendarApp.EventColor.PALE_BLUE;  // 1 (Lavender)
  if (c <= 10) return CalendarApp.EventColor.CYAN;       // 7 (Peacock)
  if (c <= 20) return CalendarApp.EventColor.PALE_GREEN; // 2 (Sage)
  if (c <= 26) return CalendarApp.EventColor.YELLOW;     // 5 (Banana)
  if (c <= 32) return CalendarApp.EventColor.ORANGE;     // 6 (Tangerine)
  return CalendarApp.EventColor.RED;                     // 11 (Flamingo/Tomato)
}

function getWeatherGlyph(code) {
  if (code === null || code === undefined || isNaN(code)) return "🌤️";
  code = Number(code);
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return code === 65 ? "🌊" : "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code === 85 || code === 86) return "🌨️";
  if (code >= 95) return "⚡";
  return "🌤️";
}

function getWeatherName(code) {
  if (code === null || code === undefined || isNaN(code)) return "Fair";
  code = Number(code);
  if (code === 0) return "Clear Sky";
  if (code === 1) return "Mainly Clear";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow Showers";
  if (code >= 95) return "Thunderstorm";
  return "Fair";
}

function getThermalText(t, isC) {
  if (t == null || isNaN(t)) return "Freezing";
  const c = isC ? t : (t - 32) * (5 / 9);
  if (c <= 0) return "Freezing";
  if (c <= 10) return "Chilly";
  if (c <= 20) return "Comfortable";
  if (c <= 26) return "Pleasant";
  if (c <= 32) return "Warm";
  return "Hot";
}

function getAqiGlyph(aqi, aqiType) {
  if (aqi === null) return "🍃";
  if (aqiType === "USAQI") {
    if (aqi <= 50) return "🟢";
    if (aqi <= 100) return "🟡";
    if (aqi <= 150) return "🟠";
    if (aqi <= 200) return "🔴";
    if (aqi <= 300) return "🟤";
    return "🟣";
  }
  if (aqi <= 20) return "🟢";
  if (aqi <= 40) return "🟡";
  if (aqi <= 60) return "🟠";
  if (aqi <= 80) return "🔴";
  return "🟣";
}

function getAqiScale(aqiType) {
  if (aqiType === "EAQI") return 100;
  if (aqiType === "USAQI") return 500;
  return null;
}

function getAqiLabel(aqi, aqiType) {
  if (aqi == null || isNaN(aqi)) return "Unknown";
  if (aqiType === "USAQI") {
    if (aqi <= 50) return "Good";
    if (aqi <= 100) return "Moderate";
    if (aqi <= 150) return "Unhealthy for Sensitive";
    if (aqi <= 200) return "Unhealthy";
    if (aqi <= 300) return "Very Unhealthy";
    return "Hazardous";
  }
  if (aqi <= 20) return "Good";
  if (aqi <= 40) return "Fair";
  if (aqi <= 60) return "Moderate";
  if (aqi <= 80) return "Poor";
  return "Hazardous";
}

function getUvAdvice(uv) {
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  return "Very High";
}

function validateConfig() {
  const errors = [];
  CONFIG.locations.forEach((loc, i) => {
    if (!loc.name) {
      errors.push(`Location ${i}: missing 'name' field`);
    }
    if (!loc.lat || !loc.lon) {
      errors.push(`Location ${i} ('${loc.name || "unnamed"}'): no coordinates — geocoding required`);
      const geo = geocodeCity(loc.name || "");
      if (!geo || !geo.lat || !geo.lon) {
        errors.push(`  geocodeCity('${loc.name}') failed — city not found in Open-Meteo database`);
      } else {
        Logger.log(`  geocoded to: ${geo.lat}, ${geo.lon}`);
      }
    }
  });
  if (errors.length === 0) {
    Logger.log("Config validation: OK");
  } else {
    errors.forEach(e => Logger.log("Config error: " + e));
  }
  return errors;
}
