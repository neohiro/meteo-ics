/**
 * Weather & Astronomical Dashboard iCalendar (.ics) Generator
 * 
 * Features:
 *  - Generates RFC 5545-compliant .ics payload.
 *  - Mobile-optimized card layout starting with TEMPERATURE & COMFORT.
 *  - Empty lines (\n\n) between categories for scannability.
 *  - Location and date metadata placed in footer.
 */

const ICAL_CONFIG = {
  calendarName: "Weather & Celestial Feed",
  temperatureUnit: "celsius", // "celsius" or "fahrenheit"
  forecastDays: 30,
  deterministicDays: 14,
  locations: [
    { name: "Kyoto", lat: 35.0116, lon: 135.7681 },
    { name: "Valparaíso", lat: -33.0472, lon: -71.6127 },
    { name: "Reykjavik", lat: 64.1466, lon: -21.9426 }
  ]
};

function doGet(e) {
  const icsContent = generateIcsFeed();
  return ContentService.createTextOutput(icsContent)
    .setMimeType(ContentService.MimeType.ICAL)
    .downloadAsFile("weather_feed.ics");
}

function generateIcsFeed() {
  const unitSymbol = ICAL_CONFIG.temperatureUnit === "celsius" ? "°" : "°F";
  const isC = ICAL_CONFIG.temperatureUnit === "celsius";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Weather Astronomical Dashboard//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(ICAL_CONFIG.calendarName)}`,
    "X-WR-TIMEZONE:UTC"
  ];

  ICAL_CONFIG.locations.forEach(loc => {
    const data = fetchIcsAtmosphericData(loc);
    if (!data || !data.det || !data.det.time) return;

    for (let offset = 0; offset < ICAL_CONFIG.forecastDays; offset++) {
      const targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const dateKey = Utilities.formatDate(targetDate, "UTC", "yyyy-MM-dd");
      const icsDate = Utilities.formatDate(targetDate, "UTC", "yyyyMMdd");
      const nextDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
      const icsNextDate = Utilities.formatDate(nextDate, "UTC", "yyyyMMdd");

      const idx = data.det.time.indexOf(dateKey);
      if (idx === -1) continue;

      let currentMax = null, currentMin = null, apparentMax = null;
      let currentRain = 0, currentWind = 0, rainProb = 0;
      let uvIndex = 0, et0 = 0, pressure = 1015, soilTempMin = 10;
      let sunriseStr = "--:--", sunsetStr = "--:--", daylightFormatted = "--";
      let title = "", modelLabel = "", spreadVal = 0;

      if (offset < ICAL_CONFIG.deterministicDays) {
        currentMax = Math.round(data.det.temperature_2m_max[idx]);
        currentMin = Math.round(data.det.temperature_2m_min[idx]);
        apparentMax = data.det.apparent_temperature_max ? Math.round(data.det.apparent_temperature_max[idx]) : currentMax;
        currentRain = data.det.precipitation_sum ? data.det.precipitation_sum[idx] : 0;
        rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[idx] : 0;
        currentWind = data.det.windspeed_10m_max ? Math.round(data.det.windspeed_10m_max[idx]) : 0;
        uvIndex = data.det.uv_index_max ? data.det.uv_index_max[idx] : 0;
        et0 = data.det.et0_fao_evapotranspiration ? data.det.et0_fao_evapotranspiration[idx] : 0;

        if (data.det.sunrise && data.det.sunset && data.det.sunrise[idx] && data.det.sunset[idx]) {
          sunriseStr = data.det.sunrise[idx].slice(11, 16);
          sunsetStr = data.det.sunset[idx].slice(11, 16);
          const rDate = new Date(data.det.sunrise[idx]);
          const sDate = new Date(data.det.sunset[idx]);
          const dMins = Math.round((sDate - rDate) / 60000);
          daylightFormatted = `${Math.floor(dMins / 60)}h ${dMins % 60}m`;
        }

        const certaintyGlyph = getWeatherGlyph(data.det.weathercode[idx]);
        title = `${certaintyGlyph} ${currentMax}${unitSymbol} ${loc.name}`;
        modelLabel = `High-Res Deterministic (D-${offset === 0 ? "Day" : offset})`;
      } else if (data.ens && data.ens.time) {
        const ensIdx = data.ens.time.indexOf(dateKey);
        if (ensIdx !== -1) {
          const maxKeys = Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_max"));
          const minKeys = Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_min"));
          const maxVals = maxKeys.map(k => data.ens[k][ensIdx]).filter(v => v !== null && !isNaN(v));
          const minVals = minKeys.map(k => data.ens[k][ensIdx]).filter(v => v !== null && !isNaN(v));

          if (maxVals.length > 0) {
            currentMax = Math.round(maxVals.reduce((a, b) => a + b, 0) / maxVals.length);
            currentMin = Math.round(minVals.reduce((a, b) => a + b, 0) / minVals.length);
            apparentMax = currentMax;
            const variance = maxVals.reduce((a, b) => a + Math.pow(b - currentMax, 2), 0) / maxVals.length;
            spreadVal = Math.max(1, Math.round(Math.sqrt(variance)));
            const certaintyGlyph = spreadVal <= 2 ? "🎯" : (spreadVal <= 4 ? "⚖️" : "🎲");
            currentRain = (data.ens.precipitation_sum ? data.ens.precipitation_sum[ensIdx] : 0) || 0;
            soilTempMin = currentMin;
            title = `${certaintyGlyph} ~${currentMax}${unitSymbol} ${loc.name} (±${spreadVal}${unitSymbol})`;
            modelLabel = `NOAA GFS 31-Member Ensemble (D-${offset})`;
          }
        }
      }

      if (currentMax === null) continue;

      let aqiVal = null, pm25Val = null, pm10Val = null, pollenVal = null;
      if (data.aq && data.aq.time) {
        const aqIdx = data.aq.time.indexOf(dateKey);
        if (aqIdx !== -1) {
          aqiVal = data.aq.european_aqi ? Math.round(data.aq.european_aqi[aqIdx]) : null;
          pm25Val = data.aq.pm2_5 ? Number(data.aq.pm2_5[aqIdx].toFixed(1)) : null;
          pm10Val = data.aq.pm10 ? Number(data.aq.pm10[aqIdx].toFixed(1)) : null;
          const birch = data.aq.birch_pollen ? data.aq.birch_pollen[aqIdx] : 0;
          const grass = data.aq.grass_pollen ? data.aq.grass_pollen[aqIdx] : 0;
          const alder = data.aq.alder_pollen ? data.aq.alder_pollen[aqIdx] : 0;
          pollenVal = Math.round(Math.max(birch, grass, alder));
        }
      }

      const astroEvent = getAstronomicalEvents(dateKey);
      const moonInfo = getMoonPhaseDetails(targetDate);
      const stargazing = assessStargazingConditions(data, offset, moonInfo.fraction);
      const tempMinInC = isC ? currentMin : (currentMin - 32) * (5 / 9);

      // Construct sections with explicit whitespace separation
      const sections = [];

      // 1. Temperature & Comfort
      const tempSection = [
        `🌡️ TEMPERATURE & COMFORT`,
        `• High: ${currentMax}${unitSymbol} (${getThermalText(currentMax, isC)})`,
        `• Low: ${currentMin}${unitSymbol} · Feels: ~${apparentMax}${unitSymbol}`,
        offset >= ICAL_CONFIG.deterministicDays
          ? `• Model Consensus: ±${spreadVal}${unitSymbol}`
          : `• Rain: ${Number(currentRain).toFixed(1)} mm (${rainProb}%)`,
        offset < ICAL_CONFIG.deterministicDays ? `• Wind: ${currentWind} km/h` : ``
      ].filter(Boolean);
      sections.push(tempSection.join("\n"));

      // 2. Sun & Celestial
      const sunSection = [
        `☀️ SUN & CELESTIAL`,
        astroEvent ? `✨ ${astroEvent}` : ``,
        `• Sun: 🌅 ${sunriseStr} – 🌇 ${sunsetStr}`,
        `• Daylight: ${daylightFormatted}`,
        `• Golden Hr: ~${getGoldenHourWindow(sunsetStr)}`,
        `• Moon: ${moonInfo.glyph} ${moonInfo.name} (${moonInfo.illumination})`,
        `• Stargazing: ${stargazing}`,
        uvIndex > 0 ? `• UV Index: ${uvIndex.toFixed(1)}` : ``
      ].filter(Boolean);
      sections.push(sunSection.join("\n"));

      // 3. Air Quality & Bio
      const bioSection = [
        `🧪 AIR QUALITY & BIO`,
        aqiVal !== null ? `• AQI: ${aqiVal} ${getAqiGlyph(aqiVal)} (${getAqiLabel(aqiVal)})` : `• AQI: Monitoring`,
        pm25Val !== null ? `• PM2.5: ${pm25Val} · PM10: ${pm10Val || "--"} µg/m³` : ``,
        pollenVal > 0 ? `• Pollen Load: ${pollenVal} gr/m³` : `• Pollen Load: Low / Minimal`
      ].filter(Boolean);
      sections.push(bioSection.join("\n"));

      // 4. Road Hazards (Optional)
      if (tempMinInC <= 7) {
        const roadHazard = assessRoadConditions(currentMin, soilTempMin, currentRain, isC);
        const roadSection = [
          `🚗 ROAD SAFETY ADVISORY (<=7°C)`,
          `• Status: ${roadHazard.status}`,
          `• Ground Temp: ${Math.round(soilTempMin)}${unitSymbol}`,
          `• Advisory: ${roadHazard.advisory}`
        ];
        sections.push(roadSection.join("\n"));
      }

      // 5. Advice & Engine
      const adviceSection = [
        `💡 ${getAdvice(currentMax, rainProb, currentRain, currentWind, aqiVal, isC)}`,
        `ℹ️ Engine: ${modelLabel}`
      ];
      sections.push(adviceSection.join("\n"));

      // 6. Location & Date (Relocated to Footer)
      const footerSection = [
        `📍 ${loc.name}`,
        `📅 ${offset === 0 ? "D-Day (Today)" : `D-${offset}`} · ${dateKey}`
      ];
      sections.push(footerSection.join("\n"));

      const fullDesc = sections.join("\n\n");
      const uid = `weather_${norm(loc.name)}_${dateKey}@weatherdashboard`;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss'Z'")}`);
      lines.push(`DTSTART;VALUE=DATE:${icsDate}`);
      lines.push(`DTEND;VALUE=DATE:${icsNextDate}`);
      lines.push(`SUMMARY:${escapeIcsText(title)}`);
      lines.push(`DESCRIPTION:${escapeIcsText(fullDesc)}`);
      lines.push("STATUS:CONFIRMED");
      lines.push("TRANSP:TRANSPARENT");
      lines.push("END:VEVENT");
    }
  });

  lines.push("END:VCALENDAR");
  return foldIcsLines(lines);
}

function escapeIcsText(str) {
  if (!str) return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLines(lines) {
  return lines.map(line => {
    if (line.length <= 75) return line;
    let out = "";
    let rest = line;
    let first = true;
    while (rest.length > 0) {
      const limit = first ? 75 : 74;
      out += (first ? "" : "\r\n ") + rest.slice(0, limit);
      rest = rest.slice(limit);
      first = false;
    }
    return out;
  }).join("\r\n");
}

function fetchIcsAtmosphericData(loc) {
  const result = { det: null, ens: null, aq: null };
  const u = ICAL_CONFIG.temperatureUnit;

  const dUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weathercode,precipitation_sum,precipitation_probability_max,windspeed_10m_max,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration&temperature_unit=${u}&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;
  const eUrl = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=gfs_seamless&forecast_days=${ICAL_CONFIG.forecastDays}&temperature_unit=${u}&timezone=auto`;
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&daily=european_aqi,pm10,pm2_5,alder_pollen,birch_pollen,grass_pollen&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;

  try {
    const dRes = UrlFetchApp.fetch(dUrl, { muteHttpExceptions: true });
    if (dRes.getResponseCode() === 200) result.det = JSON.parse(dRes.getContentText()).daily;

    const eRes = UrlFetchApp.fetch(eUrl, { muteHttpExceptions: true });
    if (eRes.getResponseCode() === 200) result.ens = JSON.parse(eRes.getContentText()).daily;

    const aqRes = UrlFetchApp.fetch(aqUrl, { muteHttpExceptions: true });
    if (aqRes.getResponseCode() === 200) result.aq = JSON.parse(aqRes.getContentText()).daily;
  } catch (e) {
    Logger.log("iCal atmospheric fetch error: " + e);
  }
  return result;
}
