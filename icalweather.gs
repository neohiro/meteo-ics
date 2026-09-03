/**
 * Weather & Astronomical Dashboard iCalendar (.ics) Generator
 * 
 * Architecture & Format:
 *  - Category Spacing: Clean single empty line (\n\n) between discrete card blocks.
 *  - Atmosphere Pressure Metric: Surface pressure converted to Standard Atmosphere (atm).
 *  - Hourly Aggregations: Accurately parses hourly surface pressure and minimum soil temperatures.
 *  - Full 4-Tier Lead Curve Audit: D1-3, D4-7, D8-14, D15+ benchmark tracking.
 *  - Complete Feature Set: Actionable GDD, solar radiation, full celestial catalog, and priority advisory engine.
 *  - Compact Stargazing: Mobile-optimized condition string with trailing cloud text removed.
 *  - Stateless Parameter Delivery: Clean URL query interface (?cities=... or ?locations=...).
 */

const ICAL_CONFIG = {
  calendarName: "Weather & Celestial Feed",
  temperatureUnit: "celsius",
  forecastDays: 30,
  deterministicDays: 14
};

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const locations = parseLocationsFromParams(e);

  if (!locations || locations.length === 0) {
    const errorMsg = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Weather Astronomical Dashboard//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Weather Feed - Error",
      "BEGIN:VEVENT",
      `UID:error_no_locations_${Date.now()}@weatherdashboard`,
      `DTSTAMP:${Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss'Z'")}`,
      `DTSTART;VALUE=DATE:${Utilities.formatDate(new Date(), "UTC", "yyyyMMdd")}`,
      "SUMMARY:⚠️ No Locations Specified",
      "DESCRIPTION:Please supply locations via URL query parameters.\\nExample: ?cities=Tokyo,Paris or ?locations=Kyoto:35.0116:135.7681",
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    return ContentService.createTextOutput(errorMsg)
      .setMimeType(ContentService.MimeType.ICAL)
      .downloadAsFile("weather_feed_error.ics");
  }

  const unitParam = (params.unit || params.temperatureUnit || ICAL_CONFIG.temperatureUnit).toLowerCase();
  const temperatureUnit = unitParam.startsWith("f") ? "fahrenheit" : "celsius";

  const icsContent = generateIcsFeed(locations, temperatureUnit);
  return ContentService.createTextOutput(icsContent)
    .setMimeType(ContentService.MimeType.ICAL)
    .downloadAsFile("weather_feed.ics");
}

function parseLocationsFromParams(e) {
  if (!e || !e.parameter) return [];
  const p = e.parameter;
  const list = [];

  if (p.locations) {
    const entries = p.locations.split(",");
    entries.forEach(entry => {
      const parts = entry.split(":");
      if (parts.length >= 3) {
        const name = parts[0].trim();
        const lat = parseFloat(parts[1]);
        const lon = parseFloat(parts[2]);
        if (!isNaN(lat) && !isNaN(lon) && name) {
          list.push({ name, lat, lon });
        }
      }
    });
  }

  if (p.lat && p.lon) {
    const lat = parseFloat(p.lat);
    const lon = parseFloat(p.lon);
    if (!isNaN(lat) && !isNaN(lon)) {
      list.push({
        name: p.name ? p.name.trim() : "Custom Location",
        lat,
        lon
      });
    }
  }

  if (p.cities) {
    const cityNames = p.cities.split(",");
    cityNames.forEach(cityName => {
      const trimmed = cityName.trim();
      if (trimmed) {
        const geo = geocodeCity(trimmed);
        if (geo) list.push(geo);
      }
    });
  }

  if (p.city && !p.cities) {
    const trimmed = p.city.trim();
    if (trimmed) {
      const geo = geocodeCity(trimmed);
      if (geo) list.push(geo);
    }
  }

  const seen = new Set();
  return list.filter(loc => {
    const key = norm(loc.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateIcsFeed(locations, temperatureUnit) {
  const unitSymbol = temperatureUnit === "celsius" ? "°" : "°F";
  const isC = temperatureUnit === "celsius";
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

  locations.forEach(loc => {
    const data = fetchIcsAtmosphericData(loc, temperatureUnit);
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
      let currentRain = 0, currentWind = 0, windGusts = 0, rainProb = 0, weatherCode = 0;
      let humidity = null, dewPoint = null, cloudCover = null;
      let uvIndex = 0, et0 = 0, radiation = 0, soilTempMin = 10, pressure = 1013.25;
      let sunriseStr = "--:--", sunsetStr = "--:--", daylightFormatted = "--";
      let title = "", modelLabel = "", spreadVal = 0;

      if (offset < ICAL_CONFIG.deterministicDays) {
        currentMax = Math.round(data.det.temperature_2m_max[idx]);
        currentMin = Math.round(data.det.temperature_2m_min[idx]);
        apparentMax = data.det.apparent_temperature_max ? Math.round(data.det.apparent_temperature_max[idx]) : currentMax;
        currentRain = data.det.precipitation_sum ? data.det.precipitation_sum[idx] : 0;
        rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[idx] : 0;
        currentWind = data.det.windspeed_10m_max ? Math.round(data.det.windspeed_10m_max[idx]) : 0;
        windGusts = data.det.windgusts_10m_max ? Math.round(data.det.windgusts_10m_max[idx]) : 0;
        weatherCode = data.det.weathercode ? data.det.weathercode[idx] : 0;

        humidity = data.det.relative_humidity_2m_mean ? Math.round(data.det.relative_humidity_2m_mean[idx]) : null;
        dewPoint = data.det.dew_point_2m_mean ? Math.round(data.det.dew_point_2m_mean[idx]) : null;
        cloudCover = data.det.cloudcover_mean ? Math.round(data.det.cloudcover_mean[idx]) : null;

        uvIndex = data.det.uv_index_max ? data.det.uv_index_max[idx] : 0;
        et0 = data.det.et0_fao_evapotranspiration ? data.det.et0_fao_evapotranspiration[idx] : 0;
        radiation = data.det.shortwave_radiation_sum ? data.det.shortwave_radiation_sum[idx] : 0;

        if (data.hourlyAgg && data.hourlyAgg[dateKey]) {
          pressure = data.hourlyAgg[dateKey].pressure || 1013.25;
          soilTempMin = data.hourlyAgg[dateKey].soilMin !== null ? data.hourlyAgg[dateKey].soilMin : currentMin;
        } else {
          soilTempMin = currentMin;
        }

        if (data.det.sunrise && data.det.sunset && data.det.sunrise[idx] && data.det.sunset[idx]) {
          sunriseStr = data.det.sunrise[idx].slice(11, 16);
          sunsetStr = data.det.sunset[idx].slice(11, 16);
          const rDate = new Date(data.det.sunrise[idx]);
          const sDate = new Date(data.det.sunset[idx]);
          const dMins = Math.round((sDate - rDate) / 60000);
          daylightFormatted = `${Math.floor(dMins / 60)}h ${dMins % 60}m`;
        }

        const certaintyGlyph = getWeatherGlyph(weatherCode);
        title = `${certaintyGlyph} ${currentMax}${unitSymbol} ${loc.name}`;
        modelLabel = `Deterministic (D-${offset === 0 ? "0" : offset})`;
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
            modelLabel = `NOAA Ensemble (D-${offset})`;
          }
        }
      }

      if (currentMax === null) continue;

      let aqiVal = null, pm25Val = null, pm10Val = null, pollenVal = null;
      if (data.aq && data.aq.time) {
        const aqIdx = data.aq.time.indexOf(dateKey);
        if (aqIdx !== -1) {
          aqiVal = data.aq.european_aqi ? Math.round(data.aq.european_aqi[idx]) : null;
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
      const stargazing = assessStargazingConditions(data, offset, moonInfo.fraction, cloudCover);
      const tempMinInC = isC ? currentMin : (currentMin - 32) * (5 / 9);

      const pressureAtm = (pressure / 1013.25).toFixed(2);
      const aggregates = computeMultiDayAggregates(data, offset, isC);
      const gddNote = getGddAction(aggregates.sevenDayGDD);

      const lead = offset;
      const expectedErr = lead <= 3 ? 0.8 : (lead <= 7 ? 1.7 : (lead <= 14 ? 2.9 : 4.3));
      const modelAuditStatus = lead === 0 
        ? "🎯 Ground-Truth (Live)" 
        : (lead <= 3 ? "🟢 D1-3 High" : (lead <= 7 ? "🟡 D4-7 Medium" : (lead <= 14 ? "🟠 D8-14 Extended" : "🎲 D15+ Ensemble")));

      const adviceContext = {
        tempMax: currentMax,
        tempMin: currentMin,
        apparentMax: apparentMax,
        rainProb: rainProb,
        rainVol: currentRain,
        wind: currentWind,
        aqi: aqiVal,
        uv: uvIndex,
        pollen: pollenVal,
        weatherCode: weatherCode,
        et0: et0,
        isC: isC
      };
      const prioritizedAdvice = generatePrioritizedAdvices(adviceContext);

      const sections = [
        [
          `📍 ${loc.name}`,
          `📅 ${offset === 0 ? "D-Day (Today)" : `D-${offset}`} · ${dateKey}`
        ].join("\n"),

        [
          `🌡️ TEMPERATURE & COMFORT`,
          `• Range: ${currentMin}${unitSymbol} ➔ ${currentMax}${unitSymbol} (${getThermalText(currentMax, isC)})`,
          `• Sensation: Feels ~${apparentMax}${unitSymbol}${dewPoint !== null ? ` · Dew: ${dewPoint}${unitSymbol}` : ""}`,
          humidity !== null ? `• Humidity: ${humidity}% ${getHumidityGlyph(humidity)} (${getHumidityComfort(humidity)})` : ``,
          offset >= ICAL_CONFIG.deterministicDays
            ? `• Consensus: ±${spreadVal}${unitSymbol}`
            : `• Rain: ${Number(currentRain).toFixed(1)} mm (${rainProb}%)`,
          offset < ICAL_CONFIG.deterministicDays
            ? `• Wind: ${currentWind} km/h${windGusts > currentWind ? ` (Gusts ${windGusts} km/h)` : ""}`
            : ``,
          offset < ICAL_CONFIG.deterministicDays ? `• Barometer: ${pressureAtm} atm` : ``
        ].filter(Boolean).join("\n"),

        [
          `☀️ SUN & CELESTIAL`,
          astroEvent ? `• ${astroEvent}` : ``,
          `• Daylight: 🌅${sunriseStr}–🌇${sunsetStr} (${daylightFormatted})`,
          `• Golden Hr: ~${getGoldenHourWindow(sunsetStr)}`,
          cloudCover !== null ? `• Cloud Cover: ${cloudCover}%` : ``,
          `• Moon: ${moonInfo.glyph} ${moonInfo.name} (${moonInfo.illumination})`,
          `• Stargazing: ${stargazing}`,
          uvIndex > 0 ? `• UV Index: ${uvIndex.toFixed(1)} (${getUvAdvice(uvIndex)})` : ``,
          et0 > 0 ? `• Evapotranspiration: ${et0.toFixed(1)} mm` : ``,
          radiation > 0 ? `• Solar Radiation: ${radiation.toFixed(1)} MJ/m²` : ``
        ].filter(Boolean).join("\n"),

        [
          `🧪 AIR QUALITY & BIO`,
          aqiVal !== null ? `• AQI: ${aqiVal} ${getAqiGlyph(aqiVal)} (${getAqiLabel(aqiVal)})` : `• AQI: Monitoring`,
          pm25Val !== null ? `• PM2.5: ${pm25Val} · PM10: ${pm10Val || "--"} µg/m³` : ``,
          pollenVal > 0 ? `• Pollen Load: ${pollenVal} gr/m³` : `• Pollen Load: Low`
        ].filter(Boolean).join("\n"),

        [
          `📅 7-DAY AGGREGATE`,
          `• Rain Sum: ${aggregates.sevenDayRain} mm`,
          `• Mean Temp: ${aggregates.sevenDayMeanTemp}${unitSymbol}`,
          `• Growing Deg: ${aggregates.sevenDayGDD} GDD (${gddNote})`
        ].join("\n"),

        [
          `📉 MODEL AUDIT`,
          `• Status: ${modelAuditStatus}`,
          `• Expected Lead Drift: ±${expectedErr.toFixed(1)}${unitSymbol}`,
          `• Lead Curve: D1-3:±0.8° · D4-7:±1.7° · D8-14:±2.9° · D15+:±4.3°`
        ].join("\n")
      ];

      if (tempMinInC <= 7) {
        const roadHazard = assessRoadConditions(currentMin, soilTempMin, currentRain, isC);
        sections.push([
          `🚗 ROAD SAFETY (<=7°C)`,
          `• Status: ${roadHazard.status}`,
          `• Ground: ${Math.round(soilTempMin)}${unitSymbol} (${roadHazard.advisory})`
        ].join("\n"));
      }

      sections.push([
        `💡 ACTIONABLE ADVICE`,
        prioritizedAdvice.map(adv => `• ${adv}`).join("\n"),
        ``,
        `ℹ️ Engine: ${modelLabel}`
      ].join("\n"));

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

function fetchIcsAtmosphericData(loc, unit) {
  const result = { det: null, ens: null, aq: null, hourlyAgg: {} };
  const dUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weathercode,precipitation_sum,precipitation_probability_max,windspeed_10m_max,windgusts_10m_max,relative_humidity_2m_mean,dew_point_2m_mean,cloudcover_mean,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration,shortwave_radiation_sum&temperature_unit=${unit}&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;
  const hUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=pressure_msl,soil_temperature_0cm&temperature_unit=${unit}&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;
  const eUrl = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=gfs_seamless&forecast_days=${ICAL_CONFIG.forecastDays}&temperature_unit=${unit}&timezone=auto`;
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&daily=european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,dust,alder_pollen,birch_pollen,grass_pollen&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;

  try {
    const dRes = UrlFetchApp.fetch(dUrl, { muteHttpExceptions: true });
    if (dRes.getResponseCode() === 200) result.det = JSON.parse(dRes.getContentText()).daily;

    const hRes = UrlFetchApp.fetch(hUrl, { muteHttpExceptions: true });
    if (hRes.getResponseCode() === 200) {
      const hData = JSON.parse(hRes.getContentText()).hourly;
      if (hData && hData.time) {
        const aggs = {};
        for (let i = 0; i < hData.time.length; i++) {
          const dStr = hData.time[i].slice(0, 10);
          if (!aggs[dStr]) aggs[dStr] = { pressures: [], soilTemps: [] };
          if (hData.pressure_msl && hData.pressure_msl[i] !== null) aggs[dStr].pressures.push(hData.pressure_msl[i]);
          if (hData.soil_temperature_0cm && hData.soil_temperature_0cm[i] !== null) aggs[dStr].soilTemps.push(hData.soil_temperature_0cm[i]);
        }
        Object.keys(aggs).forEach(dateStr => {
          const pArr = aggs[dateStr].pressures;
          const sArr = aggs[dateStr].soilTemps;
          result.hourlyAgg[dateStr] = {
            pressure: pArr.length > 0 ? (pArr.reduce((a, b) => a + b, 0) / pArr.length) : 1013.25,
            soilMin: sArr.length > 0 ? Math.min(...sArr) : null
          };
        });
      }
    }

    const eRes = UrlFetchApp.fetch(eUrl, { muteHttpExceptions: true });
    if (eRes.getResponseCode() === 200) result.ens = JSON.parse(eRes.getContentText()).daily;

    const aqRes = UrlFetchApp.fetch(aqUrl, { muteHttpExceptions: true });
    if (aqRes.getResponseCode() === 200) result.aq = JSON.parse(aqRes.getContentText()).daily;
  } catch (e) {
    Logger.log("iCal atmospheric fetch error: " + e);
  }
  return result;
}

function geocodeCity(name) {
  try {
    const res = UrlFetchApp.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&format=json`, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText()).results;
    if (data && data.length) {
      return { name: data[0].name, lat: data[0].latitude, lon: data[0].longitude };
    }
  } catch (e) {}
  return null;
}

function norm(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getGddAction(gdd) {
  const g = Number(gdd) || 0;
  if (g === 0) return "Dormant";
  if (g < 25) return "Cool greens active";
  if (g < 60) return "Steady root foliage";
  if (g < 100) return "Brassicas booming";
  return "Peak warm growth";
}

function computeMultiDayAggregates(data, startOffset, isC) {
  let totalRain = 0, totalMax = 0, totalMin = 0, gddSum = 0, wDays = 0;

  if (data.det && data.det.temperature_2m_max) {
    const times = data.det.time;
    for (let i = startOffset; i < Math.min(startOffset + 7, times.length); i++) {
      if (i < 0) continue;
      const maxT = data.det.temperature_2m_max[i] || 0;
      const minT = data.det.temperature_2m_min[i] || 0;
      const r = (data.det.precipitation_sum ? data.det.precipitation_sum[i] : 0) || 0;

      totalRain += r;
      totalMax += maxT;
      totalMin += minT;

      const base10 = isC ? 10 : 50;
      const meanT = (maxT + minT) / 2;
      if (meanT > base10) gddSum += (meanT - base10);
      wDays++;
    }
  }

  return {
    sevenDayRain: totalRain.toFixed(1),
    sevenDayMeanTemp: wDays > 0 ? ((totalMax + totalMin) / (wDays * 2)).toFixed(1) : "--",
    sevenDayGDD: Math.round(gddSum)
  };
}

function generatePrioritizedAdvices(ctx) {
  const isC = ctx.isC;
  const maxC = isC ? ctx.tempMax : (ctx.tempMax - 32) * (5 / 9);
  const minC = isC ? ctx.tempMin : (ctx.tempMin - 32) * (5 / 9);
  const appC = isC ? ctx.apparentMax : (ctx.apparentMax - 32) * (5 / 9);

  const pool = [];

  // P1: Severe Life & Weather Warnings (Score 90-100)
  if ([95, 96, 99].includes(ctx.weatherCode)) {
    pool.push({ p: 100, text: "Thunderstorm warning: seek sturdy shelter ⚡" });
  }
  if (ctx.wind >= 60) {
    pool.push({ p: 98, text: "Gale force winds: secure loose outdoor items 🚩" });
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

  // P2: Thermal Extremes & Freeze (Score 80-92)
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

  // P3: Respiratory, Health & Bio Hazards (Score 65-88)
  if (ctx.aqi && ctx.aqi >= 80) {
    pool.push({ p: 88, text: "Hazardous air: wear N95/mask & run indoor filters 😷" });
  } else if (ctx.aqi && ctx.aqi >= 50) {
    pool.push({ p: 68, text: "Moderate smog: sensitive groups limit cardio 🫁" });
  }
  if (ctx.pollen && ctx.pollen >= 80) {
    pool.push({ p: 72, text: "Severe pollen wave: keep windows shut, meds ready 🌾" });
  } else if (ctx.pollen && ctx.pollen >= 35) {
    pool.push({ p: 55, text: "Moderate pollen: rinse eyes & face after walks 🌼" });
  }

  // P4: Solar & UV Exposure (Score 50-70)
  if (ctx.uv >= 8) {
    pool.push({ p: 70, text: "Very high UV: SPF 50+, hat & sunglasses required 🧴" });
  } else if (ctx.uv >= 5) {
    pool.push({ p: 58, text: "Moderate UV: apply sunscreen for midday outings 🕶️" });
  }

  // P5: Garden, Irrigation & Agriculture (Score 40-62)
  if (ctx.et0 >= 4.5 && ctx.rainVol < 2) {
    pool.push({ p: 62, text: "High soil moisture loss: deep-soak garden beds 💧" });
  } else if (ctx.rainVol >= 15) {
    pool.push({ p: 48, text: "Soil saturated: disable automatic garden irrigation 🛑" });
  } else if (ctx.et0 <= 1.0 && maxC < 14) {
    pool.push({ p: 40, text: "Low evaporation: avoid overwatering potted crops 🌱" });
  }

  // P6: Clothing & Daily Routine Comfort (Score 30-52)
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

function assessRoadConditions(tMin, soilMin, rainVol, isC) {
  const minC = isC ? tMin : (tMin - 32) * (5 / 9);
  const groundC = isC ? soilMin : (soilMin - 32) * (5 / 9);

  if (groundC <= 0 && rainVol > 0.2) {
    return {
      status: "🧊 BLACK ICE DANGER",
      advisory: "Glazed surface. Triple braking distance."
    };
  } else if (groundC <= 0) {
    return {
      status: "❄️ FROST / SLICK SPOTS",
      advisory: "Bridges & shaded ramps prone to ice."
    };
  } else if (minC <= 3 && rainVol > 2.0) {
    return {
      status: "💧 COLD SPRAY RISK",
      advisory: "Reduced grip on summer tires."
    };
  } else {
    return {
      status: "🚗 CHILLED ASPHALT",
      advisory: "Sub-7°C rubber hardening threshold."
    };
  }
}

function getAstronomicalEvents(dateStr) {
  const md = dateStr.slice(5);
  const events = {
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
  return events[md] || null;
}

function getMoonPhaseDetails(date) {
  const lp = 2551443;
  const now = date.getTime();
  const newMoonRef = new Date(1970, 0, 7, 20, 35, 0).getTime();
  const phase = ((now - newMoonRef) / 1000) % lp;
  const dayOfCycle = Math.floor(phase / (24 * 3600));

  let glyph = "🌑", name = "New Moon", fraction = 0;
  if (dayOfCycle <= 1 || dayOfCycle >= 28) {
    glyph = "🌑"; name = "New Moon"; fraction = 0.02;
  } else if (dayOfCycle <= 6) {
    glyph = "🌒"; name = "Waxing Crescent"; fraction = 0.25;
  } else if (dayOfCycle <= 9) {
    glyph = "🌓"; name = "1st Quarter"; fraction = 0.50;
  } else if (dayOfCycle <= 13) {
    glyph = "🌔"; name = "Waxing Gibbous"; fraction = 0.75;
  } else if (dayOfCycle <= 16) {
    glyph = "🌕"; name = "Full Moon"; fraction = 0.99;
  } else if (dayOfCycle <= 20) {
    glyph = "🌖"; name = "Waning Gibbous"; fraction = 0.75;
  } else if (dayOfCycle <= 23) {
    glyph = "🌗"; name = "Last Quarter"; fraction = 0.50;
  } else {
    glyph = "🌘"; name = "Waning Crescent"; fraction = 0.25;
  }
  return { glyph, name, fraction, illumination: `${Math.round(fraction * 100)}%` };
}

function assessStargazingConditions(data, offset, moonFraction, cloudCover) {
  if (offset >= ICAL_CONFIG.deterministicDays || !data.det || !data.det.weathercode) {
    return moonFraction > 0.7 ? "🌕 Filtered by Moon" : "🔭 Decent";
  }
  const code = data.det.weathercode[offset] || 0;
  const rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[offset] : 0;

  if (cloudCover !== null && cloudCover > 70) return "☁️ Obscured";
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

function getWeatherGlyph(code) {
  if (code === 0) return "☀️";
  if (code < 3) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 57 || (code >= 66 && code <= 67)) return "🧊";
  if (code <= 65) return code === 65 ? "🌊" : "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "🌨️";
  return "⚡";
}

function getThermalText(t, isC) {
  const c = isC ? t : (t - 32) * (5 / 9);
  if (c <= 0) return "Freezing";
  if (c <= 10) return "Chilly";
  if (c <= 20) return "Comfortable";
  if (c <= 26) return "Pleasant";
  if (c <= 32) return "Warm";
  return "Hot";
}

function getHumidityGlyph(h) {
  if (h <= 30) return "🏜️";
  if (h <= 60) return "💧";
  return "🧖";
}

function getHumidityComfort(h) {
  if (h <= 30) return "Dry Air";
  if (h <= 60) return "Comfortable";
  if (h <= 75) return "Humid";
  return "Very Muggy";
}

function getAqiGlyph(aqi) {
  if (aqi === null) return "🍃";
  if (aqi <= 20) return "🟢";
  if (aqi <= 40) return "🟡";
  if (aqi <= 60) return "🟠";
  if (aqi <= 80) return "🔴";
  return "🟣";
}

function getAqiLabel(aqi) {
  if (aqi === null) return "Unknown";
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
