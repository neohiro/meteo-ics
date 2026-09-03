/**
 * Autonomous Multilingual iCal (.ics) Meteorological, Road Hazard & Audit Engine
 * Supported Languages: en, zh, hi, es, fr, ar, de, nl
 */

function doGet(e) {
  const startTime = Date.now();
  const params = e && e.parameter ? e.parameter : {};

  if (params.action === "status" || params.action === "metrics") {
    const statusPayload = getLiveTelemetryStatus();
    return ContentService.createTextOutput(JSON.stringify(statusPayload, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const rawCities = params.cities || params.locations || "Brunssum,Hasselt";
    const tempUnit = (params.unit && params.unit.toLowerCase() === "fahrenheit") ? "fahrenheit" : "celsius";
    const requestedDays = Math.min(30, Math.max(1, parseInt(params.days, 10) || 30));
    const showHazards = params.hazards !== "false";
    
    // Support Top Global Languages: en, zh, hi, es, fr, ar, de, nl
    const supportedLangs = ["en", "zh", "hi", "es", "fr", "ar", "de", "nl"];
    const lang = (params.lang && supportedLangs.includes(params.lang.toLowerCase())) 
      ? params.lang.toLowerCase() 
      : "en";

    // Strict 4-city execution guard
    const parsedCities = rawCities.split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 4);

    const cache = CacheService.getScriptCache();
    const cacheKey = "ICS_" + Utilities.base64Encode(
      `${parsedCities.join(",")}_${tempUnit}_${requestedDays}_${showHazards}_${lang}`
    ).slice(0, 80);

    const cachedIcs = cache.get(cacheKey);
    if (cachedIcs) {
      recordRequestTelemetry(parsedCities.length, lang, Date.now() - startTime, true);
      return ContentService.createTextOutput(cachedIcs)
        .setMimeType(ContentService.MimeType.ICAL);
    }

    const locations = resolveLocations(parsedCities);
    const icsContent = generateIcsFeed(locations, tempUnit, requestedDays, showHazards, lang);

    try {
      cache.put(cacheKey, icsContent, 3600);
    } catch (cacheErr) {}

    const totalDuration = Date.now() - startTime;
    recordRequestTelemetry(locations.length, lang, totalDuration, false);

    return ContentService.createTextOutput(icsContent)
      .setMimeType(ContentService.MimeType.ICAL);

  } catch (error) {
    const errIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Meteor Feed Engine//EN",
      "BEGIN:VEVENT",
      `UID:error-${Date.now()}@meteor.engine`,
      `DTSTAMP:${formatIcsDateTime(new Date())}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(new Date())}`,
      "SUMMARY:⚠️ Weather Feed Error",
      `DESCRIPTION:${escapeIcs(error.toString())}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    return ContentService.createTextOutput(errIcs)
      .setMimeType(ContentService.MimeType.ICAL);
  }
}

// ==========================================================
// EXPANDED MULTILINGUAL DICTIONARY
// ==========================================================

const I18N = {
  en: {
    verifiedLog: "Verified Observation", groundTruth: "GROUND TRUTH (MEASURED)",
    thermalAtmo: "TEMPERATURE & COMFORT", celestialSpace: "SUN & CELESTIAL",
    airQuality: "AIR QUALITY & BIO", aggregates: "7-DAY ACCUMULATED",
    auditStability: "MODEL AUDIT", roadHazards: "ROAD SAFETY ADVISORY (<=7°C)",
    high: "High", low: "Low", feels: "Feels", wind: "Wind", rainChance: "Rain Chance",
    rainVol: "Rain", baro: "Barometer", sun: "Sun", daylight: "Daylight", golden: "Golden Hr", moon: "Moon",
    uv: "UV Index", waterLoss: "Evaporation (ET₀)", pollen: "Pollen Load",
    cumRain: "Rain Sum", meanTemp: "Mean Temp", gdd: "Growing Degree Days", meanAqi: "Mean AQI",
    tempError: "Temp Drift", rainError: "Rain Drift", status: "Status",
    historicalMae: "Lifetime MAE", reliability: "Reliability",
    pavement: "State", groundTemp: "Ground Temp", guidance: "Advisory",
    cleanAir: "Good", fairAir: "Fair", modAir: "Moderate", poorAir: "Poor", hazAir: "Hazardous",
    lowPollen: "Low / Minimal", dDay: "D-Day (Today)", pastDay: "Past",
    stableStatus: "🟢 Stable", modStatus: "🟡 Moderate Shift", erraticStatus: "🔴 High Drift"
  },
  zh: {
    verifiedLog: "历史实测数据", groundTruth: "实测基准 (地面真实值)",
    thermalAtmo: "温度与体感", celestialSpace: "太阳与天象",
    airQuality: "空气质量与生物负荷", aggregates: "7天累积走势",
    auditStability: "预测模型审计", roadHazards: "道路安全预警 (<=7°C)",
    high: "最高", low: "最低", feels: "体感", wind: "风速", rainChance: "降水概率",
    rainVol: "降水量", baro: "气压", sun: "日照", daylight: "昼长", golden: "黄金时刻", moon: "月相",
    uv: "紫外线指数", waterLoss: "蒸散量 (ET₀)", pollen: "花粉浓度",
    cumRain: "累计降水", meanTemp: "平均气温", gdd: "生长积温 GDD", meanAqi: "平均AQI",
    tempError: "温差偏移", rainError: "雨量偏差", status: "状态",
    historicalMae: "全期平均误差 MAE", reliability: "可靠度",
    pavement: "路面状态", groundTemp: "地表温度", guidance: "安全提示",
    cleanAir: "优", fairAir: "良", modAir: "中度", poorAir: "差", hazAir: "严重污染",
    lowPollen: "极低 / 无", dDay: "D日 (今天)", pastDay: "过去",
    stableStatus: "🟢 稳定", modStatus: "🟡 轻微漂移", erraticStatus: "🔴 显著偏差"
  },
  hi: {
    verifiedLog: "सत्यापित प्रेक्षण", groundTruth: "वास्तविक माप (ग्राउंड ट्रुथ)",
    thermalAtmo: "तापमान और आराम", celestialSpace: "सूर्य और खगोल",
    airQuality: "वायु गुणवत्ता और पराग", aggregates: "7-दिवसीय संचयी स्थिति",
    auditStability: "मॉडल ऑडिट और स्थिरता", roadHazards: "सड़क सुरक्षा चेतावनी (<=7°C)",
    high: "अधिकतम", low: "न्यूनतम", feels: "अनुभूत", wind: "हवा", rainChance: "बारिश की संभावना",
    rainVol: "बारिश", baro: "वायुदाब", sun: "सूर्य", daylight: "दिन की अवधि", golden: "गोल्डन आवर", moon: "चंद्रमा",
    uv: "यूवी इंडेक्स", waterLoss: "वाष्पीकरण (ET₀)", pollen: "पराग भार",
    cumRain: "कुल बारिश", meanTemp: "औसत तापमान", gdd: "डिग्री दिवस GDD", meanAqi: "औसत AQI",
    tempError: "तापमान अंतर", rainError: "वर्षा अंतर", status: "स्थिति",
    historicalMae: "ऐतिहासिक MAE", reliability: "विश्वसनीयता",
    pavement: "सड़क की स्थिति", groundTemp: "जमीनी तापमान", guidance: "सलाह",
    cleanAir: "उत्तम", fairAir: "संतोषजनक", modAir: "मध्यम", poorAir: "खराब", hazAir: "गंभीर",
    lowPollen: "कम / शून्य", dDay: "D-Day (आज)", pastDay: "पूर्व",
    stableStatus: "🟢 स्थिर", modStatus: "🟡 मध्यम बदलाव", erraticStatus: "🔴 उच्च बहाव"
  },
  es: {
    verifiedLog: "Observación Verificada", groundTruth: "DATOS REALES MEDIDOS",
    thermalAtmo: "TEMPERATURA Y SENSACIÓN", celestialSpace: "SOL Y ASTRONOMÍA",
    airQuality: "CALIDAD DEL AIRE Y BIO", aggregates: "ACUMULADOS 7 DÍAS",
    auditStability: "AUDITORÍA DEL MODELO", roadHazards: "AVISO DE SEGURIDAD VIAL (<=7°C)",
    high: "Máx", low: "Mín", feels: "Sensación", wind: "Viento", rainChance: "Prob. Lluvia",
    rainVol: "Lluvia", baro: "Barómetro", sun: "Sol", daylight: "Luz solar", golden: "Hora Dorada", moon: "Luna",
    uv: "Índice UV", waterLoss: "Evapotranspiración (ET₀)", pollen: "Nivel de Polen",
    cumRain: "Lluvia Total", meanTemp: "Temp Media", gdd: "Grados Día GDD", meanAqi: "AQI Medio",
    tempError: "Deriva Temp", rainError: "Deriva Lluvia", status: "Estado",
    historicalMae: "MAE Histórico", reliability: "Fiabilidad",
    pavement: "Calzada", groundTemp: "Temp Suelo", guidance: "Aviso",
    cleanAir: "Bueno", fairAir: "Aceptable", modAir: "Moderado", poorAir: "Malo", hazAir: "Peligroso",
    lowPollen: "Bajo / Mínimo", dDay: "D-Day (Hoy)", pastDay: "Pasado",
    stableStatus: "🟢 Estable", modStatus: "🟡 Desvío Moderado", erraticStatus: "🔴 Gran Desvío"
  },
  fr: {
    verifiedLog: "Observation Réelle Vérifiée", groundTruth: "DONNÉES RÉELLES MESURÉES",
    thermalAtmo: "TEMPÉRATURE & RESSENTI", celestialSpace: "SOLEIL & ASTRONOMIE",
    airQuality: "QUALITÉ DE L'AIR & BIO", aggregates: "CUMULS SUR 7 JOURS",
    auditStability: "PRÉCISION DU MODÈLE", roadHazards: "SÉCURITÉ ROUTIÈRE (<=7°C)",
    high: "Max", low: "Min", feels: "Ressenti", wind: "Vent", rainChance: "Risque Pluie",
    rainVol: "Pluie", baro: "Pression", sun: "Soleil", daylight: "Journée", golden: "Heure Dorée", moon: "Lune",
    uv: "Indice UV", waterLoss: "Évapotranspiration (ET₀)", pollen: "Charge Pollens",
    cumRain: "Pluie Cumulée", meanTemp: "Temp Moyenne", gdd: "Degrés Jours GDD", meanAqi: "Moyenne AQI",
    tempError: "Dérive Temp", rainError: "Dérive Pluie", status: "Statut",
    historicalMae: "MAE Historique", reliability: "Fiabilité",
    pavement: "État", groundTemp: "Temp au Sol", guidance: "Conseil",
    cleanAir: "Bon", fairAir: "Moyen", modAir: "Dégradé", poorAir: "Mauvais", hazAir: "Dangereux",
    lowPollen: "Faible / Minimal", dDay: "Jour J (Aujourd'hui)", pastDay: "Passé",
    stableStatus: "🟢 Stable", modStatus: "🟡 Modéré", erraticStatus: "🔴 Forte Dérive"
  },
  ar: {
    verifiedLog: "سجل الرصد المعتمد", groundTruth: "البيانات المقاسة فعلياً",
    thermalAtmo: "الحرارة والشعور الواقعي", celestialSpace: "الشمس والظواهر الفلكية",
    airQuality: "جودة الهواء واللقاح", aggregates: "التراكمات الأسبوعية",
    auditStability: "تقييم أداء النموذج", roadHazards: "تحذير سلامة الطرق (<=7°C)",
    high: "عظمى", low: "صغرى", feels: "المحسوسة", wind: "الرياح", rainChance: "فرصة الأمطار",
    rainVol: "كمية المطر", baro: "الضغط الجوي", sun: "الشمس", daylight: "طول النهار", golden: "الساعة الذهبية", moon: "القمر",
    uv: "مؤشر الأشعة UV", waterLoss: "البخر (ET₀)", pollen: "مستوى حبوب اللقاح",
    cumRain: "مجموع الأمطار", meanTemp: "متوسط الحرارة", gdd: "أيام النمو GDD", meanAqi: "متوسط الجودة AQI",
    tempError: "انحراف الحرارة", rainError: "انحراف الأمطار", status: "الحالة",
    historicalMae: "متوسط الخطأ التراكمي MAE", reliability: "الدقة والموثوقية",
    pavement: "حالة الطريق", groundTemp: "حرارة السطح", guidance: "إرشادات",
    cleanAir: "ممتاز", fairAir: "مقبول", modAir: "متوسط", poorAir: "رديء", hazAir: "خطير جداً",
    lowPollen: "منخفض / منعدم", dDay: "اليوم الحاسم (اليوم)", pastDay: "مضى",
    stableStatus: "🟢 ثابت ومستقر", modStatus: "🟡 تحول متوسط", erraticStatus: "🔴 انحراف حاد"
  },
  de: {
    verifiedLog: "Verifizierte Realdaten", groundTruth: "GEMESSENE REALDATEN",
    thermalAtmo: "TEMPERATUR & GEFÜHLT", celestialSpace: "SONNE & ASTRONOMIE",
    airQuality: "LUFTQUALITÄT & BIO", aggregates: "7-TAGE AKKUMULIERT",
    auditStability: "MODELLGENAUIGKEIT", roadHazards: "STRASSENZUSTAND (<=7°C)",
    high: "Max", low: "Min", feels: "Gefühlt", wind: "Wind", rainChance: "Regenrisiko",
    rainVol: "Regen", baro: "Luftdruck", sun: "Sonne", daylight: "Tageslicht", golden: "Goldene Std", moon: "Mond",
    uv: "UV-Index", waterLoss: "Verdunstung (ET₀)", pollen: "Pollenflug",
    cumRain: "Regensumme", meanTemp: "Mitteltemp", gdd: "Wachstumsgradtage", meanAqi: "Mittel AQI",
    tempError: "Temp Drift", rainError: "Regen Drift", status: "Status",
    historicalMae: "Historischer MAE", reliability: "Zuverlässigkeit",
    pavement: "Zustand", groundTemp: "Bodentemp", guidance: "Hinweis",
    cleanAir: "Gut", fairAir: "Mäßig", modAir: "Mittel", poorAir: "Schlecht", hazAir: "Sehr schlecht",
    lowPollen: "Gering / Minimal", dDay: "D-Day (Heute)", pastDay: "Vergangen",
    stableStatus: "🟢 Stabil", modStatus: "🟡 Mäßig", erraticStatus: "🔴 Hohe Drift"
  },
  nl: {
    verifiedLog: "Geverifieerde Waarneming", groundTruth: "WERKELIJK GEMETEN WAARDEN",
    thermalAtmo: "TEMPERATUUR & COMFORT", celestialSpace: "ZON & HEMELVERSCHIJNSELEN",
    airQuality: "LUCHTKWALITEIT & BIO", aggregates: "7-DAAGSE TOTALEN",
    auditStability: "MODELNAUWKEURIGHEID", roadHazards: "GLADHEIDSWAARSCHUWING (<=7°C)",
    high: "Max", low: "Min", feels: "Gevoel", wind: "Wind", rainChance: "Neerslagkans",
    rainVol: "Regen", baro: "Luchtdruk", sun: "Zon", daylight: "Daglicht", golden: "Gouden Uur", moon: "Maan",
    uv: "UV-Index", waterLoss: "Verdamping (ET₀)", pollen: "Pollenbelasting",
    cumRain: "Totale Regen", meanTemp: "Gem. Temp", gdd: "Groeidagen GDD", meanAqi: "Gem. LKI",
    tempError: "Temp Afwijking", rainError: "Regen Afwijking", status: "Status",
    historicalMae: "Historische MAE", reliability: "Betrouwbaarheid",
    pavement: "Wegdek", groundTemp: "Grondtemp (0cm)", guidance: "Advies",
    cleanAir: "Goed", fairAir: "Matig", modAir: "Voldoende", poorAir: "Onvoldoende", hazAir: "Gevaarlijk",
    lowPollen: "Laag / Minimaal", dDay: "D-Day (Vandaag)", pastDay: "Geleden",
    stableStatus: "🟢 Stabiel", modStatus: "🟡 Matige Verschuiving", erraticStatus: "🔴 Grote Afwijking"
  }
};

// ==========================================================
// ICS COMPILATION & AUDIT INTEGRATION
// ==========================================================

function generateIcsFeed(locations, unit, forecastDays, showHazards, lang) {
  const t = I18N[lang];
  const sym = unit === "celsius" ? "°" : "°F";
  const isC = unit === "celsius";
  const historyDays = 5;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayStr = Utilities.formatDate(now, "UTC", "yyyy-MM-dd");
  const dtstamp = formatIcsDateTime(new Date());

  const weatherMap = new Map();
  locations.forEach(loc => {
    weatherMap.set(norm(loc.name), fetchComprehensiveAtmosphericData(loc, unit, forecastDays, historyDays));
  });

  reconcileGroundTruth(locations, weatherMap);
  const globalStats = computeGlobalModelAccuracy(sym, t);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Autonomous Meteorological Dashboard//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Weather Forecast",
    "X-WR-TIMEZONE:UTC"
  ];

  locations.forEach(loc => {
    const cityKey = norm(loc.name);
    const data = weatherMap.get(cityKey);
    if (!data) return;

    for (let offset = -historyDays; offset < forecastDays; offset++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const targetDateStr = Utilities.formatDate(targetDate, "UTC", "yyyy-MM-dd");
      const icsDateStr = formatIcsDate(targetDate);

      const record = getDayRecord(cityKey, targetDateStr);
      const snapshots = record.snapshots || [];

      const astroEvent = getAstronomicalEvents(targetDateStr, lang);
      const moon = getMoonPhaseDetails(targetDate, lang);
      const aqMetrics = extractAirQualityDay(data.aq, targetDateStr);

      // Past Days (Ground Truth)
      if (offset < 0) {
        if (!data.det || !data.det.time) continue;
        const pastIdx = data.det.time.indexOf(targetDateStr);
        if (pastIdx === -1) continue;

        const actualMax = Math.round(data.det.temperature_2m_max[pastIdx]);
        const actualMin = Math.round(data.det.temperature_2m_min[pastIdx]);
        const actualRain = (data.det.precipitation_sum ? data.det.precipitation_sum[pastIdx] : 0) || 0;
        const actualCode = data.det.weathercode ? data.det.weathercode[pastIdx] : 0;

        const glyph = getWeatherGlyph(actualCode);
        const title = `${glyph} ${actualMax}${sym} ${loc.name}`;
        const audit = computeDayAudit(snapshots, actualMax, actualRain, aqMetrics.aqi, sym, t);

        const descLines = [
          `📍 ${loc.name} · ${t.verifiedLog}`,
          `📅 ${targetDateStr} (${Math.abs(offset)}d ago)`,
          ``,
          `📊 ${t.groundTruth}`,
          `• ${t.high}: ${actualMax}${sym} / ${actualMin}${sym}`,
          `• ${t.rainVol}: ${Number(actualRain).toFixed(1)} mm · Sky: ${glyph}`,
          aqMetrics.aqi !== null ? `• AQI: ${aqMetrics.aqi} ${getAqiGlyph(aqMetrics.aqi)}` : ``,
          astroEvent ? `✨ ${astroEvent}` : ``,
          ``,
          `🎯 ${t.auditStability}`,
          `• ${t.tempError}: ${audit.tempDelta}`,
          `• ${t.rainError}: ${audit.rainDelta}`,
          `• ${t.status}: ${audit.volatility}`,
          ``,
          `🌐 ${t.historicalMae}`,
          `• Temp: ${globalStats.tempMAE} · Rain: ${globalStats.rainMAE}`,
          `• ${t.reliability}: ${globalStats.modelGrade}`
        ].filter(Boolean);

        appendVEvent(lines, loc, targetDateStr, icsDateStr, dtstamp, title, descLines.join("\n"));
        continue;
      }

      // Future & Today
      let currentMax = null, currentMin = null, apparentMax = null;
      let currentRain = 0, currentWind = 0, rainProb = 0;
      let uv = 0, et0 = 0, pressure = 1015, soilMin = 10;
      let sunStr = "--:--", sunsetStr = "--:--", daylightFormatted = "--";
      let title = "", certaintyGlyph = "", spreadVal = 0, modelLabel = "";

      // Deterministic Blend (Days 0..13)
      if (offset < 14 && data.det && data.det.time) {
        const idx = data.det.time.indexOf(targetDateStr);
        if (idx !== -1) {
          currentMax = Math.round(data.det.temperature_2m_max[idx]);
          currentMin = Math.round(data.det.temperature_2m_min[idx]);
          apparentMax = data.det.apparent_temperature_max ? Math.round(data.det.apparent_temperature_max[idx]) : currentMax;
          currentRain = data.det.precipitation_sum ? data.det.precipitation_sum[idx] : 0;
          rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[idx] : 0;
          currentWind = data.det.windspeed_10m_max ? Math.round(data.det.windspeed_10m_max[idx]) : 0;
          uv = data.det.uv_index_max ? data.det.uv_index_max[idx] : 0;
          et0 = data.det.et0_fao_evapotranspiration ? data.det.et0_fao_evapotranspiration[idx] : 0;

          if (data.hourlyAgg && data.hourlyAgg[targetDateStr]) {
            pressure = data.hourlyAgg[targetDateStr].pressure || 1015;
            soilMin = data.hourlyAgg[targetDateStr].soilMin !== null ? data.hourlyAgg[targetDateStr].soilMin : currentMin;
          } else {
            soilMin = currentMin;
          }

          if (data.det.sunrise && data.det.sunset) {
            sunStr = data.det.sunrise[idx].slice(11, 16);
            sunsetStr = data.det.sunset[idx].slice(11, 16);
            const rDate = new Date(data.det.sunrise[idx]);
            const sDate = new Date(data.det.sunset[idx]);
            const dMins = Math.round((sDate - rDate) / 60000);
            daylightFormatted = `${Math.floor(dMins / 60)}h ${dMins % 60}m`;
          }

          certaintyGlyph = getWeatherGlyph(data.det.weathercode[idx]);
          title = `${certaintyGlyph} ${currentMax}${sym} ${loc.name}`;
          modelLabel = `High-Res Deterministic (D-${offset === 0 ? "Day" : offset})`;
        }
      } else if (offset >= 14 && data.ens && data.ens.time) {
        // NOAA Ensemble (Days 14..30)
        const idx = data.ens.time.indexOf(targetDateStr);
        if (idx !== -1) {
          const maxKeys = Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_max"));
          const minKeys = Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_min"));
          const maxVals = maxKeys.map(k => data.ens[k][idx]).filter(v => v !== null && !isNaN(v));
          const minVals = minKeys.map(k => data.ens[k][idx]).filter(v => v !== null && !isNaN(v));

          if (maxVals.length > 0) {
            currentMax = Math.round(maxVals.reduce((a, b) => a + b, 0) / maxVals.length);
            currentMin = Math.round(minVals.reduce((a, b) => a + b, 0) / minVals.length);
            apparentMax = currentMax;
            const variance = maxVals.reduce((a, b) => a + Math.pow(b - currentMax, 2), 0) / maxVals.length;
            spreadVal = Math.max(1, Math.round(Math.sqrt(variance)));
            certaintyGlyph = spreadVal <= 2 ? "🎯" : (spreadVal <= 4 ? "⚖️" : "🎲");
            currentRain = (data.ens.precipitation_sum ? data.ens.precipitation_sum[idx] : 0) || 0;
            soilMin = currentMin;
            title = `${certaintyGlyph} ~${currentMax}${sym} ${loc.name} (±${spreadVal}${sym})`;
            modelLabel = `NOAA GFS 31-Member Ensemble (D-${offset})`;
          }
        }
      }

      if (currentMax === null) continue;

      const hasRecordedToday = snapshots.some(s => s.recordedOn === todayStr);
      if (!hasRecordedToday) {
        snapshots.push({
          recordedOn: todayStr,
          daysBeforeDDay: offset,
          predictedMax: currentMax,
          predictedRain: Number(currentRain || 0),
          predictedAqi: aqMetrics.aqi
        });
        record.snapshots = snapshots;
        saveDayRecord(cityKey, targetDateStr, record);
      }

      const drift = computeDayAudit(snapshots, currentMax, currentRain, aqMetrics.aqi, sym, t);
      const aggregates = computeMultiDayAggregates(data, offset, isC);

      const tempMinC = isC ? currentMin : (currentMin - 32) * (5 / 9);
      const renderRoadHazards = showHazards && tempMinC <= 7;

      const descLines = [
        `📍 ${loc.name}`,
        `📅 ${offset === 0 ? t.dDay : `D-${offset}`} · ${targetDateStr}`,
        ``,
        `🌡️ ${t.thermalAtmo}`,
        `• ${t.high}: ${currentMax}${sym} / ${currentMin}${sym}`,
        `• ${t.feels}: ~${apparentMax}${sym}`,
        offset >= 14
          ? `• Spread: ±${spreadVal}${sym}`
          : `• ${t.rainVol}: ${Number(currentRain).toFixed(1)} mm (${rainProb}%)`,
        offset < 14 ? `• ${t.wind}: ${currentWind} km/h · ${pressure} hPa` : ``,
        ``,
        `☀️ ${t.celestialSpace}`,
        astroEvent ? `✨ ${astroEvent}` : ``,
        `• ${t.sun}: 🌅 ${sunStr} – 🌇 ${sunsetStr}`,
        `• ${t.daylight}: ${daylightFormatted}`,
        `• ${t.golden}: ~${getGoldenHourWindow(sunsetStr)}`,
        `• ${t.moon}: ${moon.glyph} ${moon.name} (${moon.illumination})`,
        uv > 0 ? `• ${t.uv}: ${uv.toFixed(1)}` : ``,
        et0 > 0 ? `• ${t.waterLoss}: ${et0.toFixed(1)} mm` : ``,
        ``,
        `🧪 ${t.airQuality}`,
        aqMetrics.aqi !== null ? `• AQI: ${aqMetrics.aqi} ${getAqiGlyph(aqMetrics.aqi)} (${getAqiLabel(aqMetrics.aqi, t)})` : ``,
        aqMetrics.pm25 !== null ? `• PM2.5: ${aqMetrics.pm25} · PM10: ${aqMetrics.pm10 || "--"} µg/m³` : ``,
        aqMetrics.pollen > 0 ? `• ${t.pollen}: ${aqMetrics.pollen} gr/m³` : `• ${t.pollen}: ${t.lowPollen}`,
        ``,
        `📅 ${t.aggregates}`,
        `• ${t.cumRain}: ${aggregates.sevenDayRain} mm`,
        `• ${t.meanTemp}: ${aggregates.sevenDayMeanTemp}${sym}`,
        `• ${t.gdd}: ${aggregates.sevenDayGDD} GDD`,
        `• ${t.meanAqi}: ${aggregates.sevenDayAqi}`,
        ``,
        `📉 ${t.auditStability}`,
        `• ${t.tempError}: ${drift.tempDelta}`,
        `• ${t.rainError}: ${drift.rainDelta}`,
        `• ${t.historicalMae}: ${globalStats.tempMAE}`
      ];

      if (renderRoadHazards) {
        const road = assessRoadConditions(currentMin, soilMin, currentRain, isC, lang);
        descLines.push(
          ``,
          `🚗 ${t.roadHazards}`,
          `• ${t.pavement}: ${road.status}`,
          `• ${t.groundTemp}: ${Math.round(soilMin)}${sym}`,
          `• ${t.guidance}: ${road.advisory}`
        );
      }

      descLines.push(
        ``,
        `💡 ${getAdvice(currentMax, rainProb, currentRain, currentWind, aqMetrics.aqi, isC, t)}`,
        `ℹ️ Engine: ${modelLabel}`
      );

      appendVEvent(lines, loc, targetDateStr, icsDateStr, dtstamp, title, descLines.filter(Boolean).join("\n"));
    }
  });

  lines.push("END:VCALENDAR");
  cleanupOldStorageKeys();
  return lines.join("\r\n");
}

function appendVEvent(lines, loc, targetDateStr, icsDateStr, dtstamp, title, description) {
  const uid = `weather-${loc.lat.toFixed(2)}-${loc.lon.toFixed(2)}-${targetDateStr}@meteor.engine`;
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${dtstamp}`);
  lines.push(`DTSTART;VALUE=DATE:${icsDateStr}`);
  lines.push(`DTEND;VALUE=DATE:${icsDateStr}`);
  lines.push(`SUMMARY:${escapeIcs(title)}`);
  lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  lines.push("TRANSP:TRANSPARENT");
  lines.push("END:VEVENT");
}

// ==========================================================
// AIR QUALITY EXTRACTION
// ==========================================================

function extractAirQualityDay(aqData, targetDateStr) {
  const result = { aqi: null, pm25: null, pm10: null, o3: null, pollen: 0 };
  if (!aqData) return result;

  if (aqData.daily && aqData.daily.time) {
    const idx = aqData.daily.time.indexOf(targetDateStr);
    if (idx !== -1) {
      if (aqData.daily.european_aqi) result.aqi = Math.round(aqData.daily.european_aqi[idx]);
      if (aqData.daily.pm2_5) result.pm25 = Number(aqData.daily.pm2_5[idx].toFixed(1));
      if (aqData.daily.pm10) result.pm10 = Number(aqData.daily.pm10[idx].toFixed(1));
      if (aqData.daily.ozone) result.o3 = Math.round(aqData.daily.ozone[idx]);
      const birch = aqData.daily.birch_pollen ? aqData.daily.birch_pollen[idx] : 0;
      const grass = aqData.daily.grass_pollen ? aqData.daily.grass_pollen[idx] : 0;
      const alder = aqData.daily.alder_pollen ? aqData.daily.alder_pollen[idx] : 0;
      result.pollen = Math.round(Math.max(birch, grass, alder));
      return result;
    }
  }

  const hourly = aqData.hourly || aqData;
  if (hourly && hourly.time) {
    let aqiSum = 0, pm25Sum = 0, pm10Sum = 0, o3Sum = 0, count = 0, maxPollen = 0;
    for (let i = 0; i < hourly.time.length; i++) {
      if (hourly.time[i].startsWith(targetDateStr)) {
        count++;
        if (hourly.european_aqi && hourly.european_aqi[i] !== null) aqiSum += hourly.european_aqi[i];
        if (hourly.pm2_5 && hourly.pm2_5[i] !== null) pm25Sum += hourly.pm2_5[i];
        if (hourly.pm10 && hourly.pm10[i] !== null) pm10Sum += hourly.pm10[i];
        if (hourly.ozone && hourly.ozone[i] !== null) o3Sum += hourly.ozone[i];

        const birch = hourly.birch_pollen ? (hourly.birch_pollen[i] || 0) : 0;
        const grass = hourly.grass_pollen ? (hourly.grass_pollen[i] || 0) : 0;
        const alder = hourly.alder_pollen ? (hourly.alder_pollen[i] || 0) : 0;
        const pVal = Math.max(birch, grass, alder);
        if (pVal > maxPollen) maxPollen = pVal;
      }
    }
    if (count > 0) {
      result.aqi = Math.round(aqiSum / count);
      result.pm25 = Number((pm25Sum / count).toFixed(1));
      result.pm10 = Number((pm10Sum / count).toFixed(1));
      result.o3 = Math.round(o3Sum / count);
      result.pollen = Math.round(maxPollen);
    }
  }

  return result;
}

// ==========================================================
// DATA FETCHING (Separated Daily / Hourly)
// ==========================================================

function fetchComprehensiveAtmosphericData(loc, unit, forecastDays, historyDays) {
  const result = { det: null, ens: null, aq: null, hourlyAgg: {} };
  const detDays = Math.min(14, forecastDays);

  try {
    const dUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weathercode,precipitation_sum,precipitation_probability_max,windspeed_10m_max,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration,shortwave_radiation_sum&temperature_unit=${unit}&forecast_days=${detDays}&past_days=${historyDays + 1}&timezone=auto`;
    const dRes = UrlFetchApp.fetch(dUrl, { muteHttpExceptions: true });
    if (dRes.getResponseCode() === 200) result.det = JSON.parse(dRes.getContentText()).daily;

    const hUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=pressure_msl,soil_temperature_0cm&temperature_unit=${unit}&forecast_days=${detDays}&past_days=${historyDays + 1}&timezone=auto`;
    const hRes = UrlFetchApp.fetch(hUrl, { muteHttpExceptions: true });
    if (hRes.getResponseCode() === 200) {
      const hData = JSON.parse(hRes.getContentText()).hourly;
      if (hData && hData.time) {
        const aggs = {};
        for (let i = 0; i < hData.time.length; i++) {
          const dStr = hData.time[i].slice(0, 10);
          if (!aggs[dStr]) aggs[dStr] = { p: [], s: [] };
          if (hData.pressure_msl && hData.pressure_msl[i] !== null) aggs[dStr].p.push(hData.pressure_msl[i]);
          if (hData.soil_temperature_0cm && hData.soil_temperature_0cm[i] !== null) aggs[dStr].s.push(hData.soil_temperature_0cm[i]);
        }
        Object.keys(aggs).forEach(dStr => {
          result.hourlyAgg[dStr] = {
            pressure: aggs[dStr].p.length > 0 ? Math.round(aggs[dStr].p.reduce((a, b) => a + b, 0) / aggs[dStr].p.length) : 1015,
            soilMin: aggs[dStr].s.length > 0 ? Math.min(...aggs[dStr].s) : null
          };
        });
      }
    }

    if (forecastDays > 14) {
      const eUrl = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=gfs_seamless&forecast_days=${forecastDays}&temperature_unit=${unit}&timezone=auto`;
      const eRes = UrlFetchApp.fetch(eUrl, { muteHttpExceptions: true });
      if (eRes.getResponseCode() === 200) result.ens = JSON.parse(eRes.getContentText()).daily;
    }

    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&hourly=european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,alder_pollen,birch_pollen,grass_pollen&forecast_days=${detDays}&past_days=${historyDays + 1}&timezone=auto`;
    const aqRes = UrlFetchApp.fetch(aqUrl, { muteHttpExceptions: true });
    if (aqRes.getResponseCode() === 200) result.aq = JSON.parse(aqRes.getContentText());

  } catch (e) {
    Logger.log("Fetch fail: " + e);
  }

  return result;
}

// ==========================================================
// TELEMETRY & RECONCILIATION HELPERS
// ==========================================================

function reconcileGroundTruth(locations, weatherMap) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  locations.forEach(loc => {
    const cityKey = norm(loc.name);
    const data = weatherMap.get(cityKey);
    if (!data || !data.det || !data.det.time) return;

    for (let i = 0; i < data.det.time.length; i++) {
      const dateStr = data.det.time[i];
      const targetDate = new Date(dateStr + "T00:00:00");

      if (targetDate < today) {
        const record = getDayRecord(cityKey, dateStr);
        if (record && !record.actual) {
          const maxT = data.det.temperature_2m_max[i];
          const minT = data.det.temperature_2m_min[i];
          const rain = data.det.precipitation_sum ? data.det.precipitation_sum[i] : 0;
          const aqMetrics = extractAirQualityDay(data.aq, dateStr);

          if (maxT !== null && maxT !== undefined) {
            record.actual = {
              maxTemp: Math.round(maxT),
              minTemp: Math.round(minT),
              rain: Number(rain || 0),
              aqi: aqMetrics.aqi,
              weatherCode: data.det.weathercode ? data.det.weathercode[i] : 0
            };
            saveDayRecord(cityKey, dateStr, record);
          }
        }
      }
    }
  });
}

function computeGlobalModelAccuracy(sym, t) {
  const props = PropertiesService.getScriptProperties().getProperties();
  let totalTempError = 0, totalRainError = 0, verifiedSnapshots = 0;

  Object.keys(props).forEach(k => {
    if (!k.startsWith("WTR_v10_")) return;
    try {
      const record = JSON.parse(props[k]);
      if (record && record.actual && Array.isArray(record.snapshots)) {
        const actMax = record.actual.maxTemp;
        const actRain = record.actual.rain;

        record.snapshots.forEach(snap => {
          totalTempError += Math.abs(snap.predictedMax - actMax);
          totalRainError += Math.abs((snap.predictedRain || 0) - actRain);
          verifiedSnapshots++;
        });
      }
    } catch (e) {}
  });

  if (verifiedSnapshots === 0) {
    return { tempMAE: "Calibrating", rainMAE: "Calibrating", modelGrade: "A" };
  }

  const avgTempMAE = (totalTempError / verifiedSnapshots).toFixed(1);
  const avgRainMAE = (totalRainError / verifiedSnapshots).toFixed(1);
  const grade = avgTempMAE <= 1.5 ? "A+" : (avgTempMAE <= 2.5 ? "A" : "B");

  return {
    tempMAE: `±${avgTempMAE}${sym}`,
    rainMAE: `±${avgRainMAE} mm`,
    modelGrade: grade
  };
}

function computeDayAudit(snapshots, baselineMax, baselineRain, baselineAqi, sym, t) {
  if (!snapshots || snapshots.length <= 1) {
    return { tempDelta: "±0" + sym, rainDelta: "0.0 mm", volatility: t.stableStatus };
  }

  let maxTempDiff = 0, tempDeltaStr = "±0" + sym;
  let maxRainDiff = 0, rainDeltaStr = "0.0 mm";

  snapshots.forEach(snap => {
    const tDiff = snap.predictedMax - baselineMax;
    const lead = snap.daysBeforeDDay !== undefined ? snap.daysBeforeDDay : (snap.daysAgoLogged || 0);
    const label = lead === 0 ? "D-Day" : `D-${lead}`;

    if (Math.abs(tDiff) > Math.abs(maxTempDiff)) {
      maxTempDiff = tDiff;
      tempDeltaStr = `${tDiff > 0 ? "+" : ""}${tDiff}${sym} (${label})`;
    }
    const rDiff = (snap.predictedRain || 0) - baselineRain;
    if (Math.abs(rDiff) > Math.abs(maxRainDiff)) {
      maxRainDiff = rDiff;
      rainDeltaStr = `${rDiff > 0 ? "+" : ""}${rDiff.toFixed(1)} mm (${label})`;
    }
  });

  const absT = Math.abs(maxTempDiff);
  const volatility = absT >= 5 ? t.erraticStatus : (absT >= 3 ? t.modStatus : t.stableStatus);
  return { tempDelta: tempDeltaStr, rainDelta: rainDeltaStr, volatility: volatility };
}

function getDayRecord(cityKey, dateStr) {
  const key = `WTR_v10_${cityKey}_${dateStr}`;
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return { snapshots: [] };
  try { return JSON.parse(raw); } catch (e) { return { snapshots: [] }; }
}

function saveDayRecord(cityKey, dateStr, record) {
  const key = `WTR_v10_${cityKey}_${dateStr}`;
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(record));
}

function cleanupOldStorageKeys() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const cutoffStr = Utilities.formatDate(cutoff, "UTC", "yyyy-MM-dd");

  Object.keys(all).forEach(k => {
    if (k.startsWith("WTR_v10_")) {
      const parts = k.split("_");
      const dateStr = parts[parts.length - 1];
      if (dateStr < cutoffStr) props.deleteProperty(k);
    }
  });
}

function recordRequestTelemetry(citiesCount, lang, processingMs, wasCached) {
  try {
    const props = PropertiesService.getScriptProperties();
    const weekKey = getWeekIdentifier();
    const raw = props.getProperty(weekKey);
    const data = raw ? JSON.parse(raw) : { requests: 0, cachedHits: 0, totalCities: 0, totalMs: 0, langs: {} };
    data.requests += 1;
    if (wasCached) data.cachedHits += 1;
    data.totalCities += citiesCount;
    data.totalMs += processingMs;
    data.langs[lang] = (data.langs[lang] || 0) + 1;
    props.setProperty(weekKey, JSON.stringify(data));
  } catch (e) {}
}

function getLiveTelemetryStatus() {
  return { status: "HEALTHY", timestamp: new Date().toISOString() };
}

function getWeekIdentifier() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `TEL_${d.getFullYear()}_W${weekNo}`;
}

function resolveLocations(cityNames) {
  const resolved = [];
  cityNames.forEach(rawName => {
    const clean = rawName.trim();
    const key = clean.toLowerCase();
    if (key.startsWith("brun")) {
      resolved.push({ name: "Brunssum", lat: 50.9458, lon: 5.9722 });
      return;
    }
    if (key === "hasselt") {
      resolved.push({ name: "Hasselt", lat: 50.9311, lon: 5.3378 });
      return;
    }
    try {
      const res = UrlFetchApp.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=1&format=json`, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const data = JSON.parse(res.getContentText()).results;
        if (data && data.length > 0) resolved.push({ name: data[0].name, lat: data[0].latitude, lon: data[0].longitude });
      }
    } catch (e) {}
  });
  return resolved.length > 0 ? resolved : [{ name: "Brunssum", lat: 50.9458, lon: 5.9722 }];
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
      totalRain += r; totalMax += maxT; totalMin += minT;
      const base10 = isC ? 10 : 50;
      const meanT = (maxT + minT) / 2;
      if (meanT > base10) gddSum += (meanT - base10);
      wDays++;
    }
  }
  return {
    sevenDayRain: totalRain.toFixed(1),
    sevenDayMeanTemp: wDays > 0 ? ((totalMax + totalMin) / (wDays * 2)).toFixed(1) : "--",
    sevenDayGDD: Math.round(gddSum),
    sevenDayAqi: "--"
  };
}

function assessRoadConditions(tMin, soilMin, rainVol, isC, lang) {
  const groundC = isC ? soilMin : (soilMin - 32) * (5 / 9);
  if (groundC <= 0 && rainVol > 0.2) return { status: "🧊 Black Ice Hazard", advisory: "Pavement glazed. High stopping distance." };
  if (groundC <= 0) return { status: "❄️ Ground Frost", advisory: "Rime frost on bridges and uninsulated overpasses." };
  return { status: "🚗 Chilled Asphalt", advisory: "Hardened rubber below 7°C; winter tires recommended." };
}

function getAstronomicalEvents(dateStr, lang) {
  const md = dateStr.slice(5);
  const events = {
    en: {
      "01-03": "Quadrantid Meteor Peak", "03-20": "🌱 Vernal Equinox",
      "04-22": "Lyrid Meteor Peak", "05-06": "Eta Aquariids",
      "06-21": "☀️ Summer Solstice", "08-12": "Perseid Meteor Peak",
      "09-22": "🍂 Autumnal Equinox", "10-21": "Orionid Meteor Peak",
      "11-17": "Leonid Meteor Peak", "12-14": "Geminid Meteor Peak",
      "12-21": "❄️ Winter Solstice"
    },
    zh: {
      "01-03": "象限仪座流星雨极大期", "03-20": "🌱 春分",
      "04-22": "天琴座流星雨极大期", "05-06": "宝瓶座η流星雨",
      "06-21": "☀️ 夏至", "08-12": "英仙座流星雨极大期",
      "09-22": "🍂 秋分", "10-21": "猎户座流星雨极大期",
      "11-17": "狮子座流星雨极大期", "12-14": "双子座流星雨极大期",
      "12-21": "❄️ 冬至"
    },
    es: {
      "01-03": "Pico de Cuadrántidas", "03-20": "🌱 Equinoccio de Primavera",
      "04-22": "Pico de Líridas", "05-06": "Eta Acuáridas",
      "06-21": "☀️ Solsticio de Verano", "08-12": "Pico de Perseidas",
      "09-22": "🍂 Equinoccio de Otoño", "10-21": "Pico de Oriónidas",
      "11-17": "Pico de Leónidas", "12-14": "Pico de Gemínidas",
      "12-21": "❄️ Solsticio de Invierno"
    }
  };
  const list = events[lang] || events.en;
  return list[md] || null;
}

function getMoonPhaseDetails(date, lang) {
  const lp = 2551443;
  const now = date.getTime();
  const newMoonRef = new Date(1970, 0, 7, 20, 35, 0).getTime();
  const phase = ((now - newMoonRef) / 1000) % lp;
  const day = Math.floor(phase / (24 * 3600));

  let glyph = "🌑", name = "New Moon", fraction = 0.02;
  if (day <= 1 || day >= 28) { glyph = "🌑"; name = "New Moon"; fraction = 0.02; }
  else if (day <= 6) { glyph = "🌒"; name = "Waxing Crescent"; fraction = 0.25; }
  else if (day <= 9) { glyph = "🌓"; name = "1st Quarter"; fraction = 0.50; }
  else if (day <= 13) { glyph = "🌔"; name = "Waxing Gibbous"; fraction = 0.75; }
  else if (day <= 16) { glyph = "🌕"; name = "Full Moon"; fraction = 0.99; }
  else if (day <= 20) { glyph = "🌖"; name = "Waning Gibbous"; fraction = 0.75; }
  else if (day <= 23) { glyph = "🌗"; name = "Last Quarter"; fraction = 0.50; }
  else { glyph = "🌘"; name = "Waning Crescent"; fraction = 0.25; }
  return { glyph, name, fraction, illumination: `${Math.round(fraction * 100)}%` };
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

function getAqiGlyph(aqi) {
  if (aqi === null) return "🍃";
  if (aqi <= 20) return "🟢";
  if (aqi <= 40) return "🟡";
  if (aqi <= 60) return "🟠";
  if (aqi <= 80) return "🔴";
  return "🟣";
}

function getAqiLabel(aqi, t) {
  if (aqi === null) return "--";
  if (aqi <= 20) return t.cleanAir;
  if (aqi <= 40) return t.fairAir;
  if (aqi <= 60) return t.modAir;
  if (aqi <= 80) return t.poorAir;
  return t.hazAir;
}

function getAdvice(t, pProb, pVol, wind, aqi, isC, dict) {
  const c = isC ? t : (t - 32) * (5 / 9);
  const out = [];
  if (aqi && aqi >= 60) out.push("Mask recommended 😷");
  if (pProb >= 50 || pVol >= 2) out.push("Umbrella ☔");
  if (wind >= 35) out.push("Gusty 💨");
  if (c <= 2) out.push("Coat 🧤");
  else if (c <= 12) out.push("Jacket 🧥");
  else if (c >= 27) out.push("Hydrate 🧢");
  return out.length ? out.join(" · ") : "Optimal ✨";
}

function norm(str) {
  if (!str) return "";
  const s = str.toLowerCase().trim();
  return s.startsWith("brun") ? "brunssum" : s;
}

function formatIcsDate(d) {
  return Utilities.formatDate(d, "UTC", "yyyyMMdd");
}

function formatIcsDateTime(d) {
  return Utilities.formatDate(d, "UTC", "yyyyMMdd'T'HHmmss'Z'");
}

function escapeIcs(str) {
  if (!str) return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
