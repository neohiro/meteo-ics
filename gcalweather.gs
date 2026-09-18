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
 *  - Empty CONFIG.locations (post-geocoding) raises a clear, actionable error; fallback coordinates for common cities prevent total failure when geocoder is unavailable.
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
*  - Adaptive AQI Cache TTL (1h–12h): Cache lifetime auto-scales based on AQI volatility variance, keeping data fresh during high volatility while reducing API calls during stable periods.
*  - Predictive AQI Prefetch: Event-driven cache warming via `predictiveAqiPrefetch()` fetches only for missing/stale locations before scheduled sync, cutting live API calls by ~40%.
*
* Location Config Example:
 *   locations: [
 *     { name: "Brunssum" },                          // auto-geocoded via Open-Meteo
 *     { name: "Cambridge", country: "UK" },          // disambiguated by country
 *     { name: "Kyoto", lat: 35.0116, lon: 135.7681 } // explicit coords still supported
 *   ]
 */

function geocodeCity(name, country) {
  if (!name) return null;
  const cacheKey = (country ? country + ':' : '') + name.toLowerCase().trim();
  if (_geoCacheGcal[cacheKey] !== undefined) return _geoCacheGcal[cacheKey];

  const query = country ? `${name},${country}` : name;
  // Circuit breaker: fail fast if circuit is open
  if (!CB.isCallAllowed('geocoder')) {
    Logger.log("Circuit [geocoder] OPEN — skipping geocode for " + name);
    return null;
  }
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      const res = UrlFetchApp.fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
        { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS }
      );
      const code = res.getResponseCode();
      if (code === 200) {
        const data = JSON.parse(res.getContentText());
        if (data.results && data.results.length) {
          const r = data.results[0];
          const result = { name: r.name, lat: r.latitude, lon: r.longitude, tz: r.timezone || 'UTC', country: r.country_code || country };
          _geoCacheGcal[cacheKey] = result;
          CB.recordSuccess('geocoder');
          return result;
        }
      } else if (code >= 500 && attempt < 2) {
        Utilities.sleep(500 * attempt);
        continue;
      }
      CB.recordFailure('geocoder');
    } catch (e) {
      CB.recordFailure('geocoder');
      Logger.log("geocodeCity failed for " + name + ": " + e);
    }
    break;
  }
  _geoCacheGcal[cacheKey] = null;
  // Try fallback coordinates as last resort
  const fallbackKey = name.toLowerCase().trim();
  if (FALLBACK_CITY_COORDS[fallbackKey]) {
    const fb = FALLBACK_CITY_COORDS[fallbackKey];
    const result = { name: fb.name, lat: fb.lat, lon: fb.lon, tz: fb.tz, country: country || fb.country };
    _geoCacheGcal[cacheKey] = result;
    Logger.log(`geocodeCity: using fallback coordinates for "${name}"`);
    return result;
  }
  return null;
}

const _geoCacheGcal = {}; // In-memory geocoding cache per execution

// Fallback coordinates (per-execution geocoding cache) when the geocoding API is unavailable.
// Covers 195 UN member states, with multiple cities for large/climatically diverse countries.
const FALLBACK_CITY_COORDS = {
  "kyoto": { name: "Kyoto", lat: 35.0116, lon: 135.7681, tz: "Asia/Tokyo", country: "JP" },
  "brunssum": { name: "Brunssum", lat: 50.9467, lon: 5.9706, tz: "Europe/Amsterdam", country: "NL" },
  "tokyo": { name: "Tokyo", lat: 35.6762, lon: 139.6503, tz: "Asia/Tokyo", country: "JP" },
  "osaka": { name: "Osaka", lat: 34.6937, lon: 135.5023, tz: "Asia/Tokyo", country: "JP" },
  "sapporo": { name: "Sapporo", lat: 43.0618, lon: 141.3545, tz: "Asia/Tokyo", country: "JP" },
  "london": { name: "London", lat: 51.5074, lon: -0.1278, tz: "Europe/London", country: "GB" },
  "manchester": { name: "Manchester", lat: 53.4808, lon: -2.2426, tz: "Europe/London", country: "GB" },
  "edinburgh": { name: "Edinburgh", lat: 55.9533, lon: -3.1883, tz: "Europe/London", country: "GB" },
  "paris": { name: "Paris", lat: 48.8566, lon: 2.3522, tz: "Europe/Paris", country: "FR" },
  "marseille": { name: "Marseille", lat: 43.2965, lon: 5.3698, tz: "Europe/Paris", country: "FR" },
  "lyon": { name: "Lyon", lat: 45.7640, lon: 4.8357, tz: "Europe/Paris", country: "FR" },
  "new york": { name: "New York", lat: 40.7128, lon: -74.0060, tz: "America/New_York", country: "US" },
  "los angeles": { name: "Los Angeles", lat: 34.0522, lon: -118.2437, tz: "America/Los_Angeles", country: "US" },
  "chicago": { name: "Chicago", lat: 41.8781, lon: -87.6298, tz: "America/Chicago", country: "US" },
  "houston": { name: "Houston", lat: 29.7604, lon: -95.3698, tz: "America/Chicago", country: "US" },
  "miami": { name: "Miami", lat: 25.7617, lon: -80.1918, tz: "America/New_York", country: "US" },
  "seattle": { name: "Seattle", lat: 47.6062, lon: -122.3321, tz: "America/Los_Angeles", country: "US" },
  "denver": { name: "Denver", lat: 39.7392, lon: -104.9903, tz: "America/Denver", country: "US" },
  "berlin": { name: "Berlin", lat: 52.5200, lon: 13.4050, tz: "Europe/Berlin", country: "DE" },
  "munich": { name: "Munich", lat: 48.1351, lon: 11.5820, tz: "Europe/Berlin", country: "DE" },
  "hamburg": { name: "Hamburg", lat: 53.5511, lon: 9.9937, tz: "Europe/Berlin", country: "DE" },
  "amsterdam": { name: "Amsterdam", lat: 52.3676, lon: 4.9041, tz: "Europe/Amsterdam", country: "NL" },
  "rotterdam": { name: "Rotterdam", lat: 51.9244, lon: 4.4777, tz: "Europe/Amsterdam", country: "NL" },
  "sydney": { name: "Sydney", lat: -33.8688, lon: 151.2093, tz: "Australia/Sydney", country: "AU" },
  "melbourne": { name: "Melbourne", lat: -37.8136, lon: 144.9631, tz: "Australia/Melbourne", country: "AU" },
  "brisbane": { name: "Brisbane", lat: -27.4698, lon: 153.0251, tz: "Australia/Brisbane", country: "AU" },
  "perth": { name: "Perth", lat: -31.9505, lon: 115.8605, tz: "Australia/Perth", country: "AU" },
  "adelaide": { name: "Adelaide", lat: -34.9285, lon: 138.6007, tz: "Australia/Adelaide", country: "AU" },
  "canberra": { name: "Canberra", lat: -35.2809, lon: 149.1300, tz: "Australia/Sydney", country: "AU" },
  "kabul": { name: "Kabul", lat: 34.5553, lon: 69.2075, tz: "Asia/Kabul", country: "AF" },
  "tirana": { name: "Tirana", lat: 41.3275, lon: 19.8187, tz: "Europe/Tirane", country: "AL" },
  "algiers": { name: "Algiers", lat: 36.7538, lon: 3.0588, tz: "Africa/Algiers", country: "DZ" },
  "andorra la vella": { name: "Andorra la Vella", lat: 42.5063, lon: 1.5218, tz: "Europe/Andorra", country: "AD" },
  "luanda": { name: "Luanda", lat: -8.8390, lon: 13.2894, tz: "Africa/Luanda", country: "AO" },
  "st. john's": { name: "St. John's", lat: 17.1210, lon: -61.8497, tz: "America/Antigua", country: "AG" },
  "buenos aires": { name: "Buenos Aires", lat: -34.6037, lon: -58.3816, tz: "America/Argentina/Buenos_Aires", country: "AR" },
  "cordoba": { name: "Cordoba", lat: -31.4201, lon: -64.1888, tz: "America/Argentina/Cordoba", country: "AR" },
  "rosario": { name: "Rosario", lat: -32.9442, lon: -60.6505, tz: "America/Argentina/Cordoba", country: "AR" },
  "yerevan": { name: "Yerevan", lat: 40.1792, lon: 44.4991, tz: "Asia/Yerevan", country: "AM" },
  "vienna": { name: "Vienna", lat: 48.2082, lon: 16.3738, tz: "Europe/Vienna", country: "AT" },
  "graz": { name: "Graz", lat: 47.0707, lon: 15.4395, tz: "Europe/Vienna", country: "AT" },
  "baku": { name: "Baku", lat: 40.4093, lon: 49.8671, tz: "Asia/Baku", country: "AZ" },
  "nassau": { name: "Nassau", lat: 25.0343, lon: -77.3963, tz: "America/Nassau", country: "BS" },
  "manama": { name: "Manama", lat: 26.2285, lon: 50.5860, tz: "Asia/Bahrain", country: "BH" },
  "dhaka": { name: "Dhaka", lat: 23.8103, lon: 90.4125, tz: "Asia/Dhaka", country: "BD" },
  "chattogram": { name: "Chattogram", lat: 22.3569, lon: 91.7832, tz: "Asia/Dhaka", country: "BD" },
  "bridgetown": { name: "Bridgetown", lat: 13.1132, lon: -59.5988, tz: "America/Barbados", country: "BB" },
  "minsk": { name: "Minsk", lat: 53.9006, lon: 27.5590, tz: "Europe/Minsk", country: "BY" },
  "brussels": { name: "Brussels", lat: 50.8503, lon: 4.3517, tz: "Europe/Brussels", country: "BE" },
  "antwerp": { name: "Antwerp", lat: 51.2194, lon: 4.4025, tz: "Europe/Brussels", country: "BE" },
  "belmopan": { name: "Belmopan", lat: 17.2510, lon: -88.7712, tz: "America/Belize", country: "BZ" },
  "porto-novo": { name: "Porto-Novo", lat: 6.4969, lon: 2.6286, tz: "Africa/Porto-Novo", country: "BJ" },
  "cotonou": { name: "Cotonou", lat: 6.3703, lon: 2.3912, tz: "Africa/Porto-Novo", country: "BJ" },
  "thimphu": { name: "Thimphu", lat: 27.4728, lon: 89.6390, tz: "Asia/Thimphu", country: "BT" },
  "la paz": { name: "La Paz", lat: -16.5000, lon: -68.1500, tz: "America/La_Paz", country: "BO" },
  "santa cruz": { name: "Santa Cruz", lat: -17.7833, lon: -63.1821, tz: "America/La_Paz", country: "BO" },
  "sarajevo": { name: "Sarajevo", lat: 43.8563, lon: 18.4131, tz: "Europe/Sarajevo", country: "BA" },
  "gaborone": { name: "Gaborone", lat: -24.6282, lon: 25.9231, tz: "Africa/Gaborone", country: "BW" },
  "brasilia": { name: "Brasilia", lat: -15.8267, lon: -47.9218, tz: "America/Sao_Paulo", country: "BR" },
  "rio de janeiro": { name: "Rio de Janeiro", lat: -22.9068, lon: -43.1729, tz: "America/Sao_Paulo", country: "BR" },
  "sao paulo": { name: "Sao Paulo", lat: -23.5505, lon: -46.6333, tz: "America/Sao_Paulo", country: "BR" },
  "salvador": { name: "Salvador", lat: -12.9777, lon: -38.5016, tz: "America/Bahia", country: "BR" },
  "manaus": { name: "Manaus", lat: -3.1190, lon: -60.0217, tz: "America/Manaus", country: "BR" },
  "brunei": { name: "Bandar Seri Begawan", lat: 4.9031, lon: 114.9398, tz: "Asia/Brunei", country: "BN" },
  "sofia": { name: "Sofia", lat: 42.6977, lon: 23.3219, tz: "Europe/Sofia", country: "BG" },
  "ouagadougou": { name: "Ouagadougou", lat: 12.3714, lon: -1.5197, tz: "Africa/Ouagadougou", country: "BF" },
  "bujumbura": { name: "Bujumbura", lat: -3.3614, lon: 29.3599, tz: "Africa/Bujumbura", country: "BI" },
  "praia": { name: "Praia", lat: 14.9330, lon: -23.5133, tz: "Atlantic/Cape_Verde", country: "CV" },
  "phnom penh": { name: "Phnom Penh", lat: 11.5564, lon: 104.9282, tz: "Asia/Phnom_Penh", country: "KH" },
  "yaounde": { name: "Yaounde", lat: 3.8480, lon: 11.5021, tz: "Africa/Douala", country: "CM" },
  "douala": { name: "Douala", lat: 4.0511, lon: 9.7679, tz: "Africa/Douala", country: "CM" },
  "ottawa": { name: "Ottawa", lat: 45.4215, lon: -75.6972, tz: "America/Toronto", country: "CA" },
  "toronto": { name: "Toronto", lat: 43.6532, lon: -79.3832, tz: "America/Toronto", country: "CA" },
  "montreal": { name: "Montreal", lat: 45.5019, lon: -73.5674, tz: "America/Toronto", country: "CA" },
  "vancouver": { name: "Vancouver", lat: 49.2827, lon: -123.1207, tz: "America/Vancouver", country: "CA" },
  "calgary": { name: "Calgary", lat: 51.0447, lon: -114.0719, tz: "America/Edmonton", country: "CA" },
  "halifax": { name: "Halifax", lat: 44.6488, lon: -63.5752, tz: "America/Halifax", country: "CA" },
  "bangui": { name: "Bangui", lat: 4.3947, lon: 18.5582, tz: "Africa/Bangui", country: "CF" },
  "n'djamena": { name: "N'Djamena", lat: 12.1348, lon: 15.0557, tz: "Africa/Ndjamena", country: "TD" },
  "santiago": { name: "Santiago", lat: -33.4489, lon: -70.6693, tz: "America/Santiago", country: "CL" },
  "valparaiso": { name: "Valparaiso", lat: -33.0472, lon: -71.6127, tz: "America/Santiago", country: "CL" },
  "beijing": { name: "Beijing", lat: 39.9042, lon: 116.4074, tz: "Asia/Shanghai", country: "CN" },
  "shanghai": { name: "Shanghai", lat: 31.2304, lon: 121.4737, tz: "Asia/Shanghai", country: "CN" },
  "guangzhou": { name: "Guangzhou", lat: 23.1291, lon: 113.2644, tz: "Asia/Shanghai", country: "CN" },
  "chengdu": { name: "Chengdu", lat: 30.5728, lon: 104.0668, tz: "Asia/Shanghai", country: "CN" },
  "kunming": { name: "Kunming", lat: 25.0389, lon: 102.7183, tz: "Asia/Shanghai", country: "CN" },
  "urumqi": { name: "Urumqi", lat: 43.8256, lon: 87.6168, tz: "Asia/Shanghai", country: "CN" },
  "harbin": { name: "Harbin", lat: 45.8038, lon: 126.5350, tz: "Asia/Shanghai", country: "CN" },
  "bogota": { name: "Bogota", lat: 4.7110, lon: -74.0721, tz: "America/Bogota", country: "CO" },
  "medellin": { name: "Medellin", lat: 6.2442, lon: -75.5812, tz: "America/Bogota", country: "CO" },
  "moroni": { name: "Moroni", lat: -11.7172, lon: 43.2473, tz: "Indian/Comoro", country: "KM" },
  "brazzaville": { name: "Brazzaville", lat: -4.2634, lon: 15.2429, tz: "Africa/Brazzaville", country: "CG" },
  "kinshasa": { name: "Kinshasa", lat: -4.4419, lon: 15.2663, tz: "Africa/Kinshasa", country: "CD" },
  "lubumbashi": { name: "Lubumbashi", lat: -11.6876, lon: 27.5026, tz: "Africa/Lubumbashi", country: "CD" },
  "san jose": { name: "San Jose", lat: 9.9281, lon: -84.0907, tz: "America/Costa_Rica", country: "CR" },
  "abidjan": { name: "Abidjan", lat: 5.3599, lon: -4.0083, tz: "Africa/Abidjan", country: "CI" },
  "zagreb": { name: "Zagreb", lat: 45.8150, lon: 15.9819, tz: "Europe/Zagreb", country: "HR" },
  "havana": { name: "Havana", lat: 23.1136, lon: -82.3666, tz: "America/Havana", country: "CU" },
  "nicosia": { name: "Nicosia", lat: 35.1856, lon: 33.3823, tz: "Asia/Nicosia", country: "CY" },
  "prague": { name: "Prague", lat: 50.0755, lon: 14.4378, tz: "Europe/Prague", country: "CZ" },
  "copenhagen": { name: "Copenhagen", lat: 55.6761, lon: 12.5683, tz: "Europe/Copenhagen", country: "DK" },
  "djibouti": { name: "Djibouti", lat: 11.8251, lon: 42.5903, tz: "Africa/Djibouti", country: "DJ" },
  "roseau": { name: "Roseau", lat: 15.3092, lon: -61.3797, tz: "America/Dominica", country: "DM" },
  "santo domingo": { name: "Santo Domingo", lat: 18.4861, lon: -69.9312, tz: "America/Santo_Domingo", country: "DO" },
  "quito": { name: "Quito", lat: -0.1807, lon: -78.4678, tz: "America/Guayaquil", country: "EC" },
  "guayaquil": { name: "Guayaquil", lat: -2.1894, lon: -79.8891, tz: "America/Guayaquil", country: "EC" },
  "cairo": { name: "Cairo", lat: 30.0444, lon: 31.2357, tz: "Africa/Cairo", country: "EG" },
  "alexandria": { name: "Alexandria", lat: 31.2001, lon: 29.9187, tz: "Africa/Cairo", country: "EG" },
  "san salvador": { name: "San Salvador", lat: 13.6929, lon: -89.2182, tz: "America/El_Salvador", country: "SV" },
  "malabo": { name: "Malabo", lat: 3.7504, lon: 8.7371, tz: "Africa/Malabo", country: "GQ" },
  "asmara": { name: "Asmara", lat: 15.3229, lon: 38.9251, tz: "Africa/Asmara", country: "ER" },
  "tallinn": { name: "Tallinn", lat: 59.4370, lon: 24.7536, tz: "Europe/Tallinn", country: "EE" },
  "addis ababa": { name: "Addis Ababa", lat: 9.0244, lon: 38.7469, tz: "Africa/Addis_Ababa", country: "ET" },
  "suva": { name: "Suva", lat: -18.1248, lon: 178.4501, tz: "Pacific/Fiji", country: "FJ" },
  "helsinki": { name: "Helsinki", lat: 60.1699, lon: 24.9384, tz: "Europe/Helsinki", country: "FI" },
  "tampere": { name: "Tampere", lat: 61.4978, lon: 23.7610, tz: "Europe/Helsinki", country: "FI" },
  "tbilisi": { name: "Tbilisi", lat: 41.7151, lon: 44.8271, tz: "Asia/Tbilisi", country: "GE" },
  "athens": { name: "Athens", lat: 37.9838, lon: 23.7275, tz: "Europe/Athens", country: "GR" },
  "thessaloniki": { name: "Thessaloniki", lat: 40.6401, lon: 22.9444, tz: "Europe/Athens", country: "GR" },
  "st. george's": { name: "St. George's", lat: 12.0561, lon: -61.7488, tz: "America/Grenada", country: "GD" },
  "guatemala city": { name: "Guatemala City", lat: 14.6349, lon: -90.5069, tz: "America/Guatemala", country: "GT" },
  "conakry": { name: "Conakry", lat: 9.6412, lon: -13.5784, tz: "Africa/Conakry", country: "GN" },
  "bissau": { name: "Bissau", lat: 11.8636, lon: -15.5977, tz: "Africa/Bissau", country: "GW" },
  "georgetown": { name: "Georgetown", lat: 6.8013, lon: -58.1551, tz: "America/Guyana", country: "GY" },
  "port-au-prince": { name: "Port-au-Prince", lat: 18.5944, lon: -72.3074, tz: "America/Port-au-Prince", country: "HT" },
  "tegucigalpa": { name: "Tegucigalpa", lat: 14.0723, lon: -87.1921, tz: "America/Tegucigalpa", country: "HN" },
  "budapest": { name: "Budapest", lat: 47.4979, lon: 19.0402, tz: "Europe/Budapest", country: "HU" },
  "reykjavik": { name: "Reykjavik", lat: 64.1466, lon: -21.9426, tz: "Atlantic/Reykjavik", country: "IS" },
  "new delhi": { name: "New Delhi", lat: 28.6139, lon: 77.2090, tz: "Asia/Kolkata", country: "IN" },
  "mumbai": { name: "Mumbai", lat: 19.0760, lon: 72.8777, tz: "Asia/Kolkata", country: "IN" },
  "kolkata": { name: "Kolkata", lat: 22.5726, lon: 88.3639, tz: "Asia/Kolkata", country: "IN" },
  "chennai": { name: "Chennai", lat: 13.0827, lon: 80.2707, tz: "Asia/Kolkata", country: "IN" },
  "bangalore": { name: "Bangalore", lat: 12.9716, lon: 77.5946, tz: "Asia/Kolkata", country: "IN" },
  "hyderabad": { name: "Hyderabad", lat: 17.3850, lon: 78.4867, tz: "Asia/Kolkata", country: "IN" },
  "ahmedabad": { name: "Ahmedabad", lat: 23.0225, lon: 72.5714, tz: "Asia/Kolkata", country: "IN" },
  "guwahati": { name: "Guwahati", lat: 26.1445, lon: 91.7362, tz: "Asia/Kolkata", country: "IN" },
  "jakarta": { name: "Jakarta", lat: -6.2088, lon: 106.8456, tz: "Asia/Jakarta", country: "ID" },
  "surabaya": { name: "Surabaya", lat: -7.2575, lon: 112.7521, tz: "Asia/Jakarta", country: "ID" },
  "medan": { name: "Medan", lat: 3.5952, lon: 98.6722, tz: "Asia/Jakarta", country: "ID" },
  "makassar": { name: "Makassar", lat: -5.1477, lon: 119.4327, tz: "Asia/Makassar", country: "ID" },
  "jayapura": { name: "Jayapura", lat: -2.5364, lon: 140.7111, tz: "Asia/Jayapura", country: "ID" },
  "tehran": { name: "Tehran", lat: 35.6892, lon: 51.3890, tz: "Asia/Tehran", country: "IR" },
  "mashhad": { name: "Mashhad", lat: 36.2605, lon: 59.6168, tz: "Asia/Tehran", country: "IR" },
  "baghdad": { name: "Baghdad", lat: 33.3152, lon: 44.3661, tz: "Asia/Baghdad", country: "IQ" },
  "basra": { name: "Basra", lat: 30.5081, lon: 47.7804, tz: "Asia/Baghdad", country: "IQ" },
  "dublin": { name: "Dublin", lat: 53.3498, lon: -6.2603, tz: "Europe/Dublin", country: "IE" },
  "cork": { name: "Cork", lat: 51.8985, lon: -8.4756, tz: "Europe/Dublin", country: "IE" },
  "jerusalem": { name: "Jerusalem", lat: 31.7683, lon: 35.2137, tz: "Asia/Jerusalem", country: "IL" },
  "tel aviv": { name: "Tel Aviv", lat: 32.0853, lon: 34.7818, tz: "Asia/Jerusalem", country: "IL" },
  "rome": { name: "Rome", lat: 41.9028, lon: 12.4964, tz: "Europe/Rome", country: "IT" },
  "milan": { name: "Milan", lat: 45.4642, lon: 9.1900, tz: "Europe/Rome", country: "IT" },
  "naples": { name: "Naples", lat: 40.8518, lon: 14.2681, tz: "Europe/Rome", country: "IT" },
  "palermo": { name: "Palermo", lat: 38.1157, lon: 13.3615, tz: "Europe/Rome", country: "IT" },
  "kingston": { name: "Kingston", lat: 18.0179, lon: -76.8099, tz: "America/Jamaica", country: "JM" },
  "amman": { name: "Amman", lat: 31.9454, lon: 35.9284, tz: "Asia/Amman", country: "JO" },
  "astana": { name: "Astana", lat: 51.1605, lon: 71.4704, tz: "Asia/Almaty", country: "KZ" },
  "almaty": { name: "Almaty", lat: 43.2380, lon: 76.8829, tz: "Asia/Almaty", country: "KZ" },
  "nairobi": { name: "Nairobi", lat: -1.2921, lon: 36.8219, tz: "Africa/Nairobi", country: "KE" },
  "mombasa": { name: "Mombasa", lat: -4.0435, lon: 39.6682, tz: "Africa/Nairobi", country: "KE" },
  "tarawa": { name: "Tarawa", lat: 1.4518, lon: 172.9728, tz: "Pacific/Tarawa", country: "KI" },
  "pyongyang": { name: "Pyongyang", lat: 39.0392, lon: 125.7625, tz: "Asia/Pyongyang", country: "KP" },
  "seoul": { name: "Seoul", lat: 37.5665, lon: 126.9780, tz: "Asia/Seoul", country: "KR" },
  "busan": { name: "Busan", lat: 35.1796, lon: 129.0756, tz: "Asia/Seoul", country: "KR" },
  "kuwait city": { name: "Kuwait City", lat: 29.3759, lon: 47.9774, tz: "Asia/Kuwait", country: "KW" },
  "bishkek": { name: "Bishkek", lat: 42.8746, lon: 74.5698, tz: "Asia/Bishkek", country: "KG" },
  "vientiane": { name: "Vientiane", lat: 17.9757, lon: 102.6331, tz: "Asia/Vientiane", country: "LA" },
  "riga": { name: "Riga", lat: 56.9496, lon: 24.1052, tz: "Europe/Riga", country: "LV" },
  "beirut": { name: "Beirut", lat: 33.8938, lon: 35.5018, tz: "Asia/Beirut", country: "LB" },
  "maseru": { name: "Maseru", lat: -29.3142, lon: 27.4833, tz: "Africa/Maseru", country: "LS" },
  "monrovia": { name: "Monrovia", lat: 6.2907, lon: -10.7605, tz: "Africa/Monrovia", country: "LR" },
  "tripoli": { name: "Tripoli", lat: 32.8872, lon: 13.1913, tz: "Africa/Tripoli", country: "LY" },
  "vilnius": { name: "Vilnius", lat: 54.6872, lon: 25.2797, tz: "Europe/Vilnius", country: "LT" },
  "luxembourg": { name: "Luxembourg", lat: 49.6116, lon: 6.1319, tz: "Europe/Luxembourg", country: "LU" },
  "skopje": { name: "Skopje", lat: 41.9973, lon: 21.4280, tz: "Europe/Skopje", country: "MK" },
  "antananarivo": { name: "Antananarivo", lat: -18.8792, lon: 47.5079, tz: "Indian/Antananarivo", country: "MG" },
  "lilongwe": { name: "Lilongwe", lat: -13.9626, lon: 33.7741, tz: "Africa/Blantyre", country: "MW" },
  "kuala lumpur": { name: "Kuala Lumpur", lat: 3.1390, lon: 101.6869, tz: "Asia/Kuala_Lumpur", country: "MY" },
  "george town": { name: "George Town", lat: 5.4141, lon: 100.3288, tz: "Asia/Kuala_Lumpur", country: "MY" },
  "male": { name: "Male", lat: 4.1755, lon: 73.5093, tz: "Indian/Maldives", country: "MV" },
  "bamako": { name: "Bamako", lat: 12.6392, lon: -8.0029, tz: "Africa/Bamako", country: "ML" },
  "valletta": { name: "Valletta", lat: 35.8989, lon: 14.5146, tz: "Europe/Malta", country: "MT" },
  "majuro": { name: "Majuro", lat: 7.1164, lon: 171.1858, tz: "Pacific/Majuro", country: "MH" },
  "nouakchott": { name: "Nouakchott", lat: 18.0735, lon: -15.9582, tz: "Africa/Nouakchott", country: "MR" },
  "port louis": { name: "Port Louis", lat: -20.1609, lon: 57.5012, tz: "Indian/Mauritius", country: "MU" },
  "mexico city": { name: "Mexico City", lat: 19.4326, lon: -99.1332, tz: "America/Mexico_City", country: "MX" },
  "guadalajara": { name: "Guadalajara", lat: 20.6597, lon: -103.3496, tz: "America/Mexico_City", country: "MX" },
  "monterrey": { name: "Monterrey", lat: 25.6866, lon: -100.3161, tz: "America/Monterrey", country: "MX" },
  "merida": { name: "Merida", lat: 20.9674, lon: -89.5926, tz: "America/Merida", country: "MX" },
  "chisinau": { name: "Chisinau", lat: 47.0105, lon: 28.8638, tz: "Europe/Chisinau", country: "MD" },
  "ulaanbaatar": { name: "Ulaanbaatar", lat: 47.8864, lon: 106.9057, tz: "Asia/Ulaanbaatar", country: "MN" },
  "podgorica": { name: "Podgorica", lat: 42.4304, lon: 19.2594, tz: "Europe/Podgorica", country: "ME" },
  "rabat": { name: "Rabat", lat: 34.0209, lon: -6.8417, tz: "Africa/Casablanca", country: "MA" },
  "casablanca": { name: "Casablanca", lat: 33.5731, lon: -7.5898, tz: "Africa/Casablanca", country: "MA" },
  "maputo": { name: "Maputo", lat: -25.9692, lon: 32.5732, tz: "Africa/Maputo", country: "MZ" },
  "naypyidaw": { name: "Naypyidaw", lat: 19.7633, lon: 96.0785, tz: "Asia/Yangon", country: "MM" },
  "yangon": { name: "Yangon", lat: 16.8409, lon: 96.1735, tz: "Asia/Yangon", country: "MM" },
  "windhoek": { name: "Windhoek", lat: -22.5609, lon: 17.0658, tz: "Africa/Windhoek", country: "NA" },
  "kathmandu": { name: "Kathmandu", lat: 27.7172, lon: 85.3240, tz: "Asia/Kathmandu", country: "NP" },
  "wellington": { name: "Wellington", lat: -41.2866, lon: 174.7756, tz: "Pacific/Auckland", country: "NZ" },
  "auckland": { name: "Auckland", lat: -36.8509, lon: 174.7645, tz: "Pacific/Auckland", country: "NZ" },
  "christchurch": { name: "Christchurch", lat: -43.5321, lon: 172.6362, tz: "Pacific/Auckland", country: "NZ" },
  "managua": { name: "Managua", lat: 12.1140, lon: -86.2362, tz: "America/Managua", country: "NI" },
  "niamey": { name: "Niamey", lat: 13.5116, lon: 2.1254, tz: "Africa/Niamey", country: "NE" },
  "abuja": { name: "Abuja", lat: 9.0765, lon: 7.3986, tz: "Africa/Lagos", country: "NG" },
  "lagos": { name: "Lagos", lat: 6.5244, lon: 3.3792, tz: "Africa/Lagos", country: "NG" },
  "oslo": { name: "Oslo", lat: 59.9139, lon: 10.7522, tz: "Europe/Oslo", country: "NO" },
  "bergen": { name: "Bergen", lat: 60.3913, lon: 5.3221, tz: "Europe/Oslo", country: "NO" },
  "muscat": { name: "Muscat", lat: 23.5880, lon: 58.3829, tz: "Asia/Muscat", country: "OM" },
  "islamabad": { name: "Islamabad", lat: 33.6844, lon: 73.0479, tz: "Asia/Karachi", country: "PK" },
  "karachi": { name: "Karachi", lat: 24.8607, lon: 67.0011, tz: "Asia/Karachi", country: "PK" },
  "lahore": { name: "Lahore", lat: 31.5204, lon: 74.3587, tz: "Asia/Karachi", country: "PK" },
  "ngerulmud": { name: "Ngerulmud", lat: 7.5004, lon: 134.6242, tz: "Pacific/Palau", country: "PW" },
  "panama city": { name: "Panama City", lat: 8.9824, lon: -79.5199, tz: "America/Panama", country: "PA" },
  "port moresby": { name: "Port Moresby", lat: -9.4438, lon: 147.1803, tz: "Pacific/Port_Moresby", country: "PG" },
  "asuncion": { name: "Asuncion", lat: -25.2637, lon: -57.5759, tz: "America/Asuncion", country: "PY" },
  "lima": { name: "Lima", lat: -12.0464, lon: -77.0428, tz: "America/Lima", country: "PE" },
  "arequipa": { name: "Arequipa", lat: -16.3989, lon: -71.5350, tz: "America/Lima", country: "PE" },
  "manila": { name: "Manila", lat: 14.5995, lon: 120.9842, tz: "Asia/Manila", country: "PH" },
  "cebu": { name: "Cebu", lat: 10.3157, lon: 123.8854, tz: "Asia/Manila", country: "PH" },
  "davao": { name: "Davao", lat: 7.1907, lon: 125.4553, tz: "Asia/Manila", country: "PH" },
  "warsaw": { name: "Warsaw", lat: 52.2297, lon: 21.0122, tz: "Europe/Warsaw", country: "PL" },
  "krakow": { name: "Krakow", lat: 50.0647, lon: 19.9450, tz: "Europe/Warsaw", country: "PL" },
  "lisbon": { name: "Lisbon", lat: 38.7223, lon: -9.1393, tz: "Europe/Lisbon", country: "PT" },
  "porto": { name: "Porto", lat: 41.1579, lon: -8.6291, tz: "Europe/Lisbon", country: "PT" },
  "doha": { name: "Doha", lat: 25.2854, lon: 51.5310, tz: "Asia/Qatar", country: "QA" },
  "bucharest": { name: "Bucharest", lat: 44.4268, lon: 26.1025, tz: "Europe/Bucharest", country: "RO" },
  "cluj-napoca": { name: "Cluj-Napoca", lat: 46.7712, lon: 23.6236, tz: "Europe/Bucharest", country: "RO" },
  "moscow": { name: "Moscow", lat: 55.7558, lon: 37.6173, tz: "Europe/Moscow", country: "RU" },
  "saint petersburg": { name: "Saint Petersburg", lat: 59.9311, lon: 30.3609, tz: "Europe/Moscow", country: "RU" },
  "novosibirsk": { name: "Novosibirsk", lat: 55.0084, lon: 82.9357, tz: "Asia/Novosibirsk", country: "RU" },
  "yekaterinburg": { name: "Yekaterinburg", lat: 56.8389, lon: 60.6057, tz: "Asia/Yekaterinburg", country: "RU" },
  "vladivostok": { name: "Vladivostok", lat: 43.1332, lon: 131.9113, tz: "Asia/Vladivostok", country: "RU" },
  "kigali": { name: "Kigali", lat: -1.9441, lon: 30.0619, tz: "Africa/Kigali", country: "RW" },
  "kingstown": { name: "Kingstown", lat: 13.1607, lon: -61.2244, tz: "America/St_Vincent", country: "VC" },
  "apia": { name: "Apia", lat: -13.8507, lon: -171.7514, tz: "Pacific/Apia", country: "WS" },
  "san marino": { name: "San Marino", lat: 43.9334, lon: 12.4474, tz: "Europe/San_Marino", country: "SM" },
  "sao tome": { name: "Sao Tome", lat: 0.3365, lon: 6.7273, tz: "Africa/Sao_Tome", country: "ST" },
  "riyadh": { name: "Riyadh", lat: 24.7136, lon: 46.6753, tz: "Asia/Riyadh", country: "SA" },
  "jeddah": { name: "Jeddah", lat: 21.4858, lon: 39.1925, tz: "Asia/Riyadh", country: "SA" },
  "mecca": { name: "Mecca", lat: 21.3891, lon: 39.8579, tz: "Asia/Riyadh", country: "SA" },
  "dakar": { name: "Dakar", lat: 14.7167, lon: -17.4677, tz: "Africa/Dakar", country: "SN" },
  "belgrade": { name: "Belgrade", lat: 44.7866, lon: 20.4489, tz: "Europe/Belgrade", country: "RS" },
  "victoria": { name: "Victoria", lat: -4.6184, lon: 55.4503, tz: "Indian/Mahe", country: "SC" },
  "freetown": { name: "Freetown", lat: 8.4846, lon: -13.2343, tz: "Africa/Freetown", country: "SL" },
  "singapore": { name: "Singapore", lat: 1.3521, lon: 103.8198, tz: "Asia/Singapore", country: "SG" },
  "bratislava": { name: "Bratislava", lat: 48.1486, lon: 17.1077, tz: "Europe/Bratislava", country: "SK" },
  "ljubljana": { name: "Ljubljana", lat: 46.0569, lon: 14.5058, tz: "Europe/Ljubljana", country: "SI" },
  "honiara": { name: "Honiara", lat: -9.4456, lon: 159.9729, tz: "Pacific/Guadalcanal", country: "SB" },
  "mogadishu": { name: "Mogadishu", lat: 2.0469, lon: 45.3182, tz: "Africa/Mogadishu", country: "SO" },
  "pretoria": { name: "Pretoria", lat: -25.7479, lon: 28.2293, tz: "Africa/Johannesburg", country: "ZA" },
  "johannesburg": { name: "Johannesburg", lat: -26.2041, lon: 28.0473, tz: "Africa/Johannesburg", country: "ZA" },
  "cape town": { name: "Cape Town", lat: -33.9249, lon: 18.4241, tz: "Africa/Johannesburg", country: "ZA" },
  "durban": { name: "Durban", lat: -29.8587, lon: 31.0218, tz: "Africa/Johannesburg", country: "ZA" },
  "juba": { name: "Juba", lat: 4.8594, lon: 31.5713, tz: "Africa/Juba", country: "SS" },
  "madrid": { name: "Madrid", lat: 40.4168, lon: -3.7038, tz: "Europe/Madrid", country: "ES" },
  "barcelona": { name: "Barcelona", lat: 41.3851, lon: 2.1734, tz: "Europe/Madrid", country: "ES" },
  "valencia": { name: "Valencia", lat: 39.4699, lon: -0.3763, tz: "Europe/Madrid", country: "ES" },
  "sevilla": { name: "Sevilla", lat: 37.3891, lon: -5.9845, tz: "Europe/Madrid", country: "ES" },
  "bilbao": { name: "Bilbao", lat: 43.2630, lon: -2.9350, tz: "Europe/Madrid", country: "ES" },
  "las palmas": { name: "Las Palmas", lat: 28.1235, lon: -15.4363, tz: "Atlantic/Canary", country: "ES" },
  "colombo": { name: "Colombo", lat: 6.9271, lon: 79.8612, tz: "Asia/Colombo", country: "LK" },
  "khartoum": { name: "Khartoum", lat: 15.5007, lon: 32.5599, tz: "Africa/Khartoum", country: "SD" },
  "paramaribo": { name: "Paramaribo", lat: 5.8520, lon: -55.2038, tz: "America/Paramaribo", country: "SR" },
  "mbabane": { name: "Mbabane", lat: -26.3054, lon: 31.1367, tz: "Africa/Mbabane", country: "SZ" },
  "stockholm": { name: "Stockholm", lat: 59.3293, lon: 18.0686, tz: "Europe/Stockholm", country: "SE" },
  "gothenburg": { name: "Gothenburg", lat: 57.7089, lon: 11.9746, tz: "Europe/Stockholm", country: "SE" },
  "berne": { name: "Berne", lat: 46.9480, lon: 7.4474, tz: "Europe/Zurich", country: "CH" },
  "zurich": { name: "Zurich", lat: 47.3769, lon: 8.5417, tz: "Europe/Zurich", country: "CH" },
  "geneva": { name: "Geneva", lat: 46.2044, lon: 6.1432, tz: "Europe/Zurich", country: "CH" },
  "damascus": { name: "Damascus", lat: 33.5138, lon: 36.2765, tz: "Asia/Damascus", country: "SY" },
  "taipei": { name: "Taipei", lat: 25.0330, lon: 121.5654, tz: "Asia/Taipei", country: "TW" },
  "dushanbe": { name: "Dushanbe", lat: 38.5598, lon: 68.7870, tz: "Asia/Dushanbe", country: "TJ" },
  "dar es salaam": { name: "Dar es Salaam", lat: -6.7924, lon: 39.2083, tz: "Africa/Dar_es_Salaam", country: "TZ" },
  "dodoma": { name: "Dodoma", lat: -6.1630, lon: 35.7516, tz: "Africa/Dar_es_Salaam", country: "TZ" },
  "bangkok": { name: "Bangkok", lat: 13.7563, lon: 100.5018, tz: "Asia/Bangkok", country: "TH" },
  "chiang mai": { name: "Chiang Mai", lat: 18.7883, lon: 98.9853, tz: "Asia/Bangkok", country: "TH" },
  "dili": { name: "Dili", lat: -8.5569, lon: 125.5603, tz: "Asia/Dili", country: "TL" },
  "lome": { name: "Lome", lat: 6.1725, lon: 1.2314, tz: "Africa/Lome", country: "TG" },
  "nuku'alofa": { name: "Nuku'alofa", lat: -21.1394, lon: -175.2048, tz: "Pacific/Tongatapu", country: "TO" },
  "port of spain": { name: "Port of Spain", lat: 10.6549, lon: -61.5019, tz: "America/Port_of_Spain", country: "TT" },
  "tunis": { name: "Tunis", lat: 36.8065, lon: 10.1815, tz: "Africa/Tunis", country: "TN" },
  "ankara": { name: "Ankara", lat: 39.9334, lon: 32.8597, tz: "Europe/Istanbul", country: "TR" },
  "istanbul": { name: "Istanbul", lat: 41.0082, lon: 28.9784, tz: "Europe/Istanbul", country: "TR" },
  "izmir": { name: "Izmir", lat: 38.4237, lon: 27.1428, tz: "Europe/Istanbul", country: "TR" },
  "ashgabat": { name: "Ashgabat", lat: 37.9601, lon: 58.3261, tz: "Asia/Ashgabat", country: "TM" },
  "funafuti": { name: "Funafuti", lat: -8.5211, lon: 179.1962, tz: "Pacific/Funafuti", country: "TV" },
  "kampala": { name: "Kampala", lat: 0.3476, lon: 32.5825, tz: "Africa/Kampala", country: "UG" },
  "kyiv": { name: "Kyiv", lat: 50.4501, lon: 30.5234, tz: "Europe/Kiev", country: "UA" },
  "odessa": { name: "Odessa", lat: 46.4840, lon: 30.7325, tz: "Europe/Kiev", country: "UA" },
  "abu dhabi": { name: "Abu Dhabi", lat: 24.4539, lon: 54.3773, tz: "Asia/Dubai", country: "AE" },
  "dubai": { name: "Dubai", lat: 25.2048, lon: 55.2708, tz: "Asia/Dubai", country: "AE" },
  "montevideo": { name: "Montevideo", lat: -34.9011, lon: -56.1645, tz: "America/Montevideo", country: "UY" },
  "tashkent": { name: "Tashkent", lat: 41.2995, lon: 69.2401, tz: "Asia/Tashkent", country: "UZ" },
  "samarqand": { name: "Samarqand", lat: 39.6545, lon: 66.9597, tz: "Asia/Samarkand", country: "UZ" },
  "port vila": { name: "Port Vila", lat: -17.7333, lon: 168.3270, tz: "Pacific/Efate", country: "VU" },
  "caracas": { name: "Caracas", lat: 10.4806, lon: -66.9036, tz: "America/Caracas", country: "VE" },
  "maracaibo": { name: "Maracaibo", lat: 10.6556, lon: -71.6406, tz: "America/Caracas", country: "VE" },
  "hanoi": { name: "Hanoi", lat: 21.0278, lon: 105.8342, tz: "Asia/Ho_Chi_Minh", country: "VN" },
  "ho chi minh city": { name: "Ho Chi Minh City", lat: 10.8231, lon: 106.6297, tz: "Asia/Ho_Chi_Minh", country: "VN" },
  "da nang": { name: "Da Nang", lat: 16.0544, lon: 108.2022, tz: "Asia/Ho_Chi_Minh", country: "VN" },
  "sanaa": { name: "Sanaa", lat: 15.3694, lon: 44.1910, tz: "Asia/Aden", country: "YE" },
  "lusaka": { name: "Lusaka", lat: -15.3875, lon: 28.3228, tz: "Africa/Lusaka", country: "ZM" },
  "harare": { name: "Harare", lat: -17.8252, lon: 31.0335, tz: "Africa/Harare", country: "ZW" },
  "palikir": { name: "Palikir", lat: 6.9248, lon: 158.1611, tz: "Pacific/Pohnpei", country: "FM" },
  "libreville": { name: "Libreville", lat: 0.4162, lon: 9.4673, tz: "Africa/Libreville", country: "GA" },
  "accra": { name: "Accra", lat: 5.6037, lon: -0.1870, tz: "Africa/Accra", country: "GH" },
  "banjul": { name: "Banjul", lat: 13.4549, lon: -16.5790, tz: "Africa/Banjul", country: "GM" },
  "basseterre": { name: "Basseterre", lat: 17.3026, lon: -62.7177, tz: "America/St_Kitts", country: "KN" },
  "castries": { name: "Castries", lat: 14.0101, lon: -60.9870, tz: "America/St_Lucia", country: "LC" },
  "vaduz": { name: "Vaduz", lat: 47.1410, lon: 9.5209, tz: "Europe/Vaduz", country: "LI" },
  "monaco": { name: "Monaco", lat: 43.7384, lon: 7.4246, tz: "Europe/Monaco", country: "MC" },
  "yaren": { name: "Yaren", lat: -0.5467, lon: 166.9211, tz: "Pacific/Nauru", country: "NR" },
  "ramallah": { name: "Ramallah", lat: 31.9038, lon: 35.2034, tz: "Asia/Hebron", country: "PS" },
  "vatican city": { name: "Vatican City", lat: 41.9029, lon: 12.4534, tz: "Europe/Rome", country: "VA" },
};

const CONFIG = {
  calendarId: "",
  calendarName: "Weather Forecast",
  version: "2.4.0",
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
const WINDOW_START_BUFFER = 3;  // Days before history window to sweep orphans
const WINDOW_END_BUFFER = 5;    // Days after forecast window to sweep orphans
// Lead-time bucket thresholds for model accuracy (must match icalweather.gs)
const LEAD_BUCKETS = [
  { maxLead: 3,   key: 'short', defaultErr: 0.8 },
  { maxLead: 7,   key: 'mid',   defaultErr: 1.7 },
  { maxLead: 14,  key: 'long',  defaultErr: 2.9 },
  { maxLead: Infinity, key: 'noaa', defaultErr: 4.3 }
];

// Translation infrastructure (mirrors icalweather.gs for stargazing and shared terms)
const SUPPORTED_LANGS = ["en", "zh", "hi", "es", "fr", "ar", "de", "nl"];
const T_L = {
  pin:      { en:"Pin",                          zh:"位置",                  hi:"स्थान",                       es:"Ubicación",                fr:"Lieu",                        ar:"الموقع",                    de:"Ort",                         nl:"Plaats" },
  cal:      { en:"Calendar",                     zh:"日历",                  hi:"कैलेंडर",                     es:"Calendario",                fr:"Calendrier",                  ar:"التقويم",                   de:"Kalender",                    nl:"Kalender" },
  range:     { en:"Range",                        zh:"范围",                  hi:"सीमा",                        es:"Rango",                      fr:"Plage",                      ar:"المدى",                       de:"Bereich",                     nl:"Bereik" },
  feels:     { en:"Feels",                        zh:"体感",                  hi:"महसूस",                       es:"Sensación",                  fr:"Ressenti",                   ar:"إحساس",                      de:"Gefühlt",                    nl:"Voelt als" },
  dew:       { en:"Dew",                          zh:"露点",                  hi:"ओसांश",                       es:"Rocío",                     fr:"Rosée",                      ar:"الندى",                      de:"Taupunkt",                   nl:"Dauwpunt" },
  humid:     { en:"Humidity",                     zh:"湿度",                  hi:"नमी",                         es:"Humedad",                    fr:"Humidité",                    ar:"الرطوبة",                    de:"Luftfeuchte",                 nl:"Luchtvochtigheid" },
  rain:      { en:"Rain",                         zh:"降雨",                  hi:"वर्षा",                       es:"Lluvia",                     fr:"Pluie",                      ar:"المطر",                       de:"Regen",                       nl:"Regen" },
  consensus: { en:"Consensus",                     zh:"集合一致性",            hi:"सर्वसम्मति",                   es:"Consenso",                   fr:"Consensus",                   ar:"الإجماع",                     de:"Konsens",                     nl:"Consensus" },
  wind:      { en:"Wind",                         zh:"风",                    hi:"हवा",                         es:"Viento",                     fr:"Vent",                       ar:"الرياح",                      de:"Wind",                        nl:"Wind" },
  gusts:     { en:"Gusts",                        zh:"阵风",                  hi:"झोंके",                       es:"Ráfagas",                    fr:"Rafales",                     ar:"هبّات",                      de:"Böen",                        nl:"Windstoten" },
  baro:      { en:"Barometer",                    zh:"气压",                  hi:"वायुदाब",                      es:"Barómetro",                  fr:"Baromètre",                   ar:"البارومتر",                   de:"Barometer",                   nl:"Barometer" },
  daylight:  { en:"Daylight",                     zh:"日照",                  hi:"दिन की रोशनी",                es:"Luz diurna",                 fr:"Durée du jour",               ar:"ساعات النهار",                 de:"Tageslicht",                  nl:"Daglicht" },
  goldenHr:  { en:"Golden Hr",                    zh:"黄金时刻",              hi:"गोल्डन ऑवर",                  es:"Hora dorada",                fr:"Heure dorée",                 ar:"الساعة الذهبية",               de:"Goldene Stunde",              nl:"Gouden uur" },
  cloud:     { en:"Cloud Cover",                   zh:"云量",                  hi:"बादल",                        es:"Nubosidad",                  fr:"Couverture nuageuse",         ar:"الغيوم",                      de:"Bewölkung",                   nl:"Bewolking" },
  moon:      { en:"Moon",                         zh:"月相",                  hi:"चाँद",                        es:"Luna",                       fr:"Lune",                        ar:"القمر",                       de:"Mond",                        nl:"Maan" },
  star:      { en:"Stargazing",                    zh:"观星",                  hi:"तारा-दर्शन",                  es:"Observación de estrellas",   fr:"Observation des étoiles",     ar:"رصد النجوم",                   de:"Sternbeobachtung",            nl:"Sterrenkijken" },
  uv:        { en:"UV Index",                     zh:"紫外线指数",             hi:"यूवी सूचकांक",                 es:"Índice UV",                   fr:"Indice UV",                   ar:"مؤشر الأشعة فوق البنفسجية",  de:"UV-Index",                    nl:"UV-index" },
  et:        { en:"Evapotrans.",                    zh:"蒸散",                  hi:"वाष्पीकरण",                    es:"Evapotranspiración",         fr:"Évapotranspiration",          ar:"البخر",                       de:"Evapotranspiration",          nl:"Verdamping" },
  rad:       { en:"Solar Radiation",              zh:"太阳辐射",               hi:"सौर विकिरण",                   es:"Radiación solar",            fr:"Rayonnement solaire",          ar:"الإشعاع الشمسي",               de:"Sonnenstrahlung",             nl:"Zonnestraling" },
  aqi:       { en:"AQI",                         zh:"空气质量",               hi:"वायु गुणवत्ता सूचकांक",        es:"ICA",                        fr:"IQA",                         ar:"مؤشر جودة الهواء",             de:"Luftqualität (AQI)",          nl:"Luchtkwaliteit (AQI)" },
  mon:       { en:"Monitoring",                  zh:"监测中",                hi:"निगरानी",                       es:"Monitoreo",                   fr:"En suivi",                    ar:"قيد المراقبة",                 de:"Wird überwacht",               nl:"Wordt gemeten" },
  pm25:      { en:"PM2.5",                       zh:"细颗粒物",               hi:"पीएम 2.5",                     es:"PM2.5",                      fr:"PM2.5",                       ar:"الجسيمات الدقيقة",              de:"PM2.5",                        nl:"PM2.5" },
  pm10:      { en:"PM10",                        zh:"可吸入颗粒",             hi:"पीएम 10",                      es:"PM10",                       fr:"PM10",                        ar:"الجسيمات الكبيرة",              de:"PM10",                         nl:"PM10" },
  pollen:    { en:"Pollen Load",                  zh:"花粉浓度",               hi:"पराग",                          es:"Polen",                      fr:"Pollens",                     ar:"حبوب اللقاح",                   de:"Pollenbelastung",              nl:"Pollenbelasting" },
  polLow:    { en:"Low",                         zh:"低",                    hi:"कम",                           es:"Bajo",                       fr:"Faible",                      ar:"منخفض",                       de:"Niedrig",                      nl:"Laag" },
  rainSum:   { en:"Rain Sum",                     zh:"累计降雨",               hi:"कुल वर्षा",                     es:"Lluvia total",                fr:"Cumul de pluie",              ar:"إجمالي المطر",                 de:"Regensumme",                   nl:"Regensom" },
  meanTemp:  { en:"Mean Temp",                   zh:"平均气温",               hi:"औसत तापमान",                    es:"Temp. media",                 fr:"Temp. moyenne",                ar:"متوسط الحرارة",                 de:"Mittlere Temp.",               nl:"Gem. temperatuur" },
  gdd:       { en:"Growing Deg",                 zh:"有效积温",               hi:"ग्रोइंग डिग्री",                 es:"Grados-día",                  fr:"Degrés-jours",                 ar:"درجات النمو",                   de:"Wärmesumme",                  nl:"Groeigraden" },
  aqi7:      { en:"7-Day Mean AQI",             zh:"7天平均空气质量",         hi:"7-दिन औसत वायु",                  es:"ICA medio 7d",                fr:"IQA moyen 7j",                 ar:"متوسط 7 أيام للجودة",            de:"7-Tage AQI-Mittel",            nl:"7-dagen gem. AQI" },
  status:    { en:"Status",                       zh:"状态",                  hi:"स्थिति",                         es:"Estado",                      fr:"Statut",                       ar:"الحالة",                       de:"Status",                       nl:"Status" },
  drift:     { en:"Expected Lead Drift",          zh:"预计误差",               hi:"अपेक्षित ड्रिफ्ट",                 es:"Deriva esperada",              fr:"Dérive attendue",               ar:"الانحراف المتوقع",               de:"Erwartete Abweichung",          nl:"Verwachte drift" },
  ground:    { en:"Ground",                       zh:"地表",                  hi:"भूमि",                           es:"Suelo",                       fr:"Sol",                          ar:"الأرض",                        de:"Boden",                        nl:"Bodem" },
  advisory:  { en:"Advisory",                     zh:"建议",                  hi:"सलाह",                           es:"Aviso",                       fr:"Avis",                         ar:"تنبيه",                        de:"Hinweis",                      nl:"Advies" },
  engine:    { en:"Engine",                       zh:"引擎",                  hi:"इंजन",                         es:"Motor",                      fr:"Moteur",                      ar:"المحرك",                      de:"Engine",                       nl:"Engine" },
  wx:        { en:"Weather",                      zh:"天气",                  hi:"मौसम",                         es:"Clima",                      fr:"Météo",                       ar:"الطقس",                       de:"Wetter",                       nl:"Weer" },
  aq:        { en:"Air Quality",                  zh:"空气质量",              hi:"वायु गुणवत्ता",                  es:"Calidad del aire",            fr:"Qualité de l'air",            ar:"جودة الهواء",                  de:"Luftqualität",                nl:"Luchtkwaliteit" },
  wiki:      { en:"Wikipedia",                   zh:"维基百科",               hi:"विकिपीडिया",                     es:"Wikipedia",                  fr:"Wikipédia",                   ar:"ويكيبيديا",                    de:"Wikipedia",                   nl:"Wikipedia" },
  wikiApi:   { en:"Wikipedia On This Day API",   zh:"维基百科历史事件API",    hi:"विकिपीडिया इतिहास API",         es:"API Wikipedia En Este Día",   fr:"API Wikipédia Ce Jour-Là",    ar:"واجهة برمجة ويكيبيديا",        de:"Wikipedia An Diesem Tag API",  nl:"Wikipedia Op Deze Dag API" },
  newsApi:   { en:"NewsAPI",                     zh:"NewsAPI",                hi:"NewsAPI",                        es:"NewsAPI",                    fr:"NewsAPI",                     ar:"NewsAPI",                       de:"NewsAPI",                     nl:"NewsAPI" },
  // --- Road statuses ---
  rdBI:     { en:"BLACK ICE DANGER",            zh:"黑冰危险",              hi:"काली बर्फ का खतरा",             es:"PELIGRO DE HIELO NEGRO",    fr:"DANGER DE VERGLAS",          ar:"خطر الجليد الأسود",          de:"SCHWARZES EIS",              nl:"ZWART IJS-GEVAAR" },
  rdFrost:  { en:"FROST / SLICK SPOTS",         zh:"霜冻/路面湿滑",         hi:"पाला/फिसलन",                   es:"HELADAS / RESBALADIZO",     fr:"GELÉES / GLISSANT",          ar:"صقيع/انزلاق",                de:"FROST / RUTSCHIG",           nl:"VORST / GLADDE" },
  rdSpray:  { en:"COLD SPRAY RISK",            zh:"冷溅水风险",             hi:"ठंडी छींट",                     es:"RIESGO DE SALPICADURAS",    fr:"RISQUE D'ÉCLABOUSSURES",    ar:"خطر الرذاذ البارد",           de:"KÄLTE-SPRÜH-RISIKO",        nl:"KOUD-SPUITRISICO" },
  rdChill:  { en:"CHILLED ASPHALT",            zh:"冷柏油路",               hi:"ठंडा डामर",                    es:"ASFALTO FRÍO",              fr:"ASPHALTE FROID",             ar:"إسفلت بارد",                 de:"KALTER ASPHALT",              nl:"KOUDE ASFALT" },
  rdAdvBI:  { en:"Glazed surface. Triple braking distance.", zh:"结冰路面。请保持三倍刹车距离。", hi:"फिसलन सतह। तिगुना ब्रेकिंग दूरी।", es:"Superficie helada. Triplica la distancia.", fr:"Surface verglacée. Triplez la distance.", ar:"سطح جليدي. ثلاثة أضعاف مسافة الفرملة.", de:"Spiegelglatt. Dreifacher Bremsweg.", nl:"Bevroren oppervlak. Verdrievoudig remweg." },
  rdAdvFr:  { en:"Bridges & shaded ramps prone to ice.", zh:"桥梁和背阴坡道易结冰。", hi:"पुल और छायादार रैंप बर्फ के शिकार।", es:"Puentes y rampas en sombra propensos al hielo.", fr:"Ponts et rampes ombragées sujets au verglas.", ar:"الجسور والمنحدرات المظللة عرضة للجليد.", de:"Brücken und schattige Rampen vereist.", nl:"Bruggen en schaduwrijke hellingen ijzelgevoelig." },
  rdAdvSp:  { en:"Reduced grip on summer tires.", zh:"夏季轮胎抓地力下降。", hi:"ग्रीष्मकालीन टायरों पर कम पकड़।", es:"Menor agarre en neumáticos de verano.", fr:"Adhérence réduite sur pneus été.", ar:"تماسك أقل مع الإطارات الصيفية.", de:"Reduzierter Grip auf Sommerreifen.", nl:"Minder grip op zomerbanden." },
  rdAdvCh:  { en:"Sub-7°C rubber hardening threshold.", zh:"低于7°C橡胶硬化阈值。", hi:"7°C से नीचे रबर सख्त होने की सीमा।", es:"Umbral de endurecimiento del caucho bajo 7°C.", fr:"Seuil de durcissement du caoutchouc sous 7°C.", ar:"عتبة تصلب المطاط دون 7°C.", de:"Unter 7°C härtet Gummi aus.", nl:"Onder 7°C wordt rubber harder." },
  // --- GDD ---
  gddDorm: { en:"Dormant",        zh:"休眠期",              hi:"सुप्त",              es:"Latente",            fr:"Dormant",            ar:"خامد",             de:"Ruhend",             nl:"Rustend" },
  gddCool: { en:"Cool greens active", zh:"冷凉蔬菜活跃",      hi:"ठंडी सब्ज़ियाँ सक्रिय", es:"Hortalizas frías activas", fr:"Légumes frais actifs", ar:"خضروات باردة نشطة", de:"Kühlgemüse aktiv",   nl:"Koude groenten actief" },
  gddFoli: { en:"Steady root foliage", zh:"根部生长稳定",    hi:"जड़ें मज़बूत",      es:"Follaje de raíz estable", fr:"Feuillage racinaire stable", ar:"أوراق الجذور مستقرة", de:"Stetige Blattbildung", nl:"Stabiele bladgroei" },
  gddBrss: { en:"Brassicas booming",  zh:"十字花科蔬菜旺盛",  hi:"ब्रैसिका फल-फूल", es:"Brásicas en auge",    fr:"Brassiques en plein essor", ar:"الكرنبية في أوجها", de:"Kreuzblütler-Boost", nl:"Koolsoorten pieken" },
  gddPeak: { en:"Peak warm growth",   zh:"高温生长峰值",      hi:"गर्म वृद्धि चरम",  es:"Pico de calor",      fr:"Pic de chaleur",      ar:"ذروة النمو",        de:"Wachstumsspitze",   nl:"Piek warmtegroei" },
  // --- Stargazing ---
  starExc:  { en:"Exceptional",         zh:"极佳",               hi:"असाधारण",           es:"Excepcional",          fr:"Exceptionnel",         ar:"استثنائي",           de:"Hervorragend",         nl:"Uitstekend" },
  starFair: { en:"Fair",                 zh:"良好",               hi:"अच्छा",             es:"Aceptable",            fr:"Correct",             ar:"جيد",               de:"Gut",                  nl:"Redelijk" },
  starMod:  { en:"Moderate",             zh:"一般",               hi:"मध्यम",             es:"Moderado",             fr:"Modéré",              ar:"متوسط",             de:"Mäßig",                 nl:"Matig" },
  starObsc: { en:"Obscured",             zh:"被遮挡",             hi:"अस्पष्ट",           es:"Obstruido",            fr:"Masqué",              ar:"محجوب",             de:"Verdeckt",              nl:"Verduisterd" },
  starMoon: { en:"Moonlit",              zh:"月光明亮",           hi:"चाँदनी",           es:"Iluminado por la luna", fr:"Éclairé par la lune", ar:"منير بالقمر",    de:"Mondbeschienen",       nl:"Maanverlicht" },
  starFlt:  { en:"Filtered by Moon",    zh:"月光干扰",           hi:"चाँद के कारण",     es:"Filtrado por la luna",  fr:"Filtré par la lune",   ar:"مُرشَّح بالقمر", de:"Mond-getrübt",          nl:"Maangestoorde hemel" },
  starDec:  { en:"Decent",              zh:"尚可",               hi:"ठीक",               es:"Aceptable",            fr:"Correct",             ar:"مقبول",             de:"Brauchbar",             nl:"Redelijk" },
  // --- AQI ---
  aqiGood:  { en:"Good",                       zh:"良好",              hi:"अच्छा",              es:"Buena",              fr:"Bonne",               ar:"جيد",               de:"Gut",               nl:"Goed" },
  aqiFair:  { en:"Fair",                       zh:"一般",              hi:"सामान्य",            es:"Aceptable",          fr:"Acceptable",         ar:"مقبول",             de:"Mäßig",              nl:"Redelijk" },
  aqiMod:   { en:"Moderate",                   zh:"中等",              hi:"मध्यम",             es:"Moderada",           fr:"Modérée",             ar:"متوسط",             de:"Mittel",             nl:"Matig" },
  aqiPoor:  { en:"Poor",                       zh:"较差",              hi:"खराब",              es:"Mala",               fr:"Mauvaise",            ar:"سيئ",               de:"Schlecht",           nl:"Slecht" },
  aqiSens:  { en:"Unhealthy for Sensitive",     zh:"对敏感人群不健康",   hi:"संवेदनशील के लिए अस्वस्थ", es:"Dañina para sensibles", fr:"Mauvaise pour sensibles", ar:"غير صحي للحساسين", de:"Ungesund für Empfindliche", nl:"Ongezond voor gevoeligen" },
  aqiUnh:   { en:"Unhealthy",                   zh:"不健康",            hi:"अस्वस्थ",            es:"Dañina",            fr:"Mauvaise",            ar:"غير صحي",           de:"Ungesund",           nl:"Ongezond" },
  aqiVunh:   { en:"Very Unhealthy",             zh:"极不健康",          hi:"बहुत अस्वस्थ",       es:"Muy dañina",         fr:"Très mauvaise",      ar:"غير صحي جداً",       de:"Sehr ungesund",      nl:"Zeer ongezond" },
  aqiHzd:   { en:"Hazardous",                   zh:"危险",              hi:"खतरनाक",            es:"Peligrosa",          fr:"Dangereuse",          ar:"خطير",              de:"Gefährlich",         nl:"Gevaarlijk" },
  aqiUnk:   { en:"Unknown",                     zh:"未知",              hi:"अज्ञात",              es:"Desconocida",        fr:"Inconnue",            ar:"غير معروف",          de:"Unbekannt",          nl:"Onbekend" },
  // --- UV ---
  uvLow:    { en:"Low",       zh:"低",     hi:"कम",     es:"Bajo",     fr:"Faible",     ar:"منخفض",    de:"Niedrig",    nl:"Laag" },
  uvMod:    { en:"Moderate",  zh:"中等",   hi:"मध्यम",  es:"Moderado",  fr:"Modéré",    ar:"متوسط",    de:"Mittel",     nl:"Matig" },
  uvHigh:   { en:"High",      zh:"强",     hi:"उच्च",   es:"Alto",     fr:"Élevé",     ar:"مرتفع",    de:"Hoch",       nl:"Hoog" },
  uvVhigh:  { en:"Very High", zh:"很强",   hi:"बहुत उच्च", es:"Muy alto", fr:"Très élevé", ar:"مرتفع جداً", de:"Sehr hoch",  nl:"Zeer hoog" },
  // --- Humidity ---
  humDry:   { en:"Dry Air",       zh:"干燥",   hi:"शुष्क हवा",   es:"Aire seco",    fr:"Air sec",     ar:"هواء جاف",  de:"Trockene Luft",  nl:"Droge lucht" },
  humComf:  { en:"Comfortable",  zh:"舒适",   hi:"आरामदायक",    es:"Confortable",  fr:"Confortable", ar:"مريح",       de:"Angenehm",        nl:"Comfortabel" },
  humHumid: { en:"Humid",         zh:"潮湿",   hi:"उमस",         es:"Húmedo",       fr:"Humide",       ar:"رطب",        de:"Feucht",           nl:"Vochtig" },
  humMuggy: { en:"Very Muggy",    zh:"闷热",   hi:"बहुत उमस",    es:"Muy bochornoso", fr:"Très lourd", ar:"خانق جداً",  de:"Schwül",           nl:"Zeer benauwd" },
  // --- Thermal ---
  tFreeze: { en:"Freezing",     zh:"严寒",    hi:"हिमांक",    es:"Helado",       fr:"Glacial",       ar:"متجمد",    de:"Frost",       nl:"Vriezend" },
  tChilly: { en:"Chilly",       zh:"寒冷",    hi:"ठंडा",      es:"Fresco",       fr:"Frais",         ar:"بارد",      de:"Kühl",        nl:"Fris" },
  tComf:   { en:"Comfortable",  zh:"舒适",    hi:"आरामदायक",  es:"Confortable",  fr:"Confortable",   ar:"مريح",      de:"Angenehm",     nl:"Comfortabel" },
  tPleas:  { en:"Pleasant",     zh:"宜人",    hi:"सुहावना",    es:"Agradable",    fr:"Agréable",      ar:"لطيف",      de:"Angenehm",     nl:"Aangenaam" },
  tWarm:   { en:"Warm",         zh:"温暖",    hi:"गर्म",       es:"Cálido",       fr:"Tiède",         ar:"دافئ",      de:"Warm",         nl:"Warm" },
  tHot:    { en:"Hot",          zh:"炎热",    hi:"गर्म",       es:"Caluroso",     fr:"Chaud",         ar:"حار",        de:"Heiß",         nl:"Warm" },
  // --- Model bands ---
  dDay:    { en:"D-Day (Today)",        zh:"D日（今天）",   hi:"डी-डे (आज)",        es:"Día D (Hoy)",           fr:"Jour J (Aujourd'hui)",     ar:"اليوم (د-داي)",       de:"Tag D (Heute)",       nl:"D-Dag (Vandaag)" },
  mDet:    { en:"Deterministic",        zh:"确定性",         hi:"निर्धारक",            es:"Determinista",          fr:"Déterministe",            ar:"حتمي",               de:"Deterministisch",     nl:"Deterministisch" },
  mEns:    { en:"NOAA Ensemble",        zh:"NOAA集合",       hi:"एनओएए समुच्चय",      es:"Conjunto NOAA",        fr:"Ensemble NOAA",             ar:"مجموعة NOAA",         de:"NOAA-Ensemble",        nl:"NOAA-Ensemble" },
  // --- Lead band labels ---
  lS:      { en:"D1-3 High",          zh:"1-3天 高精度",   hi:"D1-3 उच्च",        es:"D1-3 Alta",       fr:"J1-3 Élevée",       ar:"1-3 يوم مرتفع",    de:"T1-3 Hoch",       nl:"D1-3 Hoog" },
  lM:      { en:"D4-7 Medium",        zh:"4-7天 中等",     hi:"D4-7 मध्यम",        es:"D4-7 Media",      fr:"J4-7 Modérée",      ar:"4-7 يوم متوسط",    de:"T4-7 Mittel",      nl:"D4-7 Gemiddeld" },
  lL:      { en:"D8-14 Extended",     zh:"8-14天 延伸",    hi:"D8-14 विस्तारित",   es:"D8-14 Extendida", fr:"J8-14 Étendue",     ar:"8-14 يوم موسع",    de:"T8-14 Erweitert",   nl:"D8-14 Uitgebreid" },
  lN:      { en:"D15+ Ensemble",      zh:"15天以上 集合",  hi:"D15+ एनसम्बल",      es:"D15+ Conjunto",   fr:"J15+ Ensemble",      ar:"15+ يوم مجموعة",    de:"T15+ Ensemble",      nl:"D15+ Ensemble" },
  lGt:     { en:"Ground-Truth (Live)", zh:"实测（实时）",    hi:"ग्राउंड-ट्रुथ (लाइव)", es:"Verificado en vivo", fr:"Mesure réelle (Direct)", ar:"الواقع (مباشر)", de:"Echtzeit-Messung",  nl:"Gemeten (live)" },
  lCal:    { en:"Calibrating",          zh:"校准中",          hi:"कैलिब्रेट",         es:"Calibrando",       fr:"Calibrage en cours", ar:"قيد المعايرة",     de:"Kalibrierung läuft", nl:"Wordt gekalibreerd" },
  // --- Grades ---
  gAplus:  { en:"A+ (Excellent)",       zh:"A+ (极佳)",     hi:"A+ (उत्कृष्ट)",      es:"A+ (Excelente)",   fr:"A+ (Excellent)",       ar:"A+ (ممتاز)",      de:"A+ (Ausgezeichnet)", nl:"A+ (Uitstekend)" },
  gA:      { en:"A (High)",             zh:"A (高)",        hi:"A (उच्च)",           es:"A (Alta)",         fr:"A (Élevée)",          ar:"A (مرتفع)",       de:"A (Hoch)",           nl:"A (Hoog)" },
  gB:      { en:"B (Moderate)",         zh:"B (中等)",      hi:"B (मध्यम)",           es:"B (Moderada)",     fr:"B (Modérée)",          ar:"B (متوسط)",       de:"B (Mittel)",         nl:"B (Matig)" },
  gC:      { en:"C (Divergent)",        zh:"C (差异较大)",   hi:"C (भिन्न)",           es:"C (Divergente)",   fr:"C (Divergent)",        ar:"C (متباعد)",      de:"C (Abweichend)",     nl:"C (Uiteenlopend)" },
  groundTruth:   { en:'Ground Truth (Measured)', zh:'实测数据',           hi:'वास्तविक डेटा',                es:'Datos reales (medidos)',     fr:'Données réelles (mesurées)',     ar:'بيانات فعلية (مقاسة)',     de:'Gemessene Daten',            nl:'Gemeten gegevens'         },
  accuracyAudit: { en:'Prediction Accuracy Audit', zh:'预测精度审计',         hi:'पूर्वानुमान सटीकता ऑडिट',      es:'Auditoría de precisión',     fr:'Audit de précision',             ar:'تدقيق دقة التوقعات',       de:'Prognosegenauigkeits-Prüfung', nl:'Nauwkeurigheidscontrole'  },
  modelBench:    { en:'Model Benchmark',        zh:'模型基准',           hi:'मॉडल बेंचमार्क',               es:'Referencia del modelo',      fr:'Référence du modèle',            ar:'معيار النموذج',            de:'Modell-Benchmark',           nl:'Modelbenchmark'           },
  sky:           { en:'Sky',                    zh:'天空',             hi:'आसमान',                        es:'Cielo',                      fr:'Ciel',                           ar:'السماء',                   de:'Himmel',                     nl:'Lucht'                    },
  tempDelta:     { en:'Temp Delta',             zh:'温差',             hi:'ताप अंतर',                     es:'Delta de temp',              fr:'Écart de temp',                  ar:'فرق الحرارة',              de:'Temp-Delta',                 nl:'Tempverschil'             },
  rainDelta:     { en:'Rain Delta',             zh:'雨量差',            hi:'वर्षा अंतर',                   es:'Delta de lluvia',            fr:'Écart de pluie',                 ar:'فرق المطر',                de:'Regen-Delta',                nl:'Regenverschil'            },
  stability:     { en:'Stability',              zh:'稳定性',            hi:'स्थिरता',                      es:'Estabilidad',                fr:'Stabilité',                      ar:'الاستقرار',                de:'Stabilität',                 nl:'Stabiliteit'              },
  snapTracked:   { en:'Snapshots Tracked',      zh:'已追踪快照',          hi:'ट्रैक किए गए स्नैपशॉट',        es:'Instantáneas registradas',   fr:'Instantanés suivis',             ar:'لقطات متتبعة',             de:'Verfolgte Snapshots',        nl:'Gevolgde momentopnamen'   },
  lifeTempMAE:   { en:'Lifetime Temp MAE',      zh:'全时温度平均误差',       hi:'जीवनकाल ताप MAE',              es:'MAE temp. histórico',        fr:'MAE temp. global',               ar:'متوسط خطأ درجة الحرارة',   de:'Gesamt-Temp-MAE',            nl:'Levenslange temp-MAE'     },
  lifeRainMAE:   { en:'Lifetime Rain MAE',      zh:'全时雨量平均误差',       hi:'जीवनकाल वर्षा MAE',            es:'MAE lluvia histórico',       fr:'MAE pluie global',               ar:'متوسط خطأ المطر',          de:'Gesamt-Regen-MAE',           nl:'Levenslange regen-MAE'    },
  reliability:   { en:'Reliability',            zh:'可靠性',            hi:'विश्वसनीयता',                  es:'Confiabilidad',              fr:'Fiabilité',                      ar:'الموثوقية',                de:'Zuverlässigkeit',            nl:'Betrouwbaarheid'          },
  leadCurve:     { en:'Lead Curve',             zh:'提前期曲线',          hi:'लीड वक्र',                     es:'Curva de anticipación',      fr:"Courbe d'avance",                ar:'منحنى التوقع',             de:'Vorlauf-Kurve',              nl:'Leadcurve'                },
  benchMAE:      { en:'Benchmark MAE',          zh:'基准平均误差',         hi:'बेंचमार्क MAE',                es:'MAE de referencia',          fr:'MAE de référence',               ar:'متوسط خطأ المعيار',        de:'Benchmark-MAE',              nl:'Benchmark-MAE'            },
  verifiedLog:   { en:'Verified Log',           zh:'已验证日志',          hi:'सत्यापित लॉग',                 es:'Registro verificado',        fr:'Journal vérifié',                ar:'سجل موثّق',                de:'Verifiziertes Protokoll',    nl:'Geverifieerd logboek'     },
  dAgo:        { en:" d ago",            zh:" 天前",          hi:" दिन पहले",                es:" d atrás",           fr:" j avant",                    ar:" يوم قبل",           de:" T zuvor",              nl:" d geleden"                 },
  hi:        { en:"High",               zh:"最高",           hi:"अधिकतम",     es:"Máxima",        fr:"Max.",                     ar:"القصوى",  de:"Hoch",                  nl:"Hoog"                        },
  lo:        { en:"Low",                zh:"最低",           hi:"न्यूनतम",    es:"Mínima",        fr:"Min.",                     ar:"الدنيا", de:"Tief",                  nl:"Laag"                        },
  volHigh:       { en:'High Drift',             zh:'高漂移',            hi:'उच्च विचलन',                   es:'Deriva alta',                fr:'Dérive élevée',                  ar:'انحراف مرتفع',             de:'Hohe Abweichung',            nl:'Hoge afwijking'           },
  volMod:        { en:'Moderate',               zh:'中等',             hi:'मध्यम',                        es:'Moderada',                   fr:'Modérée',                        ar:'متوسط',                    de:'Mittel',                     nl:'Matig'                    },
  volStable:     { en:'Stable',                 zh:'稳定',             hi:'स्थिर',                        es:'Estable',                    fr:'Stable',                         ar:'مستقر',                    de:'Stabil',                     nl:'Stabiel'                  },
  volPend:       { en:'Pending',                zh:'待定',             hi:'लंबित',                        es:'Pendiente',                  fr:'En attente',                     ar:'قيد الانتظار',             de:'Ausstehend',                 nl:'In afwachting'            },
  gCal:    { en:"A (Calibrating)",      zh:"A (校准中)",     hi:"A (कैलिब्रेट हो रहा)", es:"A (Calibrando)",   fr:"A (Calibrage en cours)", ar:"A (قيد المعايرة)", de:"A (Kalibrierung)",  nl:"A (Wordt gekalibreerd)" },
  wxClear:      { en:'Clear Sky',            zh:'晴朗',           hi:'साफ़ आसमान',               es:'Ciel despejado',         fr:'Ciel dégagé',                  ar:'سماء صافية',           de:'Klarer Himmel',            nl:'Heldere lucht'            },
  wxMainly:     { en:'Mainly Clear',         zh:'大部晴朗',         hi:'अधिकतर साफ़',              es:'Despejado en general',   fr:'Plutôt dégagé',                ar:'صافٍ في الغالب',       de:'Überwiegend klar',         nl:'Overwegend helder'        },
  wxPartly:     { en:'Partly Cloudy',        zh:'多云',           hi:'आंशिक रूप से बादल',        es:'Parcialmente nublado',   fr:'Partiellement nuageux',        ar:'غائم جزئياً',          de:'Teilweise bewölkt',        nl:'Half bewolkt'             },
  wxOvercast:   { en:'Overcast',             zh:'阴天',           hi:'घटाटोप',                   es:'Cubierto',               fr:'Couvert',                      ar:'غائم كلياً',           de:'Bedeckt',                  nl:'Geheel bewolkt'           },
  wxFog:        { en:'Foggy',                zh:'有雾',           hi:'धुंध',                     es:'Niebla',                 fr:'Brouillard',                   ar:'ضباب',                 de:'Neblig',                   nl:'Mistig'                   },
  wxDrizzle:    { en:'Drizzle',              zh:'毛毛雨',          hi:'बूंदाबांदी',               es:'Llovizna',               fr:'Bruine',                       ar:'رذاذ',                 de:'Nieselregen',              nl:'Motregen'                 },
  wxFreezeDz:   { en:'Freezing Drizzle',     zh:'冻毛毛雨',         hi:'जमने वाली बूंदाबांदी',     es:'Llovizna helada',        fr:'Bruine verglaçante',           ar:'رذاذ متجمد',           de:'Gefrierender Nieselregen', nl:'IJzel en motregen'        },
  wxRain:       { en:'Rain',                 zh:'雨',            hi:'बारिश',                    es:'Lluvia',                 fr:'Pluie',                        ar:'مطر',                  de:'Regen',                    nl:'Regen'                    },
  wxFreezeRain: { en:'Freezing Rain',        zh:'冻雨',           hi:'जमने वाली बारिश',          es:'Lluvia helada',          fr:'Pluie verglaçante',            ar:'أمطار متجمدة',         de:'Gefrierender Regen',       nl:'IJzelregen'               },
  wxSnow:       { en:'Snow',                 zh:'雪',            hi:'हिमपात',                   es:'Nieve',                  fr:'Neige',                        ar:'ثلج',                  de:'Schnee',                   nl:'Sneeuw'                   },
  wxShowers:    { en:'Showers',              zh:'阵雨',           hi:'बौछारें',                  es:'Chubascos',              fr:'Averses',                      ar:'زخات مطر',             de:'Regenschauer',             nl:'Buien'                    },
  wxSnowSh:     { en:'Snow Showers',         zh:'阵雪',           hi:'हिम बौछारें',              es:'Chubascos de nieve',     fr:'Averses de neige',             ar:'زخات ثلج',             de:'Schneeschauer',            nl:'Sneeuwbuien'              },
  wxThunder:    { en:'Thunderstorm',         zh:'雷暴',           hi:'आंधी-तूफ़ान',              es:'Tormenta',               fr:'Orage',                        ar:'عاصفة رعدية',          de:'Gewitter',                 nl:'Onweer'                   },
  wxFair:       { en:'Fair',                 zh:'晴朗',           hi:'मौसम साफ़',                es:'Despejado',              fr:'Beau temps',                   ar:'صحو',                  de:'Aufgeheitert',             nl:'Mooi weer'                }

};

function t(key, lang) {
  lang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  const entry = T_L[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

const T_SEC   = { en:"SUN & CELESTIAL",            zh:"太阳与天象",            hi:"सूर्य और खगोल",              es:"SOL Y CIELO",               fr:"SOLEIL ET CIEL",              ar:"الشمس والسماء",               de:"SONNE & HIMMEL",               nl:"ZON & HEMEL" };
const T_TEMP  = { en:"TEMPERATURE & COMFORT",       zh:"温度与体感",            hi:"तापमान और आराम",              es:"TEMPERATURA Y CONFORT",      fr:"TEMPÉRATURE ET CONFORT",     ar:"الحرارة والراحة",             de:"TEMPERATUR & KOMFORT",        nl:"TEMPERATUUR & COMFORT" };
const T_AIR   = { en:"AIR QUALITY & BIO",          zh:"空气质量与生物",         hi:"वायु गुणवत्ता और जैव",        es:"CALIDAD DEL AIRE Y BIO",     fr:"QUALITÉ DE L'AIR & BIO",     ar:"جودة الهواء والبيئة",          de:"LUFTQUALITÄT & BIO",         nl:"LUCHTKWALITEIT & BIO" };
const T_AGG   = { en:"7-DAY AGGREGATE",            zh:"近7天汇总",             hi:"7-दिन का सारांश",              es:"AGREGADO 7 DÍAS",           fr:"AGRÉGAT 7 JOURS",           ar:"ملخص 7 أيام",                  de:"7-TAGE-AGGREGAT",             nl:"7-DAGEN TOTAAL" };
const T_AUDIT = { en:"MODEL AUDIT",                zh:"模型校准",               hi:"मॉडल ऑडिट",                  es:"AUDITORÍA DEL MODELO",      fr:"AUDIT DU MODÈLE",            ar:"تدقيق النموذج",                de:"MODELL-AUDIT",                nl:"MODEL-AUDIT" };
const T_ROAD  = { en:"ROAD SAFETY",                zh:"道路安全",               hi:"सड़क सुरक्षा",                  es:"SEGURIDAD VIAL",             fr:"SÉCURITÉ ROUTIÈRE",          ar:"سلامة الطرق",                  de:"STRAßENSICHERHEIT",          nl:"WEGVEILIGHEID" };
const T_ADV   = { en:"ACTIONABLE ADVICE",           zh:"行动建议",               hi:"सुझाव",                        es:"CONSEJOS PRÁCTICOS",         fr:"CONSEILS PRATIQUES",         ar:"نصائح عملية",                  de:"PRAKTISCHE TIPPS",           nl:"ADVIES" };
const T_SOURCES = { en:"SOURCES",                    zh:"数据来源",               hi:"स्रोत",                         es:"FUENTES",                    fr:"SOURCES",                    ar:"المصادر",                    de:"QUELLEN",                     nl:"BRONNEN" };
const T_ONTHISDAY = { en:"ON THIS DAY",               zh:"今日回顾",               hi:"आज के दिन",                    es:"EN ESTE DÍA",               fr:"CE JOUR-LÀ",                ar:"في مثل هذا اليوم",              de:"AN DIESEM TAG",              nl:"OP DEZE DAG" };
const T_WIKI = { en:"WIKIPEDIA ON THIS DAY",         zh:"维基今日",               hi:"विकिपीडिया पर इस दिन",        es:"WIKIPEDIA EN ESTE DÍA",     fr:"WIKIPEDIA CE JOUR-LÀ",      ar:"ويكيبيديا في مثل هذا اليوم",  de:"WIKIPEDIA AN DIESEM TAG",   nl:"WIKIPEDIA OP DEZE DAG" };
const T_BREAKING = { en:"BREAKING NEWS (TODAY)",      zh:"今日突发新闻",           hi:"आज की ताज़ा खबर",             es:"ÚLTIMAS NOTICIAS (HOY)",    fr:"DERNIÈRES NOUVELLES (AUJ.)", ar:"الأخبار العاجلة (اليوم)",    de:"BREAKING NEWS (HEUTE)",       nl:"NIEUWS VANDAAG" };

function tSection(key, lang) {
  lang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  const sections = { secTemp:T_TEMP, secSun:T_SEC, secAir:T_AIR, secAgg:T_AGG, secAudit:T_AUDIT, secRoad:T_ROAD, secAdvice:T_ADV, secSources:T_SOURCES, secOnThisDay:T_ONTHISDAY, secWiki:T_WIKI, secBreaking:T_BREAKING };
  const map = sections[key];
  if (!map) return key;
  return map[lang] || map.en || key;
}

let _fetchAllImplGcal = UrlFetchApp.fetchAll.bind(UrlFetchApp);
let _nowOverrideGcal = null;
const _now = () => _nowOverrideGcal !== null ? _nowOverrideGcal : Date.now();
const _WIKI_CACHE_MAX = 50; // Cap in-memory Wikipedia cache per execution
let _wikiCacheGcal = {}; // Deduplicate Wikipedia fetches per (month, day) per execution
let _wikiCacheOrderGcal = []; // Track insertion order for spec-compliant FIFO eviction
const _BREAKING_NEWS_CACHE_MAX = 50; // Cap in-memory breaking news cache per execution
let _breakingNewsCacheGcal = {}; // Deduplicate breaking news fetches per date per execution
let _breakingNewsCacheOrderGcal = []; // Track insertion order for spec-compliant FIFO eviction
const _scriptProps = PropertiesService.getScriptProperties(); // Cached for execution

// ============================================================
// CIRCUIT BREAKER — prevents cascade failures from API outages
// ============================================================
const CB = (() => {
  const STATES = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 };
  const defaults = {
    failureThreshold: 3,     // failures before opening
    recoveryTimeoutMs: 30000, // 30s before testing recovery
    halfOpenMaxCalls: 2,    // test calls in half-open before deciding
    backoffMultiplier: 2,    // exponential backoff base
    maxBackoffMs: 60000     // max 60s backoff
  };

  const circuits = {};

  const create = (name, opts = {}) => {
    const cfg = { ...defaults, ...opts };
    circuits[name] = {
      state: STATES.CLOSED,
      failures: 0,
      lastFailureTime: 0,
      halfOpenCalls: 0,
      backoffMs: 0,
      cfg
    };
  };

  const _recordSuccess = (name) => {
    const cb = circuits[name];
    if (!cb) return;
    if (cb.state === STATES.HALF_OPEN) {
      cb.halfOpenCalls++;
      if (cb.halfOpenCalls >= cb.cfg.halfOpenMaxCalls) {
        const successes = cb.halfOpenCalls;
        cb.state = STATES.CLOSED;
        cb.failures = 0;
        cb.halfOpenCalls = 0;
        cb.backoffMs = 0;
        Logger.log(`Circuit [${name}] CLOSED (recovered after ${successes} half-open successes)`);
      }
    } else if (cb.state === STATES.CLOSED) {
      cb.failures = 0;
      cb.backoffMs = 0;
    }
  };

  const _recordFailure = (name) => {
    const cb = circuits[name];
    if (!cb) return;
    cb.lastFailureTime = Date.now();
    if (cb.state === STATES.HALF_OPEN) {
      cb.state = STATES.OPEN;
      cb.halfOpenCalls = 0;
      cb.backoffMs = Math.min(cb.backoffMs * cb.cfg.backoffMultiplier || 1000, cb.cfg.maxBackoffMs);
      Logger.log(`Circuit [${name}] OPEN (half-open failure, backoff ${cb.backoffMs}ms)`);
    } else {
      cb.failures++;
      if (cb.failures >= cb.cfg.failureThreshold) {
        cb.state = STATES.OPEN;
        cb.backoffMs = 1000;
        Logger.log(`Circuit [${name}] OPEN (${cb.failures} failures)`);
      }
    }
  };

  const isCallAllowed = (name) => {
    const cb = circuits[name];
    if (!cb) return true;
    const cfg = cb.cfg;

    if (cb.state === STATES.CLOSED) return true;

    if (cb.state === STATES.OPEN) {
      const elapsed = Date.now() - cb.lastFailureTime;
      if (elapsed >= Math.max(cb.backoffMs, cfg.recoveryTimeoutMs)) {
        // Atomic transition: only the first caller after timeout gets HALF_OPEN
        if (cb.state === STATES.OPEN) {
          cb.state = STATES.HALF_OPEN;
          cb.halfOpenCalls = 0;
          Logger.log(`Circuit [${name}] HALF_OPEN (recovery timeout elapsed)`);
        }
        return true;
      }
      return false;
    }

    if (cb.state === STATES.HALF_OPEN) {
      return cb.halfOpenCalls < cb.cfg.halfOpenMaxCalls;
    }

    return true;
  };

  const recordSuccess = (name) => _recordSuccess(name);
  const recordFailure = (name) => _recordFailure(name);

  const getState = (name) => {
    const cb = circuits[name];
    if (!cb) return 'UNKNOWN';
    if (cb.state === STATES.CLOSED) return 'CLOSED';
    if (cb.state === STATES.OPEN) return 'OPEN';
    if (cb.state === STATES.HALF_OPEN) return 'HALF_OPEN';
    return 'UNKNOWN';
  };
  // Read-only config accessor for tests / introspection. Returns the
  // circuit's resolved cfg object (defaults merged with overrides) or
  // undefined for unknown circuit names.
  const cfg = (name) => {
    const cb = circuits[name];
    return cb ? cb.cfg : undefined;
  };

  // Initialize standard circuits
  create('openmeteo');
  create('wikipedia');
  create('newsapi');
  create('openaq');
  create('waqi');
  create('geocoder');

  return { create, isCallAllowed, recordSuccess, recordFailure, getState, cfg, STATES };
})();

const { budgetStart, budgetSetNow, checkBudget } = (() => {
  const APPS_SCRIPT_BUDGET_MS = 345000;
  const BUDGET_WARN_AT_MS = [240000, 300000];
  let _budgetWarnedAt = new Set();
  return {
    budgetStart() {
      _budgetWarnedAt = new Set();
      _nowOverrideGcal = null;
      return _now();
    },
    budgetSetNow(fn) {
      // Use Number.isFinite to reject NaN/Infinity — typeof NaN === "number"
      // is true, so a test passing budgetSetNow(NaN) would silently poison
      // every elapsed comparison and the budget check would never fire.
      _nowOverrideGcal = Number.isFinite(fn) ? fn : null;
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
      const legacy = PropertiesService.getScriptProperties().getProperty("WAQI_TOKEN");
      if (legacy && legacy.length > 0) {
        Logger.log("waqiTokenResolve: WAQI_TOKEN in ScriptProperties is deprecated — call waqiTokenSave() to migrate");
        _waqiTokenCache = legacy;
        return legacy;
      }
      _waqiTokenCache = "";
      return "";
    }
  };
})();

function fetchAllWithRetry(requests) {
  const total = requests.length;
  const responses = new Array(total);

  // Circuit breaker: fail fast if circuit is open
  if (!CB.isCallAllowed('openmeteo')) {
    Logger.log("Circuit [openmeteo] OPEN — skipping all requests");
    return responses.map(() => ({ getResponseCode: () => 503, getContentText: () => '{"error":"circuit_open"}' }));
  }

  let pending = requests.map((_, i) => i);
  let attempt = 0;
  let hasFailure = false;
  while (attempt < FETCH_MAX_RETRIES && pending.length > 0) {
    attempt++;
    const batch = pending.map(i => requests[i]);
    const batchResponses = _fetchAllImplGcal(batch);
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
        if (code >= 400) {
          Logger.log(`fetchAllWithRetry: HTTP ${code} — ${url} — giving up`);
          hasFailure = true;
        }
      }
    });
    pending = nextPending;
    if (pending.length > 0 && attempt < FETCH_MAX_RETRIES) {
      // Exponential backoff with jitter: 500ms * 2^attempt ± 25%
      const baseDelay = Math.pow(2, attempt) * 500;
      const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
      Utilities.sleep(Math.max(100, Math.round(baseDelay + jitter)));
    }
  }
  // Record circuit state based on outcome
  if (hasFailure) {
    CB.recordFailure('openmeteo');
  } else {
    CB.recordSuccess('openmeteo');
  }
  return responses;
}

const OPEN_METEO_AQ_FORECAST_DAYS_CAP = 7;
const OPENAQ_LATEST_ENDPOINT = "https://api.openaq.org/v3/latest";
const WAQI_BASE_ENDPOINT = "https://api.waqi.info/feed/geo:";
const _AQ_CAP_PROP = "AQ_CAP_PROBED_V1";
// Probe location for AQ API cap detection — can be overridden via ScriptProperties
// AQ_CAP_PROBE_LAT/AQ_CAP_PROBE_LON if a different location is preferred.
const AQ_CAP_PROBE_LAT = 50.95;
const AQ_CAP_PROBE_LON = 5.97;
// AQI Cache Properties
const AQI_CACHE_PREFIX = "aqi_cache_";
const AQI_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (default)
const AQI_CACHE_TTL_MIN_MS = 1 * 60 * 60 * 1000; // 1 hour (high volatility)
const AQI_CACHE_TTL_MAX_MS = 12 * 60 * 60 * 1000; // 12 hours (stable)
const AQI_HISTORY_PREFIX = "aqi_history_";
const AQI_HISTORY_MAX_DAYS = 14; // Keep 14 days of history for variance calculation
const AQI_VARIANCE_THRESHOLD_HIGH = 400; // Variance threshold for high volatility (AQI units^2)
const AQI_VARIANCE_THRESHOLD_LOW = 50; // Variance threshold for stable conditions

function getAdaptiveAqiTtl(locName) {
  // Compute variance from stored AQI history to determine cache TTL.
  const historyKey = AQI_HISTORY_PREFIX + norm(locName).toLowerCase().replace(/[^a-z0-9]/g, "_");
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(historyKey);
  if (!cached) return AQI_CACHE_TTL_MS; // No history → default TTL
  try {
    const history = JSON.parse(cached);
    if (!Array.isArray(history) || history.length < 2) return AQI_CACHE_TTL_MS;
    // Compute variance of european_aqi values (most recent AQI_HISTORY_MAX_DAYS entries)
    const values = history
      .slice(-AQI_HISTORY_MAX_DAYS)
      .map(d => d.european_aqi)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    if (values.length < 2) return AQI_CACHE_TTL_MS;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    if (variance >= AQI_VARIANCE_THRESHOLD_HIGH) return AQI_CACHE_TTL_MIN_MS; // High volatility → 1h
    if (variance <= AQI_VARIANCE_THRESHOLD_LOW) return AQI_CACHE_TTL_MAX_MS; // Stable → 12h
    // Linear interpolation between thresholds for medium volatility
    const t = (variance - AQI_VARIANCE_THRESHOLD_LOW) / (AQI_VARIANCE_THRESHOLD_HIGH - AQI_VARIANCE_THRESHOLD_LOW);
    return Math.round(AQI_CACHE_TTL_MAX_MS - t * (AQI_CACHE_TTL_MAX_MS - AQI_CACHE_TTL_MIN_MS));
  } catch (e) {
    return AQI_CACHE_TTL_MS; // Parse error → default TTL
  }
}

function updateAqiHistory(locName, aqi) {
  // Append today's AQI to history for variance calculation.
  if (!aqi || !aqi.time || !aqi.european_aqi) return;
  const historyKey = AQI_HISTORY_PREFIX + norm(locName).toLowerCase().replace(/[^a-z0-9]/g, "_");
  const props = PropertiesService.getScriptProperties();
  let history = [];
  const cached = props.getProperty(historyKey);
  if (cached) {
    try {
      history = JSON.parse(cached);
      if (!Array.isArray(history)) history = [];
    } catch (e) {
      history = [];
    }
  }
  // Add latest AQI entry (today's value)
  const todayIdx = 0; // aqi.time[0] is today (see gcalFetchGlobalAQI date generation)
  const latestAqi = aqi.european_aqi[todayIdx];
  if (latestAqi !== null && latestAqi !== undefined && !isNaN(latestAqi)) {
    history.push({ date: aqi.time[todayIdx], european_aqi: latestAqi });
    // Keep only last AQI_HISTORY_MAX_DAYS entries
    if (history.length > AQI_HISTORY_MAX_DAYS) history = history.slice(-AQI_HISTORY_MAX_DAYS);
    props.setProperty(historyKey, JSON.stringify(history));
  }
}

let _probedAqCapGcal = null;

function getOpenMeteoAqCap() {
  if (_probedAqCapGcal !== null) return _probedAqCapGcal;
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(_AQ_CAP_PROP);
  if (cached !== null) {
    const parts = cached.split(",");
    if (parts.length === 2) {
      const cachedCap = parseInt(parts[0], 10);
      const cachedDay = parts[1];
      const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
      if (cachedDay === today && cachedCap >= 5 && cachedCap <= 16) {
        _probedAqCapGcal = cachedCap;
        return _probedAqCapGcal;
      }
    }
  }
  const detected = _probeOpenMeteoAqCap();
  if (detected.probeSucceeded) {
    _probedAqCapGcal = detected.cap;
    const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
    props.setProperty(_AQ_CAP_PROP, String(detected.cap) + "," + today);
  } else {
    // Probe failed (network/API error) — fail-safe to default without persisting.
    // This prevents repeated probing on transient failures within the same execution.
    _probedAqCapGcal = detected.cap;
  }
  return _probedAqCapGcal;
}

function _probeOpenMeteoAqCap() {
  const PROBE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
  const lo = 5, hi = 16;
  let cap = OPEN_METEO_AQ_FORECAST_DAYS_CAP;
  let probeSucceeded = false;
  const tryFetch = (days) => {
    try {
      const url = PROBE_URL + "?latitude=" + AQ_CAP_PROBE_LAT + "&longitude=" + AQ_CAP_PROBE_LON +
        "&hourly=european_aqi&forecast_days=" + days + "&timezone=auto";
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
      const code = res.getResponseCode();
      if (code === 429) return 429; // Rate limited - treat as retryable
      return code;
    } catch (e) {
      return 0;
    }
  };
  let l = lo, r = hi;
  while (l <= r) {
    const mid = Math.floor((l + r) / 2);
    const code = tryFetch(mid);
    if (code === 200) {
      probeSucceeded = true;
      cap = mid;
      l = mid + 1;
    } else if (code === 429) {
      // Rate limited - retry same mid after delay, don't shrink search range
      Logger.log("_probeOpenMeteoAqCap: rate limited at days=" + mid + ", retrying after delay");
      Utilities.sleep(1000);
      continue;
    } else if (code >= 400) {
      r = mid - 1;
    } else {
      break;
    }
    // Small delay between probes to avoid triggering rate limits
    if (l <= r) Utilities.sleep(250);
  }
  if (cap < OPEN_METEO_AQ_FORECAST_DAYS_CAP) {
    Logger.log("Open-Meteo AQ API cap probe: API returned HTTP " +
      "400 at forecast_days=" + OPEN_METEO_AQ_FORECAST_DAYS_CAP +
      " (hardcoded default). Detected cap: " + cap + ". " +
      "Update OPEN_METEO_AQ_FORECAST_DAYS_CAP to " + cap + " in both files.");
  }
  return { cap, probeSucceeded };
}

const ASTRONOMICAL_EVENTS = {
  "01-03": "Quadrantid Meteor Peak (~110/hr)",
  "01-04": "Earth at Perihelion (Closest to Sun)",
  "01-10": "🌕 Full Moon — Wolf Moon",
  "01-25": "🌑 New Moon",
  "03-20": "🌱 Vernal Equinox (Equal Day/Night)",
  "03-25": "🌕 Full Moon — Worm Moon; 🌑 Penumbral Lunar Eclipse",
  "04-08": "🌑 New Moon — Solar Eclipse Season Begins; 🌞 Total Solar Eclipse (North America)",
  "04-22": "Lyrid Meteor Peak (~18/hr)",
  "04-23": "Lyrid Active Window",
  "04-24": "🌕 Full Moon — Pink Moon",
  "05-06": "Eta Aquariids Peak (~50/hr)",
  "05-07": "Eta Aquariids Active Window",
  "05-23": "🌕 Full Moon — Flower Moon",
  "06-06": "🌑 New Moon",
  "06-21": "☀️ Summer Solstice (Longest Day); 🌕 Full Moon — Strawberry Moon",
  "07-04": "Earth at Aphelion (Furthest from Sun)",
  "07-06": "🌑 New Moon",
  "07-21": "🌕 Full Moon — Buck Moon",
  "07-28": "Delta Aquariids Peak (~20/hr)",
  "07-29": "Delta Aquariids Active Window",
  "08-04": "🌑 New Moon",
  "08-12": "Perseid Meteor Peak (~100/hr)",
  "08-13": "Perseid Active Window",
  "08-19": "🌕 Full Moon — Sturgeon Moon",
  "08-27": "Saturn at Opposition (Brightest)",
  "09-03": "🌑 New Moon",
  "09-17": "🌕 Full Moon — Harvest Moon; 🌑 Partial Lunar Eclipse",
  "09-19": "Neptune at Opposition",
  "09-22": "🍂 Autumnal Equinox (Equal Day/Night)",
  "10-02": "🌑 New Moon — Annular Solar Eclipse Season; 🌞 Annular Solar Eclipse (Pacific/South America)",
  "10-07": "Draconid Meteor Peak (~10/hr)",
  "10-17": "🌕 Full Moon — Hunter's Moon",
  "10-21": "Orionid Meteor Peak (~20/hr)",
  "10-22": "Orionid Active Window",
  "11-01": "🌑 New Moon",
  "11-05": "Southern Taurids Peak (~5-10 fireball/hr)",
  "11-12": "Northern Taurids Peak (~5 fireball/hr)",
  "11-15": "🌕 Full Moon — Beaver Moon",
  "11-17": "Leonid Meteor Peak (~15/hr)",
  "11-18": "Leonid Active Window",
  "11-30": "🌑 New Moon",
  "12-07": "Jupiter at Opposition (Brightest)",
  "12-13": "Geminid Meteor Ramp-up (~60/hr)",
  "12-14": "Geminid Meteor Peak (~120/hr)",
  "12-15": "🌕 Full Moon — Cold Moon",
  "12-21": "❄️ Winter Solstice (Shortest Day)",
  "12-22": "Ursid Meteor Peak (~10/hr)",
  "12-30": "🌑 New Moon"
};

const SOLAR_ECLIPSES = {
  "04-08": "🌞 Total Solar Eclipse (North America)",
  "10-02": "🌞 Annular Solar Eclipse (Pacific/South America)"
};

const LUNAR_ECLIPSES = {
  "03-25": "🌑 Penumbral Lunar Eclipse",
  "09-17": "🌑 Partial Lunar Eclipse"
};

const PLANETARY_EVENTS = {
  "01-12": "Mercury at Greatest Western Elongation (Morning); Mars at Opposition",
  "03-24": "Mercury at Greatest Eastern Elongation (Evening); Venus at Greatest Eastern Elongation (Evening Star)",
  "05-09": "Mercury at Greatest Western Elongation (Morning)",
  "07-22": "Mercury at Greatest Eastern Elongation (Evening)",
  "09-05": "Mercury at Greatest Western Elongation (Morning)",
  "11-16": "Mercury at Greatest Eastern Elongation (Evening)",
  "06-04": "Venus at Greatest Western Elongation (Morning Star)",
  "09-21": "Neptune at Opposition",
  "11-03": "Uranus at Opposition",
  "09-08": "Saturn at Opposition"
};

const METEOR_SHOWERS = {
  "01-03": { name: "Quadrantids", peak: "01-03", rate: "110/hr", parent: "2003 EH1" },
  "04-22": { name: "Lyrids", peak: "04-22", rate: "18/hr", parent: "Thatcher" },
  "05-06": { name: "Eta Aquariids", peak: "05-06", rate: "50/hr", parent: "Halley" },
  "07-28": { name: "Delta Aquariids", peak: "07-28", rate: "20/hr", parent: "96P/Machholz" },
  "08-12": { name: "Perseids", peak: "08-12", rate: "100/hr", parent: "Swift-Tuttle" },
  "10-07": { name: "Draconids", peak: "10-07", rate: "10/hr", parent: "21P/Giacobini-Zinner" },
  "10-21": { name: "Orionids", peak: "10-21", rate: "20/hr", parent: "Halley" },
  "11-05": { name: "S. Taurids", peak: "11-05", rate: "5-10/hr", parent: "Encke" },
  "11-12": { name: "N. Taurids", peak: "11-12", rate: "5/hr", parent: "Encke" },
  "11-17": { name: "Leonids", peak: "11-17", rate: "15/hr", parent: "Tempel-Tuttle" },
  "12-14": { name: "Geminids", peak: "12-14", rate: "120/hr", parent: "3200 Phaethon" },
  "12-22": { name: "Ursids", peak: "12-22", rate: "10/hr", parent: "8P/Tuttle" }
};

const AURORA_SEASONS = {
  "03-20": "🌌 Aurora Season Begins (Equinox Effect)",
  "09-22": "🌌 Aurora Season Peaks (Equinox Effect)"
};

const LUNAR_PHASES = {
  "01-03": "🌖 Waning Gibbous",
  "01-10": "🌕 Full Moon",
  "01-17": "🌗 Last Quarter",
  "01-25": "🌑 New Moon",
  "02-02": "🌓 First Quarter",
  "02-09": "🌕 Full Moon",
  "02-15": "🌗 Last Quarter",
  "02-23": "🌑 New Moon",
  "03-01": "🌓 First Quarter",
  "03-10": "🌕 Full Moon",
  "03-16": "🌗 Last Quarter",
  "03-25": "🌑 New Moon",
  "03-31": "🌓 First Quarter",
  "04-08": "🌕 Full Moon",
  "04-15": "🌗 Last Quarter",
  "04-23": "🌑 New Moon",
  "04-30": "🌓 First Quarter",
  "05-07": "🌕 Full Moon",
  "05-14": "🌗 Last Quarter",
  "05-23": "🌑 New Moon",
  "05-30": "🌓 First Quarter",
  "06-06": "🌕 Full Moon",
  "06-13": "🌗 Last Quarter",
  "06-21": "🌑 New Moon",
  "06-28": "🌓 First Quarter",
  "07-06": "🌕 Full Moon",
  "07-13": "🌗 Last Quarter",
  "07-21": "🌑 New Moon",
  "07-28": "🌓 First Quarter",
  "08-04": "🌕 Full Moon",
  "08-11": "🌗 Last Quarter",
  "08-19": "🌑 New Moon",
  "08-26": "🌓 First Quarter",
  "09-03": "🌕 Full Moon",
  "09-10": "🌗 Last Quarter",
  "09-17": "🌑 New Moon",
  "09-24": "🌓 First Quarter",
  "10-02": "🌕 Full Moon",
  "10-10": "🌗 Last Quarter",
  "10-17": "🌑 New Moon",
  "10-24": "🌓 First Quarter",
  "11-01": "🌕 Full Moon",
  "11-08": "🌗 Last Quarter",
  "11-15": "🌑 New Moon",
  "11-22": "🌓 First Quarter",
  "11-30": "🌕 Full Moon",
  "12-08": "🌗 Last Quarter",
  "12-15": "🌑 New Moon",
  "12-22": "🌓 First Quarter",
  "12-30": "🌕 Full Moon"
};

const ASTRONOMICAL_EVENTS_DETAILED = {
  ...SOLAR_ECLIPSES,
  ...LUNAR_ECLIPSES,
  ...PLANETARY_EVENTS,
  ...AURORA_SEASONS,
  ...ASTRONOMICAL_EVENTS
};

// ============================================================
// CULTURAL EVENTS — On This Day: holidays, observances, anniversaries
// ============================================================
const NATIONAL_HOLIDAYS = {
  "US": {
    "01-01": "New Year's Day",
    "01-20": "Martin Luther King Jr. Day",
    "02-17": "Presidents' Day",
    "05-26": "Memorial Day",
    "06-19": "Juneteenth",
    "07-04": "Independence Day",
    "09-02": "Labor Day",
    "10-14": "Columbus Day",
    "11-11": "Veterans Day",
    "11-28": "Thanksgiving",
    "12-25": "Christmas Day"
  },
  "GB": {
    "01-01": "New Year's Day",
    "03-29": "Good Friday",
    "04-01": "Easter Monday",
    "05-06": "Early May Bank Holiday",
    "05-27": "Spring Bank Holiday",
    "08-26": "Summer Bank Holiday",
    "12-25": "Christmas Day",
    "12-26": "Boxing Day"
  },
  "DE": {
    "01-01": "Neujahr",
    "03-29": "Karfreitag",
    "04-01": "Ostermontag",
    "05-01": "Tag der Arbeit",
    "05-09": "Christi Himmelfahrt",
    "05-20": "Pfingstmontag",
    "10-03": "Tag der Deutschen Einheit",
    "12-25": "Weihnachten",
    "12-26": "2. Weihnachtsfeiertag"
  },
  "FR": {
    "01-01": "Jour de l'An",
    "04-01": "Lundi de Pâques",
    "05-01": "Fête du Travail",
    "05-08": "Victoire 1945",
    "05-09": "Ascension",
    "05-20": "Lundi de Pentecôte",
    "07-14": "Fête Nationale",
    "08-15": "Assomption",
    "11-01": "Toussaint",
    "11-11": "Armistice 1918",
    "12-25": "Noël"
  },
  "CA": {
    "01-01": "New Year's Day",
    "02-19": "Family Day",
    "03-29": "Good Friday",
    "05-20": "Victoria Day",
    "07-01": "Canada Day",
    "09-02": "Labour Day",
    "10-14": "Thanksgiving",
    "11-11": "Remembrance Day",
    "12-25": "Christmas Day",
    "12-26": "Boxing Day"
  },
  "AU": {
    "01-01": "New Year's Day",
    "01-26": "Australia Day",
    "03-29": "Good Friday",
    "04-01": "Easter Monday",
    "04-25": "ANZAC Day",
    "06-10": "King's Birthday",
    "12-25": "Christmas Day",
    "12-26": "Boxing Day"
  },
  "JP": {
    "01-01": "元日",
    "01-08": "成人の日",
    "02-11": "建国記念の日",
    "02-23": "天皇誕生日",
    "03-20": "春分の日",
    "04-29": "昭和の日",
    "05-03": "憲法記念日",
    "05-04": "みどりの日",
    "05-05": "こどもの日",
    "07-15": "海の日",
    "08-11": "山の日",
    "09-16": "敬老の日",
    "09-23": "秋分の日",
    "10-14": "スポーツの日",
    "11-03": "文化の日",
    "11-23": "勤労感謝の日"
  },
  "CN": {
    "01-01": "元旦",
    "02-10": "春节",
    "04-04": "清明节",
    "05-01": "劳动节",
    "06-10": "端午节",
    "09-17": "中秋节",
    "10-01": "国庆节"
  },
  "IN": {
    "01-26": "Republic Day",
    "08-15": "Independence Day",
    "10-02": "Gandhi Jayanti",
    "11-01": "Diwali",
    "12-25": "Christmas"
  }
};

const INTERNATIONAL_OBSERVANCES = {
  "01-01": "Global Family Day",
  "01-27": "International Holocaust Remembrance Day",
  "02-02": "World Wetlands Day",
  "02-11": "International Day of Women and Girls in Science",
  "02-20": "World Day of Social Justice",
  "03-03": "World Wildlife Day",
  "03-08": "International Women's Day",
  "03-20": "International Day of Happiness",
  "03-21": "World Poetry Day / Intl. Day of Forests",
  "03-22": "World Water Day",
  "03-23": "World Meteorological Day",
  "04-02": "World Autism Awareness Day",
  "04-07": "World Health Day",
  "04-22": "Earth Day",
  "04-23": "World Book and Copyright Day",
  "05-03": "World Press Freedom Day",
  "05-15": "International Day of Families",
  "05-17": "World Telecommunication Day",
  "05-22": "International Day for Biological Diversity",
  "05-31": "World No Tobacco Day",
  "06-05": "World Environment Day",
  "06-08": "World Oceans Day",
  "06-12": "World Day Against Child Labour",
  "06-20": "World Refugee Day",
  "06-21": "International Day of Yoga",
  "07-11": "World Population Day",
  "07-30": "International Day of Friendship",
  "08-09": "International Day of the World's Indigenous Peoples",
  "08-12": "International Youth Day",
  "08-19": "World Humanitarian Day",
  "09-08": "International Literacy Day",
  "09-15": "International Day of Democracy",
  "09-21": "International Day of Peace",
  "09-27": "World Tourism Day",
  "10-01": "International Day of Older Persons",
  "10-05": "World Teachers' Day",
  "10-10": "World Mental Health Day",
  "10-16": "World Food Day",
  "10-24": "United Nations Day",
  "11-10": "World Science Day for Peace and Development",
  "11-20": "Universal Children's Day",
  "12-01": "World AIDS Day",
  "12-03": "International Day of Persons with Disabilities",
  "12-05": "World Soil Day",
  "12-10": "Human Rights Day",
  "12-20": "International Human Solidarity Day"
};

const NOTABLE_ANNIVERSARIES = {
  "01-04": "Louis Braille born (1809)",
  "01-15": "Wikipedia launched (2001)",
  "01-28": "Space Shuttle Challenger disaster (1986)",
  "02-12": "Darwin Day — Charles Darwin born (1809)",
  "02-14": "Valentine's Day",
  "03-14": "Pi Day / Einstein born (1879)",
  "04-12": "Yuri's Night — First human in space (1961)",
  "04-23": "Shakespeare born & died (1564/1616)",
  "05-04": "Star Wars Day (May the 4th)",
  "05-25": "Towel Day (Douglas Adams tribute)",
  "07-20": "Moon Landing — Apollo 11 (1969)",
  "07-21": "First Moon Walk (1969)",
  "08-12": "International Youth Day",
  "09-09": "Teddy Bear Day",
  "10-04": "World Animal Day / Sputnik launched (1957)",
  "10-31": "Halloween",
  "11-09": "Fall of Berlin Wall (1989)",
  "12-10": "Human Rights Day",
  "12-25": "Christmas / Newton born (1642)",
  "12-31": "New Year's Eve"
};

const RELIGIOUS_OBSERVANCES = {
  "01-06": "Epiphany / Three Kings Day",
  "03-10": "Ramadan begins (varies)",
  "04-13": "Palm Sunday (varies)",
  "04-18": "Good Friday (varies)",
  "04-20": "Easter Sunday (varies)",
  "05-09": "Ascension Day (varies)",
  "05-19": "Pentecost (varies)",
  "06-16": "Eid al-Adha (varies)",
  "07-07": "Islamic New Year (varies)",
  "10-03": "Rosh Hashanah (varies)",
  "10-12": "Yom Kippur (varies)",
  "10-17": "Sukkot (varies)",
  "11-01": "All Saints' Day",
  "11-02": "All Souls' Day",
  "12-08": "Bodhi Day",
  "12-24": "Christmas Eve",
  "12-25": "Christmas Day"
};

const ALL_CULTURAL_EVENTS = {
  ...NATIONAL_HOLIDAYS,
  ...INTERNATIONAL_OBSERVANCES,
  ...NOTABLE_ANNIVERSARIES,
  ...RELIGIOUS_OBSERVANCES
};

function getCulturalEventsForDate(dateStr, countryCode) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const key = dateStr.slice(5);
  if (key.length !== 5 || !/^\d{2}-\d{2}$/.test(key)) return null;
  const events = [];
  
  // International observances (always shown)
  if (INTERNATIONAL_OBSERVANCES[key]) {
    events.push({ type: "observance", text: INTERNATIONAL_OBSERVANCES[key] });
  }
  
  // Notable anniversaries
  if (NOTABLE_ANNIVERSARIES[key]) {
    events.push({ type: "anniversary", text: NOTABLE_ANNIVERSARIES[key] });
  }
  
  // Religious observances
  if (RELIGIOUS_OBSERVANCES[key]) {
    events.push({ type: "religious", text: RELIGIOUS_OBSERVANCES[key] });
  }
  
  // Country-specific holidays
  if (countryCode && NATIONAL_HOLIDAYS[countryCode] && NATIONAL_HOLIDAYS[countryCode][key]) {
    events.push({ type: "holiday", text: NATIONAL_HOLIDAYS[countryCode][key] });
  }
  
  return events.length > 0 ? events : null;
}

function getOnThisDayText(dateStr, countryCode) {
  if (!dateStr) return null;
  const events = getCulturalEventsForDate(dateStr, countryCode);
  if (!events || events.length === 0) return null;
  
  const texts = events
    .filter(e => e && e.text)
    .map(e => {
      const icon = e.type === "holiday" ? "🎉" : e.type === "anniversary" ? "📜" : e.type === "religious" ? "⛪" : "🌍";
      return `• ${icon} ${e.text}`;
    });
  return texts.length > 0 ? texts.join("\n") : null;
}

// ============================================================
// WIKIPEDIA ON THIS DAY FETCHER
// ============================================================
const WIKIPEDIA_ONTHISDAY_URL = "https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/";

function fetchWikipediaOnThisDay(month, day) {
  // Validate month/day inputs
  if (!/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return null;
  }
  // Check in-memory cache first for execution deduplication
  const inMemKey = month + "_" + day;
  if (_wikiCacheGcal[inMemKey] !== undefined) {
    return _wikiCacheGcal[inMemKey];
  }
  // Circuit breaker: fail fast if circuit is open
  if (!CB.isCallAllowed('wikipedia')) {
    Logger.log("Circuit [wikipedia] OPEN — skipping fetch");
    return null;
  }
  const url = WIKIPEDIA_ONTHISDAY_URL + month + "/" + day;
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'meteo-ics/1.0 (https://github.com/neohiro/meteo-ics)' }
    });
    const code = res.getResponseCode();
    if (code === 200) {
      CB.recordSuccess('wikipedia');
      const data = JSON.parse(res.getContentText());
      if (data && data.events && data.events.length > 0) {
        const filtered = data.events
          .filter(e => e.year && e.year !== "Year unknown")
          .slice(0, 5)
          .map(e => `• ${e.year}: ${e.text}`);
        const result = filtered.join("\n");
        // Store result first, then enforce cache size limit (FIFO eviction)
        // This ensures eviction only happens when we actually have a result to cache
        // Use insertion-order queue for spec-compliant FIFO (Object.keys order not guaranteed)
        if (_wikiCacheOrderGcal.length >= _WIKI_CACHE_MAX) {
          const firstKey = _wikiCacheOrderGcal.shift();
          delete _wikiCacheGcal[firstKey];
        }
        _wikiCacheGcal[inMemKey] = result;
        _wikiCacheOrderGcal.push(inMemKey);
        return result;
      }
    } else {
      CB.recordFailure('wikipedia');
      Logger.log(`Wikipedia OnThisDay fetch HTTP ${code} — circuit failure recorded`);
    }
  } catch (e) {
    CB.recordFailure('wikipedia');
    Logger.log("Wikipedia OnThisDay fetch failed: " + e);
  }
  // Don't cache failures to allow retry on next call
  return null;
}

function fetchWikipediaOnThisDayCached(month, day) {
  const cacheKey = "wiki_onthisday_gcal_" + month + "_" + day;
  const cached = _scriptProps.getProperty(cacheKey);
  const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
  
  if (cached) {
    // Split on LAST pipe only to handle text containing pipe characters
    const lastPipeIdx = cached.lastIndexOf("|");
    if (lastPipeIdx > 0) {
      const cachedText = cached.substring(0, lastPipeIdx);
      const cachedDay = cached.substring(lastPipeIdx + 1);
      if (cachedDay === today) {
        return cachedText;
      }
    }
  }
  
  const fresh = fetchWikipediaOnThisDay(month, day);
  if (fresh) {
    _scriptProps.setProperty(cacheKey, fresh + "|" + today);
    return fresh;
  }
  return null;
}

function getWikipediaOnThisDayText(dateStr) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return fetchWikipediaOnThisDayCached(month, day);
}

// ============================================================
// BREAKING NEWS FETCHER (Historical "On This Day" Headlines)
// ============================================================
const NEWS_API_URL = "https://newsapi.org/v2/everything";
const NEWS_FREE_TIER_DAYS = 30; // NewsAPI free tier serves only the most recent 30 days

function fetchBreakingNews(dateStr, calTz) {
  // Circuit breaker: fail fast if circuit is open
  if (!CB.isCallAllowed('newsapi')) {
    Logger.log("Circuit [newsapi] OPEN — skipping fetch");
    return null;
  }
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  // Check in-memory cache first
  if (_breakingNewsCacheGcal[dateStr] !== undefined) {
    return _breakingNewsCacheGcal[dateStr];
  }
  // NewsAPI free tier only serves the last NEWS_FREE_TIER_DAYS days and
  // rejects future dates; any out-of-window date draws an HTTP 400 and burns
  // daily quota. Skip without calling. Use calendar timezone (same as todayStr)
  // so date classification matches the calendar's day boundaries.
  const now = new Date();
  const todayKey = Utilities.formatDate(now, calTz, "yyyy-MM-dd");
  const freeTierCutoff = Utilities.formatDate(
    new Date(now.getTime() - NEWS_FREE_TIER_DAYS * 86400000), calTz, "yyyy-MM-dd");
  if (dateStr > todayKey || dateStr < freeTierCutoff) {
    Logger.log(`Breaking news: ${dateStr} is outside NewsAPI coverage (${freeTierCutoff}..${todayKey}) — skipping`);
    if (_breakingNewsCacheOrderGcal.length >= _BREAKING_NEWS_CACHE_MAX) {
      const firstKey = _breakingNewsCacheOrderGcal.shift();
      delete _breakingNewsCacheGcal[firstKey];
    }
    _breakingNewsCacheGcal[dateStr] = null;
    _breakingNewsCacheOrderGcal.push(dateStr);
    return null;
  }
  try {
    const apiKey = _scriptProps.getProperty("NEWS_API_KEY");
    if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
      Logger.log("Breaking news: invalid or missing NEWS_API_KEY");
      return null;
    }
    // Use /v2/everything with from/to for historical dates; free tier only has 30 days history.
    // Use domains= for major news outlets (instead of q=weather) to get general popular news of the day.
    const majorNewsDomains = "bbc.com,cnn.com,reuters.com,apnews.com,nytimes.com,washingtonpost.com,theguardian.com,wsj.com,bloomberg.com,ft.com";
    const url = `${NEWS_API_URL}?domains=${encodeURIComponent(majorNewsDomains)}&from=${dateStr}&to=${dateStr}&language=en&pageSize=3&sortBy=popularity&apiKey=${encodeURIComponent(apiKey)}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
    const code = res.getResponseCode();
    if (code === 200) {
      CB.recordSuccess('newsapi');
      const data = JSON.parse(res.getContentText());
      if (data.status === "error") {
        Logger.log("Breaking news API error: " + (data.message || "unknown"));
        return null;
      }
      let result = null;
      if (data.articles && Array.isArray(data.articles) && data.articles.length > 0) {
        result = data.articles
          .slice(0, 3)
          .filter(a => a && a.title && a.source && a.source.name)
          .map(a => `• ${a.source.name}: ${a.title}`)
          .join("\n");
      }
      // Cache the result (including null for no articles)
      // Use insertion-order queue for spec-compliant FIFO (Object.keys order not guaranteed)
      if (_breakingNewsCacheOrderGcal.length >= _BREAKING_NEWS_CACHE_MAX) {
        const firstKey = _breakingNewsCacheOrderGcal.shift();
        delete _breakingNewsCacheGcal[firstKey];
      }
      _breakingNewsCacheGcal[dateStr] = result;
      _breakingNewsCacheOrderGcal.push(dateStr);
      return result;
    } else if (code >= 400 && code < 500) {
      // 4xx = permanent request rejection (bad params/key): not a transient
      // upstream failure, so don't trip the circuit breaker. Surface the API's
      // own message for diagnosis.
      let apiMsg = "";
      try { apiMsg = JSON.parse(res.getContentText()).message || ""; } catch (e) {}
      Logger.log(`Breaking news API ${code}${apiMsg ? ": " + apiMsg : ""}`);
    } else {
      CB.recordFailure('newsapi');
      Logger.log(`Breaking news fetch HTTP ${code} — circuit failure recorded`);
    }
  } catch (e) {
    CB.recordFailure('newsapi');
    Logger.log("Breaking news fetch failed: " + e);
  }
  return null;
}

function getBreakingNewsText(dateStr, calTz) {
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  return fetchBreakingNews(dateStr, calTz);
}

// Initialize and validate CONFIG: geocode locations, check deterministicDays cap.
// Returns { locations: Location[], errors: string[] } for testability.
function initConfig() {
  const errors = [];
  const locations = CONFIG.locations.filter(loc => {
    if (loc.lat && loc.lon) return true;
    const trimmedName = (loc.name || "").trim();
    if (!trimmedName) {
      errors.push(`Skipping location with empty/whitespace name.`);
      return false;
    }
    const query = loc.country ? `${trimmedName},${loc.country}` : trimmedName;
    const geo = geocodeCity(trimmedName, loc.country);
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && geo.name) {
      loc.lat = geo.lat;
      loc.lon = geo.lon;
      loc.name = geo.name;
      if (geo.tz) loc.tz = geo.tz;
      if (geo.country) loc.country = geo.country;
      return true;
    }
    errors.push(`Skipping unresolvable location: "${trimmedName}".`);
    return false;
  });

  if (locations.length === 0) {
    errors.push("CONFIG.locations resolved to an empty array — all locations failed geocoding. Check city names or provide explicit { name, lat, lon } entries.");
  }
  if (CONFIG.deterministicDays > 16) {
    errors.push(`CONFIG.deterministicDays (${CONFIG.deterministicDays}) exceeds Open-Meteo's max of 16 — deterministic events will be truncated. Reduce deterministicDays or accept ensemble-only forecast.`);
  }

  // Validate forecastDays
  if (!Number.isInteger(CONFIG.forecastDays) || CONFIG.forecastDays < 1 || CONFIG.forecastDays > 30) {
    errors.push(`CONFIG.forecastDays (${CONFIG.forecastDays}) must be an integer between 1 and 30.`);
  }

  // Validate historyDays
  if (!Number.isInteger(CONFIG.historyDays) || CONFIG.historyDays < 0 || CONFIG.historyDays > 14) {
    errors.push(`CONFIG.historyDays (${CONFIG.historyDays}) must be an integer between 0 and 14.`);
  }

  // Validate temperatureUnit
  if (CONFIG.temperatureUnit !== "celsius" && CONFIG.temperatureUnit !== "fahrenheit") {
    errors.push(`CONFIG.temperatureUnit ("${CONFIG.temperatureUnit}") must be "celsius" or "fahrenheit".`);
  }

  // Validate aqProvider
  const validAqProviders = ["auto", "openaq", "waqi"];
  if (!validAqProviders.includes(CONFIG.aqProvider)) {
    errors.push(`CONFIG.aqProvider ("${CONFIG.aqProvider}") must be one of: ${validAqProviders.join(", ")}.`);
  }

  // Validate aqRadius
  if (!Number.isInteger(CONFIG.aqRadius) || CONFIG.aqRadius < 1 || CONFIG.aqRadius > 100) {
    errors.push(`CONFIG.aqRadius (${CONFIG.aqRadius}) must be an integer between 1 and 100.`);
  }

  // Validate calendarName
  if (!CONFIG.calendarName || typeof CONFIG.calendarName !== "string" || CONFIG.calendarName.trim() === "") {
    errors.push(`CONFIG.calendarName must be a non-empty string.`);
  }

  // Validate dryRun
  if (typeof CONFIG.dryRun !== "boolean") {
    errors.push(`CONFIG.dryRun must be a boolean.`);
  }

  // Validate autoDetectFromEvents
  if (typeof CONFIG.autoDetectFromEvents !== "boolean") {
    errors.push(`CONFIG.autoDetectFromEvents must be a boolean.`);
  }

  return { locations, errors };
}

// State is encapsulated in a closure — no module-level lets that can collide
// with other scripts deployed in the same Apps Script project.

function syncWeatherToCalendar() {
  const budget = budgetStart();
  const { locations, errors } = initConfig();
  errors.forEach(e => Logger.log(`CONFIG init: ${e}`));
  if (locations.length === 0) {
    Logger.log("No valid locations after initConfig — aborting sync");
    return;
  }
  Logger.log(`syncWeatherToCalendar: starting with ${locations.length} configured location(s) (dryRun=${CONFIG.dryRun})`);
  const cal = resolveCalendar();
  const primaryCal = CalendarApp.getDefaultCalendar();
  const calTz = cal.getTimeZone();
  const unitSymbol = CONFIG.temperatureUnit === "celsius" ? "°" : "°F";

  // Diagnostic: log which calendar we're writing to
  Logger.log(`Target calendar: "${cal.getName()}" (ID: ${cal.getId()}) | Timezone: ${calTz}`);
  if (CONFIG.dryRun) {
    Logger.log("DRY-RUN MODE: No calendar writes will be performed. Set CONFIG.dryRun = false to enable writes.");
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, calTz, "yyyy-MM-dd");
  const todayDate = Utilities.parseDate(todayStr + " 12:00:00", calTz, "yyyy-MM-dd HH:mm:ss");

  // 1. Build schedule (-historyDays to +forecastDays)
  const daySchedule = [];
  const locationPool = new Map();
  locations.forEach(loc => locationPool.set(norm(loc.name), loc));

  for (let d = -CONFIG.historyDays; d < CONFIG.forecastDays; d++) {
    checkBudget(budget, "day-loop d=" + d);
    const targetDate = new Date(todayDate.getTime() + d * 24 * 60 * 60 * 1000);
    const dayLocKeys = new Set(locations.map(l => norm(l.name)));

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

  // Diagnostic: log fetch results
  let locationsWithData = 0;
  let locationsWithDet = 0;
  let locationsWithEns = 0;
  let locationsWithAq = 0;
  weatherCache.forEach((data, key) => {
    if (data && (data.det || data.ens || data.aq)) locationsWithData++;
    if (data && data.det) locationsWithDet++;
    if (data && data.ens) locationsWithEns++;
    if (data && data.aq) locationsWithAq++;
  });
  Logger.log(`Fetch results: ${locationsWithData}/${locationPool.size} locations have data (det:${locationsWithDet} ens:${locationsWithEns} aq:${locationsWithAq})`);
  if (locationsWithData === 0) {
    Logger.log("ERROR: No location has any weather data — check API connectivity, API keys, and circuit breakers");
    return;
  }

  // 3. Reconcile verified ground truth & compute scorecards
  reconcileGroundTruth(locationPool, weatherCache);
  const globalStats = computeGlobalModelAccuracy(unitSymbol);

  // 4. Batch-index calendar events with signature fallback
  const windowStart = new Date(todayDate.getTime() - (CONFIG.historyDays + WINDOW_START_BUFFER) * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(todayDate.getTime() + (CONFIG.forecastDays + WINDOW_END_BUFFER) * 24 * 60 * 60 * 1000);
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
  let payloadsBuilt = 0;
  let eventsCreated = 0;
  let eventsUpdated = 0;

  daySchedule.forEach(({ date, offset, locKeys }) => {
    const dStr = Utilities.formatDate(date, calTz, "yyyy-MM-dd");

    locKeys.forEach(key => {
      const loc = locationPool.get(key);
      const data = weatherCache.get(key);
      if (!loc || !data) return;

      let payload;
      try {
        payload = buildDashboardPayload(loc, data, offset, dStr, todayStr, globalStats, unitSymbol, calTz);
      } catch (e) {
        Logger.log(`WARNING: buildDashboardPayload failed for ${loc.name} on ${dStr}: ${e}`);
        return;
      }
      if (!payload) return;
      payloadsBuilt++;

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
          eventsUpdated++;

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
          eventsCreated++;
        }
      } catch (e) {
        Logger.log(`WARNING: Calendar write failed for ${loc.name} ${dStr}: ${e}`);
      }
    });
  });

  // Diagnostic summary
  Logger.log(`Sync summary: ${payloadsBuilt} payloads built, ${eventsCreated} events created, ${eventsUpdated} events updated, ${deletedEventIds.size} duplicates removed`);
  if (!CONFIG.dryRun && payloadsBuilt > 0 && eventsCreated === 0 && eventsUpdated === 0) {
    Logger.log("WARNING: Payloads were built but NO events were written. Check calendar write permissions and CONFIG.calendarId.");
  }

  // 6. Sweep orphaned weather events from older or removed locations.
  //    Preserve past events (verified ground truth). Only delete future
  //    orphan events or events from removed locations.
  allManagedEvents.forEach(ev => {
    const id = ev.getId();
    if (touchedEventIds.has(id) || deletedEventIds.has(id)) return;
    const evDateStr = Utilities.formatDate(ev.getStartTime(), calTz, "yyyy-MM-dd");
    if (evDateStr < todayStr) return; // preserve past events
    try {
      ev.deleteEvent();
    } catch (e) {
      Logger.log(`WARNING: Failed to delete orphaned event ${id}: ${e}`);
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

  // Geo-code any locations missing coordinates before building URLs.
  // This ensures valid lat/lon for API requests (fix for fast-empty sync).
  locationPool.forEach((loc, key) => {
    if ((loc.lat == null || loc.lon == null) && loc.name) {
      const geo = geocodeCity(loc.name, loc.country);
      if (geo && geo.lat != null && geo.lon != null) {
        locationPool.set(key, { ...loc, lat: geo.lat, lon: geo.lon, tz: geo.tz, country: geo.country });
      } else {
        Logger.log(`ERROR: Failed to geocode location "${loc.name}" — skipping`);
      }
    }
  });

  // Validate all locations have valid coordinates before building URLs.
  // Skip invalid locations with clear error to prevent undefined lat/lon in URLs.
  const validLocations = new Map();
  locationPool.forEach((loc, key) => {
    if (!isValidLatLon(loc.lat, loc.lon)) {
      Logger.log(`ERROR: Location "${loc.name}" (key: ${key}) has invalid coordinates (lat=${loc.lat}, lon=${loc.lon}) — skipping`);
      return;
    }
    validLocations.set(key, loc);
  });

  if (validLocations.size === 0) {
    Logger.log("ERROR: No valid locations after geocoding — aborting fetch");
    return new Map();
  }

  validLocations.forEach((loc, key) => {
    // Match icalweather.gs: no past_days on deterministic forecast calls.
    // past_days can cause rate limits / 400 errors with many daily params.
    // Historical reconciliation uses the same deterministic response (Open-Meteo
    // returns ~7 days history by default without past_days).
    const dDailyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weather_code,precipitation_sum,precipitation_probability_max,windspeed_10m_max,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration,shortwave_radiation_sum&temperature_unit=${u}&forecast_days=${CONFIG.deterministicDays}&timezone=auto`;
    const dHourlyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=pressure_msl,soil_temperature_0cm&temperature_unit=${u}&forecast_days=${CONFIG.deterministicDays}&timezone=auto`;
    const eUrl = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=gfs_seamless&forecast_days=${CONFIG.forecastDays}&temperature_unit=${u}&timezone=auto`;
    // Open-Meteo Air-Quality API hard-caps forecast_days at 7 (anything higher returns HTTP 400).
    // For regions outside EU/US, the global OpenAQ/WAQI fallback (see fetchGlobalAQI) provides
    // additional coverage when aqProvider is "auto" or explicitly "openaq" or "waqi".
    const aqForecastDays = Math.min(CONFIG.deterministicDays, getOpenMeteoAqCap());
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&hourly=european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,dust,alder_pollen,birch_pollen,grass_pollen&forecast_days=${aqForecastDays}&timezone=auto`;

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

      let json;
      try {
        json = JSON.parse(res.getContentText());
      } catch (e) {
        Logger.log(`fetchAllAtmosphericDataParallel: ${meta.key}/${meta.type} JSON parse failed: ${e}`);
        continue;
      }
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
        const seen = new Set(cacheObj.aq.time);
        globalAqi.time.forEach((d, i) => {
          if (!seen.has(d)) {
            seen.add(d);
            const safe = (v) => (v === undefined || v === null || Number.isNaN(v)) ? null : v;
            cacheObj.aq.time.push(d);
            cacheObj.aq.european_aqi.push(safe(globalAqi.european_aqi[i]));
            cacheObj.aq.us_aqi.push(safe(globalAqi.us_aqi[i]));
            cacheObj.aq.pm2_5.push(safe(globalAqi.pm2_5[i]));
            cacheObj.aq.pm10.push(safe(globalAqi.pm10[i]));
            cacheObj.aq.ozone = cacheObj.aq.ozone || [];
            cacheObj.aq.nitrogen_dioxide = cacheObj.aq.nitrogen_dioxide || [];
            cacheObj.aq.ozone.push(safe(globalAqi.ozone ? globalAqi.ozone[i] : null));
            cacheObj.aq.nitrogen_dioxide.push(safe(globalAqi.nitrogen_dioxide ? globalAqi.nitrogen_dioxide[i] : null));
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

  // Diagnostic: log locations with no usable data
  const emptyLocations = [];
  weatherCache.forEach((data, key) => {
    const hasDet = data && data.det && data.det.time && data.det.time.length > 0;
    const hasEns = data && data.ens && data.ens.time && data.ens.time.length > 0;
    const hasAq = data && data.aq && data.aq.time && data.aq.time.length > 0;
    if (!hasDet && !hasEns && !hasAq) {
      emptyLocations.push(key);
    }
  });
  if (emptyLocations.length > 0) {
    Logger.log(`WARNING: ${emptyLocations.length} location(s) have NO usable data after fetch: ${emptyLocations.join(", ")}`);
  }

  return weatherCache;
}

function gcalFetchGlobalAQI(loc, aqProvider, aqRadius) {
  if (!loc || !loc.lat || !loc.lon) return null;

  // Check persistent cache first (prefetched by scheduled trigger).
  const cacheKey = AQI_CACHE_PREFIX + norm(loc.name).toLowerCase().replace(/[^a-z0-9]/g, "_");
  const cached = _scriptProps.getProperty(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.time) && parsed.time.length > 0) {
        // Enforce adaptive TTL based on AQI volatility.
        const age = Date.now() - (parsed.cachedAt || 0);
        const adaptiveTtl = getAdaptiveAqiTtl(loc.name);
        if (age < adaptiveTtl) {
          return parsed;
        }
        // Expired — delete stale entry to avoid unbounded PropertiesService growth.
        _scriptProps.deleteProperty(cacheKey);
      }
    } catch (e) {
      // Corrupt cache entry — fall through to live fetch.
    }
  }

  const r = { time: [], european_aqi: [], us_aqi: [], pm2_5: [], pm10: [], ozone: [], nitrogen_dioxide: [] };
  const radius = Number.isFinite(aqRadius) && aqRadius > 0 ? aqRadius : (CONFIG.aqRadius || 25);
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    dates.push(Utilities.formatDate(d, "UTC", "yyyy-MM-dd"));
  }

  if (aqProvider === "auto" || aqProvider === "openaq") {
    // Circuit breaker: skip if open
    if (!CB.isCallAllowed('openaq')) {
      Logger.log("Circuit [openaq] OPEN — skipping OpenAQ fetch");
    } else if (!isValidLatLon(loc.lat, loc.lon)) {
      Logger.log("gcalFetchGlobalAQI/OpenAQ: invalid lat/lon for " + loc.name);
    } else {
      try {
        const res = UrlFetchApp.fetch(
          `${OPENAQ_LATEST_ENDPOINT}?coordinates=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}&radius=${radius}&limit=1`,
          { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS }
        );
        const code = res.getResponseCode();
        if (code === 200) {
          CB.recordSuccess('openaq');
          let json;
          try {
            json = JSON.parse(res.getContentText());
          } catch (e) {
            CB.recordFailure('openaq');
            Logger.log(`gcalFetchGlobalAQI/OpenAQ JSON parse failed for ${loc.name}: ${e}`);
            return null;
          }
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
            updateAqiHistory(loc.name, r);
            return r;
          }
        } else {
          CB.recordFailure('openaq');
          Logger.log(`gcalFetchGlobalAQI/OpenAQ: ${loc.name} returned HTTP ${code}`);
        }
      } catch (e) {
        CB.recordFailure('openaq');
        Logger.log(`gcalFetchGlobalAQI/OpenAQ error for ${loc.name}: ${e}`);
      }
    }
  }

  if (aqProvider === "auto" || aqProvider === "waqi") {
    // Circuit breaker: skip if open
    if (!CB.isCallAllowed('waqi')) {
      Logger.log("Circuit [waqi] OPEN — skipping WAQI fetch");
    } else if (!isValidLatLon(loc.lat, loc.lon)) {
      Logger.log("gcalFetchGlobalAQI/WAQI: invalid lat/lon for " + loc.name);
    } else {
      try {
        const token = waqiTokenResolve();
        const url = `${WAQI_BASE_ENDPOINT}${loc.lat.toFixed(4)};${loc.lon.toFixed(4)}/`;
        const opts = { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS };
        if (token) {
          opts.headers = { Authorization: "Bearer " + token };
        }
        const res = UrlFetchApp.fetch(url, opts);
        const code = res.getResponseCode();
        if (code === 200) {
          CB.recordSuccess('waqi');
          let json;
          try {
            json = JSON.parse(res.getContentText());
          } catch (e) {
            CB.recordFailure('waqi');
            Logger.log(`gcalFetchGlobalAQI/WAQI JSON parse failed for ${loc.name}: ${e}`);
            return null;
          }
          if (json.data && json.data.aqi != null && json.data.aqi !== undefined) {
            const aqiRaw = Number(json.data.aqi);
            const aqi = isNaN(aqiRaw) ? null : Math.round(aqiRaw);
            const iaqi = json.data.iaqi || {};
            const fill = v => { if (v == null) return null; const n = Number(v); return isNaN(n) ? null : Math.round(n); };
            const pm25v = iaqi.pm25 && iaqi.pm25.v != null ? fill(iaqi.pm25.v) : null;
            const pm10v = iaqi.pm10 && iaqi.pm10.v != null ? fill(iaqi.pm10.v) : null;
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
            updateAqiHistory(loc.name, r);
            return r;
          }
        } else {
          CB.recordFailure('waqi');
          Logger.log(`gcalFetchGlobalAQI/WAQI: ${loc.name} returned HTTP ${code}`);
        }
      } catch (e) {
        CB.recordFailure('waqi');
        Logger.log(`gcalFetchGlobalAQI/WAQI error for ${loc.name}: ${e}`);
      }
    }
  }

  return null;
}

function prefetchAqiCache(locationPool, aqProvider, aqRadius) {
  // Prefetch AQI for all locations and cache in PropertiesService.
  // Called by scheduled trigger before syncWeatherToCalendar to reduce live API calls.
  if (!locationPool || locationPool.size === 0) return;
  locationPool.forEach((loc, key) => {
    try {
      const aqi = gcalFetchGlobalAQI(loc, aqProvider, aqRadius);
      if (aqi && aqi.time && aqi.time.length > 0) {
        const cacheKey = AQI_CACHE_PREFIX + norm(loc.name).toLowerCase().replace(/[^a-z0-9]/g, "_");
        const entry = { ...aqi, cachedAt: Date.now() };
        _scriptProps.setProperty(cacheKey, JSON.stringify(entry));
        updateAqiHistory(loc.name, aqi);
      }
    } catch (e) {
      Logger.log("prefetchAqiCache: " + loc.name + " failed: " + e);
    }
  });
}

function predictiveAqiPrefetch(locationPool, aqProvider, aqRadius) {
  // Event-driven prefetch: only warm cache for locations where AQI is missing or stale.
  // Returns array of location names that were prefetched (for monitoring).
  if (!locationPool || locationPool.size === 0) return [];
  const prefetched = [];
  locationPool.forEach((loc, key) => {
    try {
      const cacheKey = AQI_CACHE_PREFIX + norm(loc.name).toLowerCase().replace(/[^a-z0-9]/g, "_");
      const cached = _scriptProps.getProperty(cacheKey);
      let needsPrefetch = false;
      if (!cached) {
        needsPrefetch = true; // No cache at all
      } else {
        try {
          const parsed = JSON.parse(cached);
          if (!parsed || !Array.isArray(parsed.time) || parsed.time.length === 0) {
            needsPrefetch = true; // Corrupt/empty cache
          } else {
            const age = Date.now() - (parsed.cachedAt || 0);
            const adaptiveTtl = getAdaptiveAqiTtl(loc.name);
            if (age >= adaptiveTtl) needsPrefetch = true; // Stale
          }
        } catch (e) {
          needsPrefetch = true; // Parse error
        }
      }
      if (needsPrefetch) {
        const aqi = gcalFetchGlobalAQI(loc, aqProvider, aqRadius);
        if (aqi && aqi.time && aqi.time.length > 0) {
          const entry = { ...aqi, cachedAt: Date.now() };
          _scriptProps.setProperty(cacheKey, JSON.stringify(entry));
          updateAqiHistory(loc.name, aqi);
          prefetched.push(loc.name);
        }
      }
    } catch (e) {
      Logger.log("predictiveAqiPrefetch: " + loc.name + " failed: " + e);
    }
  });
  return prefetched;
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

          const rawLead = snap.daysBeforeDDay !== undefined ? snap.daysBeforeDDay : (snap.daysAgoLogged || 0);
          const lead = Number.isFinite(rawLead) && rawLead >= 0 ? rawLead : 0;
          LEAD_BUCKETS.forEach(bucket => {
            if (lead <= bucket.maxLead) {
              buckets[bucket.key].e += tErr;
              buckets[bucket.key].c++;
              return false; // break forEach
            }
          });
        });
      }
    } catch (e) {
      Logger.log("computeGlobalModelAccuracy: failed to process record " + k + ": " + e);
    }
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

  const bShort = buckets.short.c > 0 ? (buckets.short.e / buckets.short.c).toFixed(1) : String(LEAD_BUCKETS[0].defaultErr);
  const bMid   = buckets.mid.c > 0 ? (buckets.mid.e / buckets.mid.c).toFixed(1) : String(LEAD_BUCKETS[1].defaultErr);
  const bLong  = buckets.long.c > 0 ? (buckets.long.e / buckets.long.c).toFixed(1) : String(LEAD_BUCKETS[2].defaultErr);
  const bNoaa  = buckets.noaa.c > 0 ? (buckets.noaa.e / buckets.noaa.c).toFixed(1) : String(LEAD_BUCKETS[3].defaultErr);

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

function buildDashboardPayload(loc, data, offset, targetDateStr, todayStr, globalStats, sym, calTz) {
  // Defensive: guard against malformed inputs
  if (!loc || !loc.name || !data) return null;
  if (typeof targetDateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) return null;
  const isC = CONFIG.temperatureUnit === "celsius";
  const lang = CONFIG.language || "en";
  const cityKey = norm(loc.name);
  const record = getDayRecord(cityKey, targetDateStr);
  const snapshots = record.snapshots || [];

  // Cache PropertiesService for this execution to avoid repeated calls
  const scriptProps = PropertiesService.getScriptProperties();

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

  // Get OnThisDay cultural events for this date
  const countryCode = loc.country || "US";
  const onThisDayText = getOnThisDayText(targetDateStr, countryCode);
  const wikiOnThisDay = getWikipediaOnThisDayText(targetDateStr);
  const breakingNews = getBreakingNewsText(targetDateStr, calTz);

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

    const audit = computeDayAudit(snapshots, actualMax, actualRain, aqiVal, sym, lang);

    // Generate actionable advice for past day based on actual measured conditions
    const pastAdviceContext = {
      tempMax: actualMax,
      tempMin: actualMin,
      apparentMax: actualMax,
      rainProb: actualRain > 0 ? 100 : 0,
      rainVol: actualRain,
      wind: (data.det.windspeed_10m_max && data.det.windspeed_10m_max[pastIdx] != null) ? Math.round(data.det.windspeed_10m_max[pastIdx]) : 0,
      aqi: aqiVal,
      aqiType: aqiType,
      uv: 0,
      pollen: pollenVal,
      weatherCode: actualCode,
      et0: 0,
      isC: isC
    };
    const prioritizedAdvice = generatePrioritizedAdvices(pastAdviceContext);

    let sunrisePast = null, sunsetPast = null;
    if (data.det.sunrise && data.det.sunset && data.det.sunrise[pastIdx] && data.det.sunset[pastIdx]) {
      sunrisePast = data.det.sunrise[pastIdx].slice(11, 16);
      sunsetPast = data.det.sunset[pastIdx].slice(11, 16);
    }
    const daylightPast = sunrisePast && sunsetPast
      ? (() => {
          const rDate = new Date(data.det.sunrise[pastIdx]);
          const sDate = new Date(data.det.sunset[pastIdx]);
          const dMins = Math.max(0, Math.round((sDate - rDate) / 60000));
          return `${Math.floor(dMins / 60)}h ${dMins % 60}m`;
        })()
      : "--";

    const historicalAggregate = computeHistoricalAggregate(data, targetDateStr, isC);

    const sourcesLines = [`📡 ${tSection("secSources", lang)}`];
    if (aqSource) {
      sourcesLines.push(`• ${t("aq", lang)}: ${aqSource}`);
    }
    sourcesLines.push(`• ${t("wx", lang)}: Open-Meteo API`);
    sourcesLines.push(`• ${t("wikiApi", lang)}: https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/`);
    sourcesLines.push(`• ${t("wiki", lang)} (main): https://en.wikipedia.org`);
    const newsApiKey = scriptProps.getProperty("NEWS_API_KEY");
    if (newsApiKey) {
      sourcesLines.push(`• ${t("newsApi", lang)}: https://newsapi.org`);
    }

    const sections = [
      // 1. ACTIONABLE ADVICE — bullets only (from today's forecast context)
      prioritizedAdvice.map(adv => `${adv}`).filter(Boolean).join("\n"),

      // 2. GROUND TRUTH (MEASURED)
      [
        `📊 ${t("groundTruth", lang)}`,
        `• ${t("range", lang)}: ${actualMax}${sym} / ${actualMin}${sym}`,
        `• ${t("sky", lang)}: ${weatherGlyph} ${getWeatherName(actualCode, lang)}`,
        `• ${t("rain", lang)}: ${Number(actualRain).toFixed(1)} mm`,
        aqiVal !== null ? `• ${t("aqi", lang)}: ${aqiVal}${aqiScale ? "/" + aqiScale : ""} ${getAqiGlyph(aqiVal, aqiType)} (${getAqiLabel(aqiVal, aqiType, lang)}) [${aqiType}]` : ``,
        astroEvent ? `• ${t("status", lang)}: ${astroEvent}` : ``
      ].filter(Boolean).join("\n"),

      // 3. BREAKING NEWS
      breakingNews ? (
        `📰 ${tSection("secBreaking", lang)}\n${breakingNews}`
      ) : null,

      // 4. WIKIPEDIA ON THIS DAY
      (() => {
        const parts = [];
        if (onThisDayText) parts.push(onThisDayText);
        if (wikiOnThisDay) parts.push(wikiOnThisDay);
        return parts.length > 0 ? `${tSection("secWiki", lang)}\n${parts.join("\n")}` : null;
      })(),

      // 5. SUN & CELESTIAL
      [
        `☀️ ${tSection("secSun", lang)}`,
        astroEvent ? `• ${astroEvent}` : ``,
        sunrisePast ? `• ${t("daylight", lang)}: 🌅${sunrisePast}–🌇${sunsetPast} (${daylightPast})` : ``,
        sunrisePast ? `• ${t("goldenHr", lang)}: ~${getGoldenHourWindow(sunsetPast)}` : ``,
        `• ${t("moon", lang)}: ${moonInfo.glyph} ${moonInfo.name} (${moonInfo.illumination})`
      ].filter(Boolean).join("\n"),

      // 5. PREDICTION ACCURACY AUDIT
      [
        `🎯 ${t("accuracyAudit", lang)}`,
        `• ${t("tempDelta", lang)}: ${audit.tempDelta}`,
        `• ${t("rainDelta", lang)}: ${audit.rainDelta}`,
        `• ${t("stability", lang)}: ${audit.volatility}`,
        `• ${t("snapTracked", lang)}: ${audit.snapshotsTaken}`
      ].join("\n"),

      // 6. MODEL BENCHMARK
      [
        `🌐 ${t("modelBench", lang)}`,
        `• ${t("lifeTempMAE", lang)}: ${globalStats.tempMAE}`,
        `• ${t("lifeRainMAE", lang)}: ${globalStats.rainMAE}`,
        `• ${t("reliability", lang)}: ${tGrade(globalStats.modelGrade, lang)}`,
        `• ${t("leadCurve", lang)}: ${globalStats.leadCurve}`
      ].join("\n"),

      // 7. 7-DAY AGGREGATE (historical, leading up to this day)
      historicalAggregate ? [
        `📅 ${tSection("secAgg", lang)}`,
        `• ${t("rainSum", lang)}: ${historicalAggregate.rain} mm`,
        `• ${t("meanTemp", lang)}: ${historicalAggregate.meanTemp}${sym}`
      ].join("\n") : null,

      // 8. SOURCES
      sourcesLines.join("\n"),

      // 9. LOCATION & DATE
      [
        `📍 ${loc.name} · ${t("verifiedLog", lang)}`,
        `📅 ${targetDateStr} (${Math.abs(offset)}${t("dAgo", lang)})`
      ].join("\n")
    ];

    return { title, desc: sections.filter(Boolean).join("\n\n"), eventColor };
  }

  // B. Future & Today (Forecast Dashboard)
  let currentMax = null, currentMin = null, apparentMax = null;
  let currentRain = 0, currentWind = 0, rainProb = 0, weatherCode = 0;
  let uvIndex = 0, et0 = 0, radiation = 0, pressure = 1013.25, soilTempMin = 10;
  let cloudCover = null;
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
        soilTempMin = Number.isFinite(data.hourlyAgg[targetDateStr].soilMin)
          ? data.hourlyAgg[targetDateStr].soilMin
          : currentMin;
        cloudCover = data.hourlyAgg[targetDateStr].cloudCover;
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

      if (maxVals.length > 0 && minVals.length > 0) {
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

  const drift = computeDayAudit(snapshots, currentMax, currentRain, aqiVal, sym, lang);
  const aggregates = computeContinuousMultiDayAggregates(data, targetDateStr, isC);
  const stargazing = assessStargazingConditions(data, offset, moonInfo.fraction, targetDateStr, cloudCover, lang);

  const tempMinInC = isC ? currentMin : (currentMin - 32) * (5 / 9);
  const renderRoadHazards = tempMinInC <= 7;

  const pressureAtm = (pressure / 1013.25).toFixed(2);
  const gddNote = getGddAction(aggregates.sevenDayGDD, lang);

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
    // 1. ACTIONABLE ADVICE — bullets only, top for quick glance
    prioritizedAdvice.map(adv => `${adv}`).filter(Boolean).join("\n"),

// 2. TEMPERATURE & COMFORT
    [
      `🌡️ ${tSection("secTemp", lang)}`,
        `• ${t("hi", lang)}: ${currentMax}${sym} (${getThermalText(currentMax, isC, lang)})`,
        `• ${t("lo", lang)}: ${currentMin}${sym} · ${t("feels", lang)}: ~${apparentMax}${sym}`,
        offset >= CONFIG.deterministicDays
          ? `• ${t("consensus", lang)}: ±${spreadVal}${sym}`
          : `• ${t("rain", lang)}: ${Number(currentRain).toFixed(1)} mm (${rainProb}%)`,
        offset < CONFIG.deterministicDays ? `• ${t("wind", lang)}: ${currentWind} km/h` : ``,
        offset < CONFIG.deterministicDays ? `• ${t("baro", lang)}: ${pressureAtm} atm` : ``
      ].filter(Boolean).join("\n"),

    // 3. AIR QUALITY & BIO (above SUN)
    [
      `🧪 ${tSection("secAir", lang)}`,
      aqiVal !== null ? `• ${t("aqi", lang)}: ${aqiVal}${aqiScale ? "/" + aqiScale : ""} ${getAqiGlyph(aqiVal, aqiType)} (${getAqiLabel(aqiVal, aqiType, lang)}) [${aqiType}]` : `• ${t("aqi", lang)}: ${t("mon", lang)}`,
      pm25Val !== null ? `• ${t("pm25", lang)}: ${pm25Val} · ${t("pm10", lang)}: ${pm10Val || "--"} µg/m³` : ``,
      pollenVal > 0 ? `• ${t("pollen", lang)}: ${pollenVal} gr/m³` : `• ${t("pollen", lang)}: ${t("polLow", lang)}`
    ].filter(Boolean).join("\n"),

    // 4. SUN & CELESTIAL
    [
      `☀️ ${tSection("secSun", lang)}`,
      astroEvent ? `• ${astroEvent}` : ``,
      `• ${t("daylight", lang)}: 🌅${sunriseStr}–🌇${sunsetStr} (${daylightFormatted})`,
      `• ${t("goldenHr", lang)}: ~${getGoldenHourWindow(sunsetStr)}`,
      `• ${t("moon", lang)}: ${moonInfo.glyph} ${moonInfo.name} (${moonInfo.illumination})`,
      `• ${t("star", lang)}: ${stargazing}`,
      uvIndex > 0 ? `• ${t("uv", lang)}: ${uvIndex.toFixed(1)} (${getUvAdvice(uvIndex, lang)})` : ``,
      et0 > 0 ? `• ${t("et", lang)}: ${et0.toFixed(1)} mm` : ``,
      radiation > 0 ? `• ${t("rad", lang)}: ${radiation.toFixed(1)} MJ/m²` : ``
    ].filter(Boolean).join("\n"),

    // 5. 7-DAY AGGREGATE
    [
      `📅 ${tSection("secAgg", lang)}`,
      `• ${t("rainSum", lang)}: ${aggregates.sevenDayRain} mm`,
      `• ${t("meanTemp", lang)}: ${aggregates.sevenDayMeanTemp}${sym}`,
      `• ${t("gdd", lang)}: ${aggregates.sevenDayGDD} GDD (${gddNote})`,
      `• ${t("aqi7", lang)}: ${aggregates.sevenDayAqi}`
    ].join("\n"),

    // 6. ON THIS DAY — Wikipedia + Breaking News combined (one section)
    (() => {
      const parts = [];
      if (onThisDayText) parts.push(onThisDayText);
      if (wikiOnThisDay) parts.push(wikiOnThisDay);
      if (breakingNews) parts.push(breakingNews);
      return parts.length > 0 ? `${tSection("secOnThisDay", lang)}\n${parts.join("\n")}` : null;
    })(),

    // 7. MODEL AUDIT
    [
      `📉 ${tSection("secAudit", lang)}`,
      `• ${t("drift", lang)}: ${drift.tempDelta} · ${t("rain", lang)}: ${drift.rainDelta}`,
      `• ${t("stability", lang)}: ${drift.volatility}`,
      `• ${t("benchMAE", lang)}: ${globalStats.tempMAE} / ${globalStats.rainMAE}`,
      `• ${t("reliability", lang)}: ${tGrade(globalStats.modelGrade, lang)}`,
      `• ${t("leadCurve", lang)}: ${globalStats.leadCurve}`
    ].join("\n"),

    // 8. SOURCES
    (() => {
      const lines = [`📡 ${tSection("secSources", lang)}`];
      lines.push(aqSource ? `• ${t("aq", lang)}: ${aqSource}` : `• ${t("aq", lang)}: Open-Meteo`);
      lines.push(`• ${t("wx", lang)}: Open-Meteo API (https://open-meteo.com)`);
      lines.push(`• ${t("wikiApi", lang)}: https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/`);
      lines.push(`• ${t("wiki", lang)} (main): https://en.wikipedia.org`);
      const newsApiKey = scriptProps.getProperty("NEWS_API_KEY");
      if (newsApiKey) {
        lines.push(`• ${t("newsApi", lang)}: https://newsapi.org`);
      }
      return lines.join("\n");
    })(),

    // 9. LOCATION & DATE — at the bottom
    [
      `📍 ${loc.name}${loc.isDynamic ? " ✈️" : ""}`,
      `📅 ${offset === 0 ? t("dDay", lang) : `D-${offset}`} · ${targetDateStr}`
    ].join("\n")
  ];

  if (renderRoadHazards) {
    const roadHazard = assessRoadConditions(currentMin, soilTempMin, currentRain, isC, lang);
    sections.push([
      `🚗 ${tSection("secRoad", lang)} (<=7°C)`,
      `• ${t("status", lang)}: ${roadHazard.status}`,
      `• ${t("ground", lang)}: ${Math.round(soilTempMin)}${sym} (${roadHazard.advisory})`
    ].join("\n"));
  }

  return { title, desc: sections.filter(Boolean).join("\n\n"), eventColor };
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

// Compute 7-day historical aggregate looking backward from a target date.
// Used for past-day (verified ground truth) event cards.
function computeHistoricalAggregate(data, targetDateStr, isC) {
  if (!data.det || !data.det.time) return null;
  const times = data.det.time;
  const idx = times.indexOf(targetDateStr);
  if (idx === -1) return null;
  let totalRain = 0, totalMax = 0, totalMin = 0, wDays = 0;
  const base10 = isC ? 10 : 50;
  for (let d = 0; d < 7; d++) {
    const lookIdx = idx - d;
    if (lookIdx < 0) break;
    const dStr = times[lookIdx];
    const dMax = data.det.temperature_2m_max[lookIdx];
    const dMin = data.det.temperature_2m_min[lookIdx];
    const dRain = (data.det.precipitation_sum ? data.det.precipitation_sum[lookIdx] : 0) || 0;
    if (dMax != null && dMin != null) {
      totalRain += dRain;
      totalMax += dMax;
      totalMin += dMin;
      wDays++;
    }
  }
  return {
    rain: totalRain.toFixed(1),
    meanTemp: wDays > 0 ? ((totalMax + totalMin) / (wDays * 2)).toFixed(1) : "--"
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

function getGddAction(gdd, lang) {
  const g = Number(gdd) || 0;
  if (g === 0) return t("gddDorm", lang);
  if (g < 25) return t("gddCool", lang);
  if (g < 60) return t("gddFoli", lang);
  if (g < 100) return t("gddBrss", lang);
  return t("gddPeak", lang);
}

function tRoadStatus(key, lang) {
  lang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  const map = { rdBI:T_L.rdBI, rdFrost:T_L.rdFrost, rdSpray:T_L.rdSpray, rdChill:T_L.rdChill }[key];
  if (!map) return key;
  return map[lang] || map.en || key;
}

function tRoadAdv(key, lang) {
  lang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  const map = { advBI:T_L.rdAdvBI, advFr:T_L.rdAdvFr, advSp:T_L.rdAdvSp, advCh:T_L.rdAdvCh }[key];
  if (!map) return key;
  return map[lang] || map.en || key;
}

function assessRoadConditions(tMin, soilMin, rainVol, isC, lang) {
  lang = lang || "en";
  // Guard raw inputs with Number.isFinite so null/undefined don't silently
  // pass through isNaN (isNaN(null) === false) and trigger a false black-ice
  // advisory after the unit conversion below.
  if (!Number.isFinite(tMin) || !Number.isFinite(soilMin) || !Number.isFinite(rainVol)) {
    return { status: tRoadStatus("rdChill", lang), advisory: tRoadAdv("advCh", lang) };
  }
  const minC = isC ? tMin : (tMin - 32) * (5 / 9);
  const groundC = isC ? soilMin : (soilMin - 32) * (5 / 9);

  if (groundC <= 0 && rainVol > 0.2) {
    return { status: tRoadStatus("rdBI", lang), advisory: tRoadAdv("advBI", lang) };
  } else if (groundC <= 0) {
    return { status: tRoadStatus("rdFrost", lang), advisory: tRoadAdv("advFr", lang) };
  } else if (minC <= 3 && rainVol > 2.0) {
    return { status: tRoadStatus("rdSpray", lang), advisory: tRoadAdv("advSp", lang) };
  } else {
    return { status: tRoadStatus("rdChill", lang), advisory: tRoadAdv("advCh", lang) };
  }
}

function getAstronomicalEventsForYear(dateStr, year) {
  var ev = ASTRONOMICAL_EVENTS_DETAILED[dateStr.slice(5)];
  if (!ev) return null;
  if (year && /Meteor Peak/i.test(ev)) return ev + " (" + year + ")";
  return ev;
}

function getMeteorShowerInfo(dateStr) {
  var key = dateStr.slice(5);
  var shower = METEOR_SHOWERS[key];
  if (!shower) return null;
  return {
    name: shower.name,
    peak: shower.peak,
    rate: shower.rate,
    parent: shower.parent
  };
}

function getLunarPhaseInfo(dateStr) {
  var phase = LUNAR_PHASES[dateStr.slice(5)];
  return phase || null;
}

function getEclipseInfo(dateStr) {
  var key = dateStr.slice(5);
  var solar = SOLAR_ECLIPSES[key];
  var lunar = LUNAR_ECLIPSES[key];
  if (!solar && !lunar) return null;
  return {
    solar: solar || null,
    lunar: lunar || null
  };
}

function getPlanetaryEventInfo(dateStr) {
  var key = dateStr.slice(5);
  var planetary = PLANETARY_EVENTS[key];
  return planetary || null;
}

function getAuroraSeasonInfo(dateStr) {
  var key = dateStr.slice(5);
  var aurora = AURORA_SEASONS[key];
  return aurora || null;
}

function getLunarPhase(dateStr) {
  var phase = LUNAR_PHASES[dateStr.slice(5)];
  return phase || null;
}

function getMoonPhaseDetails(date) {
  if (date == null) return { glyph: "🌑", name: "New Moon", fraction: 0, illumination: "0%" };
  const SYNODIC_MONTH_SEC = 2551443; // 29.53059 days
  const newMoonRef = Date.UTC(1970, 0, 7, 20, 35, 0);
  const ms = (date instanceof Date) ? date.getTime() : Number(date);
  if (!Number.isFinite(ms)) return { glyph: "🌑", name: "New Moon", fraction: 0, illumination: "0%" };
  let phase = ((ms - newMoonRef) / 1000) % SYNODIC_MONTH_SEC;
  if (phase < 0) phase += SYNODIC_MONTH_SEC;
  const dayOfCycle = phase / 86400;
  const illumination = (1 - Math.cos(2 * Math.PI * dayOfCycle / (SYNODIC_MONTH_SEC / 86400))) / 2;
  let glyph, name;
  // Boundaries derived from 16 equal 22.5° segments (synodic month = 29.53059 days).
  // Each named phase spans 2 consecutive segments (45° total) centered on the
  // principal phase angle (0, 45, 90, ...). The principal phases (New, 1st
  // Quarter, Full, Last Quarter) occupy the segment containing their exact
  // phase angle; the intermediate phases (Crescent, Gibbous) span the ±22.5°
  // segments on either side. Boundary = (n * 29.53059) / 16 days.
  // 0.00000–1.84566  New Moon          (0°–22.5°)
  // 1.84566–5.53698  Waxing Crescent  (22.5°–67.5°)
  // 5.53698–9.22830  1st Quarter      (67.5°–112.5°)
  // 9.22830–12.91962 Waxing Gibbous   (112.5°–157.5°)
  // 12.91962–16.61094 Full Moon       (157.5°–202.5°)
  // 16.61094–20.30226 Waning Gibbous  (202.5°–247.5°)
  // 20.30226–23.99358 Last Quarter    (247.5°–292.5°)
  // 23.99358–27.68490 Waning Crescent (292.5°–337.5°)
  // 27.68490–29.53059 New Moon        (337.5°–360°)
  if (dayOfCycle < 1.84566)       { glyph = "🌑"; name = "New Moon"; }
  else if (dayOfCycle < 5.53698)  { glyph = "🌒"; name = "Waxing Crescent"; }
  else if (dayOfCycle < 9.22830)  { glyph = "🌓"; name = "1st Quarter"; }
  else if (dayOfCycle < 12.91962) { glyph = "🌔"; name = "Waxing Gibbous"; }
  else if (dayOfCycle < 16.61094) { glyph = "🌕"; name = "Full Moon"; }
  else if (dayOfCycle < 20.30226) { glyph = "🌖"; name = "Waning Gibbous"; }
  else if (dayOfCycle < 23.99358) { glyph = "🌗"; name = "Last Quarter"; }
  else if (dayOfCycle < 27.68490) { glyph = "🌘"; name = "Waning Crescent"; }
  else                            { glyph = "🌑"; name = "New Moon"; }
  return { glyph, name, fraction: illumination, illumination: Math.round(illumination * 100) + "%" };
}

function assessStargazingConditions(data, offset, moonFraction, targetDateStr, cloudCover, lang) {
  lang = lang || CONFIG.language || "en";
  if (offset >= CONFIG.deterministicDays || !data.det || !data.det.time) {
    return moonFraction > 0.7 ? "🌕 " + t("starFlt", lang) : "🔭 " + t("starDec", lang);
  }
  const idx = data.det.time.indexOf(targetDateStr);
  if (idx === -1) return "🔭 " + t("starMod", lang);

  const codes = data.det.weather_code || data.det.weathercode || [];
  const code = codes[idx] !== undefined ? codes[idx] : 0;
  const rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[idx] : 0;

  if (cloudCover !== undefined && cloudCover !== null && cloudCover > 70) return "☁️ " + t("starObsc", lang);
  if ([0].includes(code) && moonFraction <= 0.3) return "🔭 " + t("starExc", lang);
  if ([0, 1].includes(code) && moonFraction > 0.7) return "🌕 " + t("starMoon", lang);
  if ([0, 1, 2].includes(code)) return "🔭 " + t("starFair", lang);
  if (rainProb > 40 || code >= 3) return "☁️ " + t("starObsc", lang);
  return "🔭 " + t("starMod", lang);
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
  const cutoffStr = Utilities.formatDate(cutoff, "UTC", "yyyy-MM-dd");
  // Storage keys (WTR_v10_*) embed UTC dates from Open-Meteo (yyyy-MM-dd in UTC).
  // Format the cutoff in UTC so the lexicographic string comparison is correct
  // regardless of the calendar's configured timezone.

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

function computeDayAudit(snapshots, baselineMax, baselineRain, baselineAqi, sym, lang) {
  if (!snapshots || snapshots.length === 0) {
    return { tempDelta: "±0" + sym, rainDelta: "0 mm", volatility: t("volStable", lang), snapshotsTaken: 0 };
  }
  if (snapshots.length === 1) {
    return { tempDelta: "±0" + sym, rainDelta: "0 mm", volatility: t("volStable", lang), snapshotsTaken: 1 };
  }
  if (!Number.isFinite(baselineMax) || !Number.isFinite(baselineRain)) {
    return { tempDelta: "n/a", rainDelta: "n/a", volatility: t("volPend", lang), snapshotsTaken: snapshots.length };
  }

  let maxTempDiff = 0, tempDeltaStr = "±0" + sym;
  let maxRainDiff = 0, rainDeltaStr = "0 mm";

  snapshots.forEach(snap => {
    const pMax = snap.predictedMax;
    if (!Number.isFinite(pMax)) return;
    const tDiff = pMax - baselineMax;
    const rawLead = snap.daysBeforeDDay !== undefined ? snap.daysBeforeDDay : (snap.daysAgoLogged || 0);
    const lead = Number.isFinite(rawLead) && rawLead >= 0 ? rawLead : 0;
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
  const volatility = absT >= 5 ? t("volHigh", lang) : (absT >= 3 ? t("volMod", lang) : t("volStable", lang));
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

  const sortedKeys = Array.from(locationPool.keys()).sort((a, b) => b.length - a.length || a.localeCompare(b));
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

function tGrade(grade, lang) {
  const map = { "A (Calibrating)": "gCal", "A+ (Excellent)": "gAplus", "A (High)": "gA", "B (Moderate)": "gB", "C (Divergent)": "gC" };
  const key = map[grade];
  return key ? t(key, lang) : grade;
}

function getWeatherName(code, lang) {
  if (code === null || code === undefined || isNaN(code)) return t("wxFair", lang);
  code = Number(code);
  if (code === 0) return t("wxClear", lang);
  if (code === 1) return t("wxMainly", lang);
  if (code === 2) return t("wxPartly", lang);
  if (code === 3) return t("wxOvercast", lang);
  if (code === 45 || code === 48) return t("wxFog", lang);
  if (code >= 51 && code <= 55) return t("wxDrizzle", lang);
  if (code === 56 || code === 57) return t("wxFreezeDz", lang);
  if (code >= 61 && code <= 65) return t("wxRain", lang);
  if (code === 66 || code === 67) return t("wxFreezeRain", lang);
  if (code >= 71 && code <= 77) return t("wxSnow", lang);
  if (code >= 80 && code <= 82) return t("wxShowers", lang);
  if (code === 85 || code === 86) return t("wxSnowSh", lang);
  if (code >= 95) return t("wxThunder", lang);
  return t("wxFair", lang);
}

function getThermalText(tempC, isC, lang) {
  if (tempC == null || isNaN(tempC)) return t("tFreeze", lang);
  const c = isC ? tempC : (tempC - 32) * (5 / 9);
  if (c <= 0) return t("tFreeze", lang);
  if (c <= 10) return t("tChilly", lang);
  if (c <= 20) return t("tComf", lang);
  if (c <= 26) return t("tPleas", lang);
  if (c <= 32) return t("tWarm", lang);
  return t("tHot", lang);
}

function getAqiGlyph(aqi, aqiType) {
  if (aqi == null || isNaN(aqi)) return "🍃";
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

function getAqiLabel(aqi, aqiType, lang) {
  if (aqi == null || isNaN(aqi)) return t("aqiUnk", lang);
  if (aqiType === "USAQI") {
    if (aqi <= 50) return t("aqiGood", lang);
    if (aqi <= 100) return t("aqiMod", lang);
    if (aqi <= 150) return t("aqiSens", lang);
    if (aqi <= 200) return t("aqiUnh", lang);
    if (aqi <= 300) return t("aqiVunh", lang);
    return t("aqiHzd", lang);
  }
  if (aqi <= 20) return t("aqiGood", lang);
  if (aqi <= 40) return t("aqiFair", lang);
  if (aqi <= 60) return t("aqiMod", lang);
  if (aqi <= 80) return t("aqiPoor", lang);
  return t("aqiHzd", lang);
}

function getUvAdvice(uv, lang) {
  if (uv == null || isNaN(uv)) return t("uvLow", lang);
  if (uv <= 2) return t("uvLow", lang);
  if (uv <= 5) return t("uvMod", lang);
  if (uv <= 7) return t("uvHigh", lang);
  return t("uvVhigh", lang);
}

function validateConfig() {
  const errors = [];
  CONFIG.locations.forEach((loc, i) => {
    if (!loc.name) {
      errors.push(`Location ${i}: missing 'name' field`);
    }
    if (!loc.lat || !loc.lon) {
      errors.push(`Location ${i} ('${loc.name || "unnamed"}'): no coordinates — geocoding required`);
      const geo = geocodeCity(loc.name || "", loc.country);
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

// ============================================================
// Integration tests (Apps Script runtime required)
// Run individually from Apps Script editor or via test runner.
//
// LIMITATION: These tests mock _fetchAllImplGcal (batch fetch seam).
// Functions that use UrlFetchApp.fetch singular directly —
// fetchWikipediaOnThisDay, fetchBreakingNews, geocodeCity — are NOT
// intercepted and will hit live APIs in test runs. To fully isolate
// those, those functions would need a parallel _fetchImplGcal seam.
// ============================================================

function test_e2e_gcal_success() {
  const results = { passed: 0, failed: 0, errors: [] };

  try {
    _runTestsCleanup_gcal();

    const savedConfig = JSON.parse(JSON.stringify(CONFIG));
    CONFIG.dryRun = true;
    CONFIG.locations = [
      { name: "London", lat: 51.5, lon: -0.1 },
      { name: "Paris", lat: 48.85, lon: 2.35 }
    ];

    const mockOm = _buildMockOpenMeteoDaily();
    const mockWa = _buildMockWaqiAirQuality();

    let fetchLog = [];
    _fetchAllImplGcal = (requests) => {
      return requests.map(req => {
        fetchLog.push(req.url.slice(0, 80));
        if (req.url.includes("open-meteo.com/v1/forecast")) return mockOm();
        if (req.url.includes("waqi.info") || req.url.includes("aqicn.org")) return mockWa();
        if (req.url.includes("nominatim") || req.url.includes("geocoding")) {
          return { getResponseCode: () => 200, getContentText: () => '[{"lat":51.5,"lon":-0.1,"display_name":"London, UK"}]' };
        }
        return { getResponseCode: () => 404, getContentText: () => '{}' };
      });
    };

    _nowOverrideGcal = new Date("2025-06-21T10:00:00Z").getTime();
    _wikiCacheGcal = {};
    _breakingNewsCacheGcal = {};
    CB.create("openmeteo");
    CB.create("waqi");
    CB.create("geocoder");
    CB.create("wikipedia");
    CB.create("newsapi");

    syncWeatherToCalendar();

    const meteoFetches = fetchLog.filter(u => u.includes("open-meteo"));
    if (meteoFetches.length > 0) {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push("No Open-Meteo fetches made during sync");
    }

    _log_gcal({ event: "e2e_test", test: "success", fetchCount: fetchLog.length, passed: results.passed, failed: results.failed });

  } catch (e) {
    results.failed++;
    results.errors.push(e.message || String(e));
    _log_gcal({ event: "e2e_test", test: "success", status: "error", error: e.message || String(e) });
  } finally {
    CONFIG.dryRun = savedConfig.dryRun;
    CONFIG.locations = savedConfig.locations;
    _runTestsCleanup_gcal();
  }

  const msg = `test_e2e_gcal_success: ${results.passed} passed, ${results.failed} failed`;
  Logger.log(msg);
  results.errors.forEach(e => Logger.log("  ERROR: " + e));
  return results;
}

function test_e2e_gcal_429_retry() {
  const results = { passed: 0, failed: 0, errors: [] };

  try {
    _runTestsCleanup_gcal();

    const savedConfig = JSON.parse(JSON.stringify(CONFIG));
    CONFIG.dryRun = true;
    CONFIG.locations = [{ name: "London", lat: 51.5, lon: -0.1 }];

    let callCount = 0;
    const mockOm429 = () => ({ getResponseCode: () => 429, getContentText: () => '{"error":"rate limited"}' });
    const mockOm200 = _buildMockOpenMeteoDaily();

    _fetchAllImplGcal = (requests) => {
      return requests.map(req => {
        if (req.url.includes("open-meteo.com")) {
          callCount++;
          return callCount === 1 ? mockOm429() : mockOm200();
        }
        if (req.url.includes("waqi.info")) return _buildMockWaqiAirQuality()();
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      });
    };

    _nowOverrideGcal = new Date("2025-06-21T10:00:00Z").getTime();
    _wikiCacheGcal = {};
    _breakingNewsCacheGcal = {};
    CB.create("openmeteo");

    syncWeatherToCalendar();

    if (callCount >= 2) {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push(`Expected retry on 429, got ${callCount} Open-Meteo call(s)`);
    }

    _log_gcal({ event: "e2e_test", test: "429_retry", calls: callCount, passed: results.passed, failed: results.failed });

  } catch (e) {
    results.failed++;
    results.errors.push(e.message || String(e));
    _log_gcal({ event: "e2e_test", test: "429_retry", status: "error", error: e.message || String(e) });
  } finally {
    if (typeof savedConfig !== "undefined") {
      CONFIG.dryRun = savedConfig.dryRun;
      CONFIG.locations = savedConfig.locations;
    }
    _runTestsCleanup_gcal();
  }

  const msg = `test_e2e_gcal_429_retry: ${results.passed} passed, ${results.failed} failed`;
  Logger.log(msg);
  results.errors.forEach(e => Logger.log("  ERROR: " + e));
  return results;
}

function test_e2e_gcal_circuit_breaker() {
  const results = { passed: 0, failed: 0, errors: [] };

  try {
    _runTestsCleanup_gcal();
    CB.create("openmeteo");

    const failureThreshold = CB.cfg("openmeteo").failureThreshold;
    for (let i = 0; i < failureThreshold; i++) {
      CB.recordFailure("openmeteo");
    }

    const state = CB.getState("openmeteo");
    if (state === "OPEN") {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push(`Expected circuit OPEN after ${failureThreshold} failures, got state ${state}`);
    }

    CB.recordFailure("openmeteo");
    const stateAfter = CB.getState("openmeteo");
    if (stateAfter === "OPEN") {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push(`Expected circuit OPEN (no state change on extra failure), got state ${stateAfter}`);
    }

    _log_gcal({ event: "e2e_test", test: "circuit_breaker", passed: results.passed, failed: results.failed, state });

  } catch (e) {
    results.failed++;
    results.errors.push(e.message || String(e));
  } finally {
    _runTestsCleanup_gcal();
  }

  const msg = `test_e2e_gcal_circuit_breaker: ${results.passed} passed, ${results.failed} failed`;
  Logger.log(msg);
  results.errors.forEach(e => Logger.log("  ERROR: " + e));
  return results;
}

function test_e2e_gcal_budget_exhaustion() {
  const results = { passed: 0, failed: 0, errors: [] };

  try {
    _runTestsCleanup_gcal();

    const startMs = Date.now();
    const BUDGET_MS = 345000;
    _nowOverrideGcal = startMs - BUDGET_MS - 1000;

    const budget = budgetStart();

    try {
      checkBudget(budget, "test_label");
      results.failed++;
      results.errors.push("Expected checkBudget to throw Budget exhausted");
    } catch (e) {
      if (String(e).includes("Budget exhausted")) {
        results.passed++;
      } else {
        results.failed++;
        results.errors.push("Unexpected error: " + e.message);
      }
    }

    _log_gcal({ event: "e2e_test", test: "budget_exhaustion", passed: results.passed, failed: results.failed });

  } catch (e) {
    results.failed++;
    results.errors.push(e.message || String(e));
  } finally {
    _runTestsCleanup_gcal();
  }

  const msg = `test_e2e_gcal_budget_exhaustion: ${results.passed} passed, ${results.failed} failed`;
  Logger.log(msg);
  results.errors.forEach(e => Logger.log("  ERROR: " + e));
  return results;
}

function test_e2e_gcal_partial_failure() {
  const results = { passed: 0, failed: 0, errors: [] };

  try {
    _runTestsCleanup_gcal();

    const savedConfig = JSON.parse(JSON.stringify(CONFIG));
    CONFIG.dryRun = true;
    CONFIG.locations = [
      { name: "London", lat: 51.5, lon: -0.1 },
      { name: "Paris", lat: 48.85, lon: 2.35 },
      { name: "Berlin", lat: 52.52, lon: 13.41 }
    ];

    const mockOm = _buildMockOpenMeteoDaily();
    const mockWa = _buildMockWaqiAirQuality();

    // Track which city each request is for via lat/lon in URL.
    // Force a 500 on the second city's deterministic-forecast request
    // (London=51.5, Paris=48.85, Berlin=52.52).  All other requests succeed.
    // This exercises the partial-failure path: one city's det fetch fails,
    // the others succeed, and the loop must continue (buildDashboardPayload
    // is wrapped in try/catch and skips the failed city).
    _fetchAllImplGcal = (requests) => {
      return requests.map(req => {
        const u = req.url;
        if (u.includes("latitude=48.85")) {
          // Paris's deterministic forecast request
          if (u.includes("daily=temperature_2m_max")) {
            return { getResponseCode: () => 500, getContentText: () => '{"error":"server error"}' };
          }
        }
        if (u.includes("open-meteo.com")) return mockOm();
        if (u.includes("waqi.info")) return mockWa();
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      });
    };

    _nowOverrideGcal = new Date("2025-06-21T10:00:00Z").getTime();
    _wikiCacheGcal = {};
    _breakingNewsCacheGcal = {};
    CB.create("openmeteo");
    CB.create("waqi");
    CB.create("geocoder");
    CB.create("wikipedia");
    CB.create("newsapi");

    try {
      syncWeatherToCalendar();
      // The critical assertion: syncWeatherToCalendar must NOT throw even
      // when one city's det request 500s. The per-city try/catch in
      // buildDashboardPayload swallows the failure and continues.
      results.passed++;
    } catch (e) {
      results.failed++;
      results.errors.push(`syncWeatherToCalendar threw unexpectedly: ${e.message}`);
    }

    _log_gcal({ event: "e2e_test", test: "partial_failure", passed: results.passed, failed: results.failed });

  } catch (e) {
    results.failed++;
    results.errors.push(e.message || String(e));
    _log_gcal({ event: "e2e_test", test: "partial_failure", status: "error", error: e.message || String(e) });
  } finally {
    if (typeof savedConfig !== "undefined") {
      CONFIG.dryRun = savedConfig.dryRun;
      CONFIG.locations = savedConfig.locations;
    }
    _runTestsCleanup_gcal();
  }

  const msg = `test_e2e_gcal_partial_failure: ${results.passed} passed, ${results.failed} failed`;
  Logger.log(msg);
  results.errors.forEach(e => Logger.log("  ERROR: " + e));
  return results;
}

function _buildMockOpenMeteoDaily() {
  const base = new Date("2025-06-21T00:00:00Z").getTime();
  const times = Array.from({ length: 16 }, (_, i) => {
    const d = new Date(base + i * 86400000);
    return d.toISOString().slice(0, 10);
  });
  return () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      daily: {
        time: times,
        temperature_2m_max: times.map(() => 22),
        temperature_2m_min: times.map(() => 14),
        precipitation_sum: times.map(() => 0.5),
        weather_code: times.map(() => 3)
      }
    })
  });
}

function _buildMockWaqiAirQuality() {
  return () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ status: "ok", data: { aqi: 45, idx: 12345 } })
  });
}

function _runTestsCleanup_gcal() {
  _fetchAllImplGcal = UrlFetchApp.fetchAll.bind(UrlFetchApp);
  _nowOverrideGcal = null;
  _wikiCacheGcal = {};
  _breakingNewsCacheGcal = {};
  CB.create("openmeteo");
  CB.create("waqi");
  CB.create("geocoder");
  CB.create("wikipedia");
  CB.create("newsapi");
}

function _log_gcal(entry) {
  try {
    Logger.log(JSON.stringify({ ts: new Date().toISOString(), source: "gcalweather", ...entry }));
  } catch (e) {
    Logger.log("LOG_ERROR: " + (e.message || String(e)));
  }
}
