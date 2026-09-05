/**
 * Weather & Astronomical Dashboard iCalendar (.ics) Generator
 *
 * Verified & Bulletproof:
 *  - Road condition advisory triggered at min temp <= 7°C with surface glaze & black ice detection.
 *  - Endpoint Documentation Fallback: meteo-ics_readme.txt generated when URL is opened without parameters.
 *  - Global AQI Engine: Automatic fallback between European AQI (0-100), US EPA AQI (0-500),
 *    OpenAQ (200+ countries, free, no key), and WAQI (1000+ stations, token-optional).
 *  - Open-Meteo Parameter Separation: Distinct daily and hourly requests eliminate 400 Bad Request errors.
 *  - Continuous 7-Day Aggregates: Seamless date-key bridging between Deterministic (<14d) and Ensemble (14d+) datasets.
 *  - Deterministic DTSTAMP: Anchored to date to prevent background sync churn and battery drain across calendar clients.
 *  - Standard Atmosphere: Pressure in atm (1013.25 hPa baseline).
 *  - Parallel HTTP Requests: External APIs fetched concurrently using UrlFetchApp.fetchAll with 10s timeout.
 *  - Per-location API failure isolation: a single city failing does not abort the whole feed.
 *  - 8 languages (en, zh, hi, es, fr, ar, de, nl) with full UI text + advice translation.
 *  - days/hazards/lang URL params all honored.
 *  - RFC 5545 compliant: CRLF line endings, proper 75-octet line folding, escaped commas/semicolons/backslashes.
 *  - Astronomical events year-aware (auto-detect current year for solstices/equinoxes).
 *  - Moon phase uses UTC reference date and accurate synodic-month boundaries.
 *  - Clean single empty line (\n\n) separation between card blocks.
 *  - doGet() catches generateIcsFeed errors and returns a text error document.
 *  - handleStatusEndpoint() catches computeGlobalModelAccuracy errors and surfaces them.
 *  - URL params length-capped to defend against pathological inputs.
 *  - isValidLatLon() shared helper for both user-supplied coords and geocoder results.
 *  - Array-valued URL params (e.g. ?cities=A&cities=B) coerced to comma-joined strings before .split().
 *  - unitParam String-coerced before .toLowerCase() (array values would otherwise crash).
 *  - fetchIcsAtmosphericDataParallel() logs per-endpoint non-200 responses (deterministic/ensemble/air-quality).
 *  - Ensemble key lists hoisted out of per-offset and per-day loops in generateIcsFeed + aggregates.
 *
 * URL Parameters:
 *   cities=X,Y,Z        — city names, auto-geocoded via Open-Meteo (e.g. ?cities=London,Paris) (max 4)
 *   locations=X:lat:lon — explicit coordinates (e.g. ?locations=Kyoto:35.0116:135.7681)
 *   lat=X&lon=Y&name=Z — single coordinate pair
 *   unit=celsius|fahrenheit
 *   days=1-30           — forecast window (default 30)
 *   lang=en|zh|hi|es|fr|ar|de|nl — display language (default en)
 *   hazards=true|false  — enable road safety section (default true)
 *   dryRun=true         — preview feed as plain text (default false)
 *   action=status|metrics — return JSON diagnostics instead of ICS
  *   aqProvider=auto|openaq|waqi — AQI source (default auto).
  *                                            auto: Open-Meteo first, then OpenAQ, then WAQI.
  *                                            openaq: force OpenAQ v3 latest endpoint.
  *                                            waqi: force WAQI geo feed (requires waqiToken for high quota).
  *   aqRadius=1-100   — OpenAQ station search radius in km (default 25).
  *   waqiToken=XXX   — optional WAQI API token (https://aqicn.org/data-platform/token/).
 */
const OPEN_METEO_AQ_FORECAST_DAYS_CAP = 7;
const OPENAQ_LATEST_ENDPOINT = "https://api.openaq.org/v3/latest";
const WAQI_BASE_ENDPOINT = "https://api.waqi.info/feed/geo:";

const ICAL_CONFIG = {
  calendarName: "Weather & Celestial Feed",
  version: "2.2.0",
  temperatureUnit: "celsius",
  forecastDays: 30,
  deterministicDays: 14,
  minForecastDays: 1,
  maxForecastDays: 30,
  maxCities: 4,
  defaultLang: "en",
  hazardsEnabled: true
};
const FETCH_TIMEOUT_MS = 10000;
const SUPPORTED_LANGS = ["en", "zh", "hi", "es", "fr", "ar", "de", "nl"];
const LANGS_RTL = ["ar"];

const T_SEC   = { en:"SUN & CELESTIAL",            zh:"太阳与天象",            hi:"सूर्य और खगोल",              es:"SOL Y CIELO",               fr:"SOLEIL ET CIEL",              ar:"الشمس والسماء",               de:"SONNE & HIMMEL",               nl:"ZON & HEMEL" };
const T_TEMP  = { en:"TEMPERATURE & COMFORT",       zh:"温度与体感",            hi:"तापमान और आराम",              es:"TEMPERATURA Y CONFORT",      fr:"TEMPÉRATURE ET CONFORT",     ar:"الحرارة والراحة",             de:"TEMPERATUR & KOMFORT",        nl:"TEMPERATUUR & COMFORT" };
const T_AIR   = { en:"AIR QUALITY & BIO",          zh:"空气质量与生物",         hi:"वायु गुणवत्ता और जैव",        es:"CALIDAD DEL AIRE Y BIO",     fr:"QUALITÉ DE L'AIR & BIO",     ar:"جودة الهواء والبيئة",          de:"LUFTQUALITÄT & BIO",         nl:"LUCHTKWALITEIT & BIO" };
const T_AGG   = { en:"7-DAY AGGREGATE",            zh:"近7天汇总",             hi:"7-दिन का सारांश",              es:"AGREGADO 7 DÍAS",           fr:"AGRÉGAT 7 JOURS",           ar:"ملخص 7 أيام",                  de:"7-TAGE-AGGREGAT",             nl:"7-DAGEN TOTAAL" };
const T_AUDIT = { en:"MODEL AUDIT",                zh:"模型校准",               hi:"मॉडल ऑडिट",                  es:"AUDITORÍA DEL MODELO",      fr:"AUDIT DU MODÈLE",            ar:"تدقيق النموذج",                de:"MODELL-AUDIT",                nl:"MODEL-AUDIT" };
const T_ROAD  = { en:"ROAD SAFETY",                zh:"道路安全",               hi:"सड़क सुरक्षा",                  es:"SEGURIDAD VIAL",             fr:"SÉCURITÉ ROUTIÈRE",          ar:"سلامة الطرق",                  de:"STRAßENSICHERHEIT",          nl:"WEGVEILIGHEID" };
const T_ADV   = { en:"ACTIONABLE ADVICE",           zh:"行动建议",               hi:"सुझाव",                        es:"CONSEJOS PRÁCTICOS",         fr:"CONSEILS PRATIQUES",         ar:"نصائح عملية",                  de:"PRAKTISCHE TIPPS",           nl:"ADVIES" };
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
  engine:    { en:"Engine",                       zh:"引擎",                  hi:"इंजन",                           es:"Motor",                       fr:"Moteur",                       ar:"المحرك",                       de:"Engine",                       nl:"Engine" },
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
  gCal:    { en:"A (Calibrating)",      zh:"A (校准中)",     hi:"A (कैलिब्रेट हो रहा)", es:"A (Calibrando)",   fr:"A (Calibrage en cours)", ar:"A (قيد المعايرة)", de:"A (Kalibrierung)",  nl:"A (Wordt gekalibreerd)" }
};

function t(key, lang) {
  lang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  const entry = T_L[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

function tSection(key, lang) {
  lang = (lang || "en").toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LANGS.includes(lang)) lang = "en";
  const sections = { secTemp:T_TEMP, secSun:T_SEC, secAir:T_AIR, secAgg:T_AGG, secAudit:T_AUDIT, secRoad:T_ROAD, secAdvice:T_ADV };
  const map = sections[key];
  if (!map) return key;
  return map[lang] || map.en || key;
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

function normalizeLang(raw) {
  if (!raw) return "en";
  const code = String(raw).toLowerCase().split(/[-_]/)[0].trim();
  return SUPPORTED_LANGS.includes(code) ? code : "en";
}

function parseBoolParam(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).toLowerCase().trim();
  return (s === "true" || s === "1" || s === "yes" || s === "on") ? true : (s === "false" || s === "0" || s === "no" || s === "off") ? false : fallback;
}

function parseAqProvider(raw) {
  const s = String(raw || "auto").toLowerCase().trim();
  if (s === "openaq") return "openaq";
  if (s === "waqi") return "waqi";
  return "auto";
}

function parseAqRadius(raw) {
  // OpenAQ v3 radius is in km. Clamp to [1, 100] — anything below 1 km
  // returns no results for most locations; anything above 100 km starts
  // pulling stations from neighbouring cities.
  const v = Number(raw);
  if (isNaN(v) || v <= 0) return 25; // sensible default per OpenAQ docs
  return Math.max(1, Math.min(100, Math.round(v)));
}

function clamp(v, min, max) {
  v = Number(v);
  return isNaN(v) ? min : Math.max(min, Math.min(max, v));
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

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = (params.action || "").toLowerCase().trim();

  // 1. Live AI Metrics & Status Endpoint
  if (action === "status" || action === "metrics") {
    return handleStatusEndpoint(params);
  }

  // 2. Parse locations from query parameters
  const locations = parseLocationsFromParams(e);

  // 3. Fallback Documentation Readme if no locations supplied
  if (!locations || locations.length === 0) {
    const readme = buildReadme(params);
    return ContentService.createTextOutput(readme)
      .setMimeType(ContentService.MimeType.TEXT)
      .downloadAsFile("meteo-ics_readme.txt");
  }

  // 4. Parse feed options from URL params
  const unitParam = String(params.unit || params.temperatureUnit || ICAL_CONFIG.temperatureUnit || "").toLowerCase();
  const temperatureUnit = unitParam.startsWith("f") ? "fahrenheit" : "celsius";
  const lang = normalizeLang(params.lang);
  const days = clamp(params.days, ICAL_CONFIG.minForecastDays, ICAL_CONFIG.maxForecastDays);
  const hazards = parseBoolParam(params.hazards, ICAL_CONFIG.hazardsEnabled);
  const dryRun = parseBoolParam(params.dryRun || params.dryrun, false);
  const aqProvider = parseAqProvider(params.aqProvider);
  const aqRadius = parseAqRadius(params.aqRadius);
  const waqiTokenParam = params.waqiToken ? String(params.waqiToken).trim() : null;
  if (waqiTokenParam && /^[A-Za-z0-9]{8,128}$/.test(waqiTokenParam)) {
    PropertiesService.getScriptProperties().setProperty("WAQI_TOKEN", waqiTokenParam);
  } else if (params.waqiToken) {
    Logger.log("doGet: rejected waqiToken (must be 8-128 alphanumeric chars)");
  }

  // 5. Generate ICS Feed
  let icsContent;
  try {
    icsContent = generateIcsFeed(locations, temperatureUnit, { lang, days, hazards, dryRun, aqProvider, aqRadius });
  } catch (e) {
    // Surface actionable errors as plain-text instead of a raw Apps Script exception.
    return ContentService.createTextOutput("Feed generation failed: " + String(e))
      .setMimeType(ContentService.MimeType.TEXT)
      .downloadAsFile("feed_error.txt");
  }
  if (dryRun) {
    return ContentService.createTextOutput(icsContent)
      .setMimeType(ContentService.MimeType.PLAIN_TEXT)
      .downloadAsFile("weather_feed_preview.txt");
  }
  return ContentService.createTextOutput(icsContent)
    .setMimeType(ContentService.MimeType.ICAL)
    .downloadAsFile("weather_feed.ics");
}

function buildReadme(params) {
  const lang = normalizeLang(params.lang);
  const langNames = { en:"English", zh:"Chinese", hi:"Hindi", es:"Spanish", fr:"French", ar:"Arabic", de:"German", nl:"Dutch" };
  const tr = (en, m) => (m && m[lang]) ? m[lang] : en;
  return [
    "==================================================================",
    " " + tr("METEO ICALENDAR (.ICS) DASHBOARD - ENDPOINT DOCUMENTATION",
             { en:"METEO ICALENDAR (.ICS) DASHBOARD - ENDPOINT DOCUMENTATION",
               zh:"气象日历 (.ICS) 仪表板 - 端点文档",
               hi:"मेटियो iCal (.ICS) डैशबोर्ड - एंडपॉइंट दस्तावेज़",
               es:"PANEL DE CALENDARIO (.ICS) METEO - DOCUMENTACIÓN",
               fr:"PANNEAU METEO ICALENDAR (.ICS) - DOCUMENTATION",
               ar:"لوحة تقويم الطقس (.ICS) - التوثيق",
               de:"WETTER-ICALENDAR (.ICS) - ENDPOINT-DOKUMENTATION",
               nl:"METEO ICALENDAR (.ICS) - EINDPDOCUMENTATIE" }),
    "==================================================================",
    "",
    tr("No locations were supplied in the URL query parameters.",
       { en:"No locations were supplied in the URL query parameters.",
         zh:"URL 查询参数中未提供位置。",
         hi:"URL क्वेरी पैरामीटर में कोई स्थान नहीं दिया गया।",
         es:"No se proporcionaron ubicaciones en los parámetros de la URL.",
         fr:"Aucun lieu n'a été fourni dans les paramètres URL.",
         ar:"لم يتم توفير مواقع في معلمات URL.",
         de:"Keine Standorte in den URL-Parametern angegeben.",
         nl:"Geen locaties opgegeven in de URL-parameters." }),
    tr("Subscribe to this live feed by specifying cities or coordinates.",
       { en:"Subscribe to this live feed by specifying cities or coordinates.",
         zh:"通过指定城市或坐标订阅此实时源。",
         hi:"शहरों या निर्देशांकों को निर्दिष्ट करके इस लाइव फ़ीड को सदस्यता लें।",
         es:"Suscríbase a esta fuente en vivo especificando ciudades o coordenadas.",
         fr:"Abonnez-vous à ce flux en direct en spécifiant des villes ou des coordonnées.",
         ar:"اشترك في هذه البث المباشر بتحديد المدن أو الإحداثيات.",
         de:"Abonnieren Sie diesen Live-Feed, indem Sie Städte oder Koordinaten angeben.",
         nl:"Abonneer u op deze live feed door steden of coördinaten op te geven." }),
    "",
    "1. " + tr("QUERY PARAMETERS", null),
    "------------------------------------------------------------------",
    "• cities : " + tr("Comma-separated city names (auto-geocoded).", null),
    "           " + tr("Example", null) + ": ?cities=Tokyo,Paris,New York",
    "",
    "• locations : " + tr("Custom defined coordinates in NAME:LAT:LON format.", null),
    "              " + tr("Example", null) + ": ?locations=Kyoto:35.0116:135.7681",
    "",
    "• lat & lon : " + tr("Single custom coordinate with optional name parameter.", null),
    "              " + tr("Example", null) + ": ?lat=64.1466&lon=-21.9426&name=Reykjavik",
    "",
    "• unit : " + tr("Temperature unit. 'celsius' (default) or 'fahrenheit'.", null),
    "         " + tr("Example", null) + ": ?cities=Kyoto&unit=celsius",
    "",
    "• days : " + tr("Forecast window in days (1-30, default 30).", null),
    "         " + tr("Example", null) + ": ?cities=Tokyo&days=14",
    "",
    "• lang : " + tr("Display language.", null) + " en|zh|hi|es|fr|ar|de|nl (default en)",
    "         " + tr("Example", null) + ": ?cities=Tokyo&lang=zh",
    "",
    "• hazards : " + tr("Show road safety section (true|false, default true).", null),
     "         " + tr("Example", null) + ": ?cities=Tokyo&hazards=false",
     "",
     "• dryRun : " + tr("Preview the feed as plain text without ICS download.", null),
     "            " + tr("Example", null) + ": ?cities=Tokyo&dryRun=true",
     "",
     "• action : " + tr("'status' or 'metrics' to view live model accuracy JSON.", null),
    "           " + tr("Example", null) + ": ?action=status",
    "",
    "• aqProvider : " + tr("AQI source: auto|openaq|waqi (default auto).", null),
    "               " + tr("Cascade: Open-Meteo CAMS → OpenAQ v3 → WAQI geo-feed.", null),
    "               " + tr("Example", null) + ": ?cities=Lagos&aqProvider=auto",
    "",
    "• aqRadius : " + tr("OpenAQ station search radius in km (1-100, default 25).", null),
    "             " + tr("Example", null) + ": ?cities=Lagos&aqRadius=50",
    "",
    "• waqiToken : " + tr("Optional WAQI API token for higher rate limit.", null),
    "              " + tr("Example", null) + ": ?cities=Tokyo&waqiToken=YOUR_TOKEN",
    "",
    "2. " + tr("READY-TO-USE SUBSCRIPTION EXAMPLES", null),
    "------------------------------------------------------------------",
    "• " + tr("Multiple World Cities", null) + ":",
    "  https://script.google.com/.../exec?cities=Kyoto,Reykjavik,Valparaiso",
    "",
    "• " + tr("Exact Coordinates (Fahrenheit)", null) + ":",
    "  https://script.google.com/.../exec?locations=Tokyo:35.6762:139.6503&unit=fahrenheit",
    "",
    "3. " + tr("HOW TO SUBSCRIBE IN YOUR CALENDAR CLIENT", null),
    "------------------------------------------------------------------",
    "• " + tr("Apple Calendar (iOS / macOS):", null),
    "  " + tr("File > New Calendar Subscription > Paste your URL above.", null),
    "",
    "• " + tr("Google Calendar Web:", null),
    "  " + tr("Other Calendars (+) > From URL > Paste your URL above.", null),
    "",
    "• " + tr("Outlook 365 / Desktop:", null),
    "  " + tr("Add Calendar > Subscribe from web > Paste your URL above.", null),
    "",
    "==================================================================",
    "Generated by Weather & Celestial Engine · Open-Meteo & Copernicus · " + (langNames[lang] || lang)
  ].join("\r\n");
}

function handleStatusEndpoint(params) {
  const unitParam = (params.unit || ICAL_CONFIG.temperatureUnit).toLowerCase();
  const isC = !unitParam.startsWith("f");
  const sym = isC ? "°C" : "°F";
  let stats;
  try {
    stats = computeGlobalModelAccuracy(sym);
  } catch (e) {
    stats = { tempMAE: "Error", rainMAE: String(e), modelGrade: "N/A", leadCurve: "N/A", verifiedDays: 0, verifiedSnapshots: 0 };
  }

  const configHealth = {
    deterministicDays: ICAL_CONFIG.deterministicDays,
    deterministicDaysWarning: ICAL_CONFIG.deterministicDays > 16
      ? "EXCEEDS Open-Meteo max (16) — deterministic events will be truncated"
      : null,
    maxForecastDays: ICAL_CONFIG.maxForecastDays,
    maxCities: ICAL_CONFIG.maxCities,
    fetcherTimeouts: { deterministic: FETCH_TIMEOUT_MS }
  };

  const statusPayload = {
    scriptVersion: ICAL_CONFIG.version,
    status: "healthy",
    timestamp: new Date().toISOString(),
    engine: "Deterministic (<14d) + NOAA GFS Ensemble (15-30d) + Copernicus CAMS",
    pressureUnit: "Standard Atmosphere (atm)",
    temperatureUnit: isC ? "celsius" : "fahrenheit",
    accuracyMetrics: {
      temperatureMAE: stats.tempMAE,
      precipitationMAE: stats.rainMAE,
      modelGrade: stats.modelGrade,
      leadCurve: stats.leadCurve,
      calibrationDaysTracked: stats.verifiedDays || 0,
      snapshotsEvaluated: stats.verifiedSnapshots || 0
    },
    configHealth: configHealth,
    airQualityData: {
      defaultProvider: "auto",
      providerOptions: ["auto", "openaq", "waqi"],
      providerDescriptions: {
        auto: "cascade: Open-Meteo CAMS/EAQI → OpenAQ v3 latest → WAQI geo-feed",
        openaq: "OpenAQ v3 latest measurements (200+ countries, no key required)",
        waqi: "WAQI /feed/geo: endpoint (1000+ stations, optional token for higher rate limit)"
      },
      openMeteoAqForecastDaysCap: OPEN_METEO_AQ_FORECAST_DAYS_CAP,
      openMeteoAqNote: "Open-Meteo CAMS air-quality API caps forecast_days at " + OPEN_METEO_AQ_FORECAST_DAYS_CAP + ". For regions outside EU/US coverage, the engine falls back to OpenAQ or WAQI.",
      globalFallbackEndpoints: {
        openaq: OPENAQ_LATEST_ENDPOINT,
        waqi: WAQI_BASE_ENDPOINT + "<lat>;<lon>/"
      },
      waqiTokenStored: !!(PropertiesService.getScriptProperties().getProperty("WAQI_TOKEN"))
    },
    supportedLanguages: SUPPORTED_LANGS,
    endpoints: {
      calendarFeed: "?cities=City1,City2&days=14&lang=en",
      customCoordinates: "?locations=Name:Lat:Lon",
      liveMetrics: "?action=status",
      dryRun: "?cities=City&dryRun=true"
    }
  };

  return ContentService.createTextOutput(JSON.stringify(statusPayload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseLocationsFromParams(e) {
  if (!e || !e.parameter) return [];
  const p = e.parameter;
  const list = [];
  const failedGeocodes = [];
  const MAX_INPUT_LEN = 1000;

  // Apps Script may deliver a query param as an array (e.g. ?cities=A&cities=B).
  // Coerce to string so downstream .split() and .length are always well-defined.
  const asString = v => (v == null) ? "" : (Array.isArray(v) ? v.join(",") : String(v));

  if (p.locations && asString(p.locations).length <= MAX_INPUT_LEN) {
    asString(p.locations).split(",").forEach(entry => {
      const parts = entry.split(":");
      if (parts.length >= 3) {
        const name = parts[0].trim();
        const lat = parseFloat(parts[1]);
        const lon = parseFloat(parts[2]);
        if (isValidLatLon(lat, lon) && name) {
          list.push({ name, lat, lon });
        }
      }
    });
  }

  if (p.lat && p.lon) {
    const lat = parseFloat(p.lat);
    const lon = parseFloat(p.lon);
    if (isValidLatLon(lat, lon)) {
      const name = (p.name && asString(p.name).trim()) || "Custom Location";
      list.push({ name, lat, lon });
    }
  }

  const geocodeOne = (raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return;
    const geo = geocodeCity(trimmed);
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
      list.push(geo);
    } else {
      failedGeocodes.push(trimmed);
    }
  };

  if (p.cities && asString(p.cities).length <= MAX_INPUT_LEN) {
    asString(p.cities).split(",").forEach(geocodeOne);
  }
  if (p.city && !p.cities && asString(p.city).length <= MAX_INPUT_LEN) {
    geocodeOne(p.city);
  }

  if (failedGeocodes.length > 0) {
    Logger.log("parseLocationsFromParams: geocoding failed for: " + failedGeocodes.join(", "));
  }
  if (p.locations && asString(p.locations).length > MAX_INPUT_LEN) {
    Logger.log("parseLocationsFromParams: 'locations' param exceeded " + MAX_INPUT_LEN + " chars — ignored");
  }
  if (p.cities && asString(p.cities).length > MAX_INPUT_LEN) {
    Logger.log("parseLocationsFromParams: 'cities' param exceeded " + MAX_INPUT_LEN + " chars — ignored");
  }

  const seen = new Set();
  const deduped = list.filter(loc => {
    const key = norm(loc.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, ICAL_CONFIG.maxCities);
}

function generateIcsFeed(locations, temperatureUnit, opts) {
  const options = Object.assign({ lang:"en", days:ICAL_CONFIG.forecastDays, hazards:true, aqRadius:25 }, opts || {});
  const lang = options.lang;
  const maxDays = clamp(options.days, ICAL_CONFIG.minForecastDays, ICAL_CONFIG.maxForecastDays);
  const showHazards = options.hazards !== false;

  if (!Array.isArray(locations) || locations.length === 0) {
    throw new Error("generateIcsFeed: locations array is empty — cannot generate feed");
  }

  // Open-Meteo's forecast_api caps deterministic forecast_days at 16.
  // If deterministicDays is set above 16, the API returns 16-day data and the
  // split between deterministic and ensemble events is silently wrong. Fail fast.
  if (ICAL_CONFIG.deterministicDays > 16) {
    throw new Error("generateIcsFeed: ICAL_CONFIG.deterministicDays (" +
      ICAL_CONFIG.deterministicDays + ") exceeds Open-Meteo's max of 16 — " +
      "deterministic events will be truncated. Reduce deterministicDays or accept ensemble-only forecast.");
  }

  const unitSymbol = temperatureUnit === "celsius" ? "°" : "°F";
  const isC = temperatureUnit === "celsius";
  const today = new Date();
  const todayStr = Utilities.formatDate(today, "UTC", "yyyy-MM-dd");
  const todayRef = Utilities.parseDate(todayStr + " 12:00:00", "UTC", "yyyy-MM-dd HH:mm:ss");
  const fetchedAt = Utilities.formatDate(today, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");

  const calName = t("calName", lang) || ICAL_CONFIG.calendarName;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Weather Astronomical Dashboard//" + lang.toUpperCase(),
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    "X-WR-TIMEZONE:UTC",
    `X-WR-CALDESC:Weather + astronomical · v${ICAL_CONFIG.version} · Open-Meteo AQI (hourly)`,
    `X-WR-LANG:${lang}`,
    `X-META-SCRIPTVERSION:${ICAL_CONFIG.version}`,
    `X-META-FETCHEDAT:${fetchedAt}`,
    "X-META-AQISOURCE:hourly-aggregated",
    `X-META-BUILD:v${ICAL_CONFIG.version} · ${fetchedAt} · open-meteo-hourly`
  ];

  let eventCount = 0;

  locations.forEach(loc => {
    let data;
    try {
      data = fetchIcsAtmosphericDataParallel(loc, temperatureUnit, options.aqProvider, options.aqRadius);
    } catch (e) {
      Logger.log(`generateIcsFeed: fetch failed for ${loc.name} — ${e}`);
      return;
    }
    if (!data || !data.det || !data.det.time) {
      Logger.log(`generateIcsFeed: no daily data for ${loc.name}; skipping`);
      return;
    }

    // Hoist ensemble key lists so the per-offset loop doesn't re-scan Object.keys
    // and re-filter for every day (saves O(offsets × modelKeys) work per location).
    const ensMaxKeys = data.ens ? Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_max")) : [];
    const ensMinKeys = data.ens ? Object.keys(data.ens).filter(k => k.startsWith("temperature_2m_min")) : [];

    const offsetLimit = Math.min(maxDays, data.det.time.length);
    for (let offset = 0; offset < offsetLimit; offset++) {
      const targetDate = new Date(todayRef.getTime() + offset * 24 * 60 * 60 * 1000);
      const dateKey = Utilities.formatDate(targetDate, "UTC", "yyyy-MM-dd");
      const icsDate = Utilities.formatDate(targetDate, "UTC", "yyyyMMdd");
      const nextDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
      const icsNextDate = Utilities.formatDate(nextDate, "UTC", "yyyyMMdd");
      const dtstampStr = `${icsDate}T000000Z`;

      const idx = data.det.time.indexOf(dateKey);
      if (idx === -1) continue;

      let currentMax = null, currentMin = null, apparentMax = null;
      let currentRain = 0, currentWind = 0, windGusts = 0, rainProb = 0, weatherCode = 0;
      let humidity = null, dewPoint = null, cloudCover = null;
      let uvIndex = 0, et0 = 0, radiation = 0, soilTempMin = 10, pressure = 1013.25;
      let sunriseStr = "--:--", sunsetStr = "--:--", daylightFormatted = "--";
      let title = "", modelLabel = "", spreadVal = 0;

      if (offset < ICAL_CONFIG.deterministicDays) {
        const tMaxRaw = data.det.temperature_2m_max[idx];
        const tMinRaw = data.det.temperature_2m_min[idx];
        currentMax = (tMaxRaw != null && Number.isFinite(tMaxRaw)) ? Math.round(tMaxRaw) : 0;
        currentMin = (tMinRaw != null && Number.isFinite(tMinRaw)) ? Math.round(tMinRaw) : 0;
        const appRaw = data.det.apparent_temperature_max ? data.det.apparent_temperature_max[idx] : null;
        apparentMax = (appRaw != null && Number.isFinite(appRaw)) ? Math.round(appRaw) : currentMax;
        currentRain = (data.det.precipitation_sum && data.det.precipitation_sum[idx] != null) ? data.det.precipitation_sum[idx] : 0;
        rainProb = (data.det.precipitation_probability_max && data.det.precipitation_probability_max[idx] != null) ? data.det.precipitation_probability_max[idx] : 0;
        const wMaxRaw = data.det.windspeed_10m_max ? data.det.windspeed_10m_max[idx] : null;
        currentWind = (wMaxRaw != null && Number.isFinite(wMaxRaw)) ? Math.round(wMaxRaw) : 0;
        const wgRaw = data.det.windgusts_10m_max ? data.det.windgusts_10m_max[idx] : null;
        windGusts = (wgRaw != null && Number.isFinite(wgRaw)) ? Math.round(wgRaw) : 0;
        const rawCode = (data.det.weather_code || data.det.weathercode || [])[idx];
        weatherCode = rawCode !== undefined ? rawCode : 0;

        const uvRaw = data.det.uv_index_max ? data.det.uv_index_max[idx] : null;
        uvIndex = (uvRaw != null && Number.isFinite(uvRaw)) ? uvRaw : 0;
        const et0Raw = data.det.et0_fao_evapotranspiration ? data.det.et0_fao_evapotranspiration[idx] : null;
        et0 = (et0Raw != null && Number.isFinite(et0Raw)) ? et0Raw : 0;
        const radRaw = data.det.shortwave_radiation_sum ? data.det.shortwave_radiation_sum[idx] : null;
        radiation = (radRaw != null && Number.isFinite(radRaw)) ? radRaw : 0;

        if (data.hourlyAgg && data.hourlyAgg[dateKey]) {
          pressure = data.hourlyAgg[dateKey].pressure || 1013.25;
          soilTempMin = data.hourlyAgg[dateKey].soilMin !== null ? data.hourlyAgg[dateKey].soilMin : currentMin;
          humidity = data.hourlyAgg[dateKey].humidity;
          dewPoint = data.hourlyAgg[dateKey].dewPoint;
          cloudCover = data.hourlyAgg[dateKey].cloudCover;
        } else {
          soilTempMin = currentMin;
        }

        if (data.det.sunrise && data.det.sunset && data.det.sunrise[idx] && data.det.sunset[idx]) {
          sunriseStr = data.det.sunrise[idx].slice(11, 16);
          sunsetStr = data.det.sunset[idx].slice(11, 16);
          const rDate = new Date(data.det.sunrise[idx]);
          const sDate = new Date(data.det.sunset[idx]);
          const dMins = Math.max(0, Math.round((sDate - rDate) / 60000));
          daylightFormatted = `${Math.floor(dMins / 60)}h ${dMins % 60}m`;
        }

        const certaintyGlyph = getWeatherGlyph(weatherCode);
        title = `${certaintyGlyph} ${currentMax}${unitSymbol} ${loc.name}`;
        modelLabel = `${t("mDet", lang)} (D-${offset === 0 ? "0" : offset})`;
      } else if (data.ens && data.ens.time && ensMaxKeys.length > 0) {
        const ensIdx = data.ens.time.indexOf(dateKey);
        if (ensIdx !== -1) {
          const maxVals = ensMaxKeys.map(k => data.ens[k][ensIdx]).filter(v => v !== null && !isNaN(v));
          const minVals = ensMinKeys.map(k => data.ens[k][ensIdx]).filter(v => v !== null && !isNaN(v));

          if (maxVals.length > 0) {
            const meanMax = maxVals.reduce((a, b) => a + b, 0) / maxVals.length;
            const meanMin = minVals.reduce((a, b) => a + b, 0) / minVals.length;
            currentMax = Math.round(meanMax);
            currentMin = Math.round(meanMin);
            apparentMax = currentMax;
            // Variance must use the unrounded mean; rounding first biases the result
            // (a quantized mean shrinks the squared deviation toward zero).
            const variance = maxVals.reduce((a, b) => a + Math.pow(b - meanMax, 2), 0) / maxVals.length;
            spreadVal = Math.max(1, Math.round(Math.sqrt(variance)));
            const certaintyGlyph = spreadVal <= 2 ? "🎯" : (spreadVal <= 4 ? "⚖️" : "🎲");
            currentRain = (data.ens.precipitation_sum ? data.ens.precipitation_sum[ensIdx] : 0) || 0;
            soilTempMin = currentMin;
            title = `${certaintyGlyph} ~${currentMax}${unitSymbol} ${loc.name} (±${spreadVal}${unitSymbol})`;
            modelLabel = `${t("mEns", lang)} (D-${offset})`;
          }
        }
      }

      if (currentMax === null) continue;

      let aqiVal = null, aqiType = "AQI", pm25Val = null, pm10Val = null, pollenVal = null;
      if (data.aq && data.aq.time) {
        const aqIdx = data.aq.time.indexOf(dateKey);
        if (aqIdx !== -1) {
          if (data.aq.european_aqi && data.aq.european_aqi[aqIdx] !== null && !isNaN(data.aq.european_aqi[aqIdx])) {
            aqiVal = Math.round(data.aq.european_aqi[aqIdx]);
            aqiType = "EAQI";
          } else if (data.aq.us_aqi && data.aq.us_aqi[aqIdx] !== null && !isNaN(data.aq.us_aqi[aqIdx])) {
            aqiVal = Math.round(data.aq.us_aqi[aqIdx]);
            aqiType = "USAQI";
          }

          pm25Val = data.aq.pm2_5 && data.aq.pm2_5[aqIdx] !== null ? Number(data.aq.pm2_5[aqIdx].toFixed(1)) : null;
          pm10Val = data.aq.pm10 && data.aq.pm10[aqIdx] !== null ? Number(data.aq.pm10[aqIdx].toFixed(1)) : null;
          const birch = data.aq.birch_pollen ? data.aq.birch_pollen[aqIdx] || 0 : 0;
          const grass = data.aq.grass_pollen ? data.aq.grass_pollen[aqIdx] || 0 : 0;
          const alder = data.aq.alder_pollen ? data.aq.alder_pollen[aqIdx] || 0 : 0;
          pollenVal = Math.round(Math.max(birch, grass, alder));
        }
      }
      const aqiTypeKey = aqiType === "USAQI" ? "USAQI" : (aqiType === "EAQI" ? "EAQI" : "AQI");

      const astroEvent = getAstronomicalEventsForYear(dateKey, targetDate.getUTCFullYear());
      const moonInfo = getMoonPhaseDetails(targetDate);
      const stargazing = assessStargazingConditions(data, offset, moonInfo.fraction, dateKey, cloudCover, lang);
      const tempMinInC = isC ? currentMin : (currentMin - 32) * (5 / 9);

      const pressureAtm = (pressure / 1013.25).toFixed(2);
      const aggregates = computeContinuousMultiDayAggregates(data, dateKey, isC);
      const gddNote = getGddAction(aggregates.sevenDayGDD, lang);

      const lead = offset;
      const expectedErr = lead <= 3 ? 0.8 : (lead <= 7 ? 1.7 : (lead <= 14 ? 2.9 : 4.3));
      const modelAuditStatus = lead === 0
        ? t("lGt", lang)
        : (lead <= 3 ? t("lS", lang) : (lead <= 7 ? t("lM", lang) : (lead <= 14 ? t("lL", lang) : t("lN", lang))));

      const adviceContext = {
        tempMax: currentMax, tempMin: currentMin, apparentMax: apparentMax,
        rainProb: rainProb, rainVol: currentRain, wind: currentWind,
        aqi: aqiVal, aqiType: aqiType, uv: uvIndex, pollen: pollenVal,
        weatherCode: weatherCode, et0: et0, isC: isC, lang: lang
      };
      const prioritizedAdvice = generatePrioritizedAdvices(adviceContext);

      const header = `${t("pin", lang) || "📍"} ${loc.name}\n${t("cal", lang) || "📅"} ${offset === 0 ? t("dDay", lang) : `D-${offset}`} · ${dateKey}`;

      const tempSec = [
        `🌡️ ${tSection("secTemp", lang)}`,
        `• ${t("range", lang)}: ${currentMin}${unitSymbol} ➔ ${currentMax}${unitSymbol} (${getThermalText(currentMax, isC, lang)})`,
        `• ${t("feels", lang)}: ~${apparentMax}${unitSymbol}${dewPoint !== null ? ` · ${t("dew", lang)}: ${dewPoint}${unitSymbol}` : ""}`,
        humidity !== null ? `• ${t("humid", lang)}: ${humidity}% ${getHumidityGlyph(humidity)} (${getHumidityComfort(humidity, lang)})` : ``,
        offset >= ICAL_CONFIG.deterministicDays
          ? `• ${t("consensus", lang)}: ±${spreadVal}${unitSymbol}`
          : `• ${t("rain", lang)}: ${Number(currentRain).toFixed(1)} mm (${rainProb}%)`,
        offset < ICAL_CONFIG.deterministicDays && windGusts > 0
          ? `• ${t("wind", lang)}: ${currentWind} km/h (${t("gusts", lang)} ${windGusts} km/h)`
          : (offset < ICAL_CONFIG.deterministicDays ? `• ${t("wind", lang)}: ${currentWind} km/h` : ``),
        offset < ICAL_CONFIG.deterministicDays ? `• ${t("baro", lang)}: ${pressureAtm} atm` : ``
      ].filter(Boolean).join("\n");

      const sunSec = [
        `☀️ ${tSection("secSun", lang)}`,
        astroEvent ? `• ${astroEvent}` : ``,
        `• ${t("daylight", lang)}: 🌅${sunriseStr}–🌇${sunsetStr} (${daylightFormatted})`,
        `• ${t("goldenHr", lang)}: ~${getGoldenHourWindow(sunsetStr)}`,
        cloudCover !== null ? `• ${t("cloud", lang)}: ${cloudCover}%` : ``,
        `• ${t("moon", lang)}: ${moonInfo.glyph} ${moonInfo.name} (${moonInfo.illumination})`,
        `• ${t("star", lang)}: ${stargazing}`,
        uvIndex > 0 ? `• ${t("uv", lang)}: ${uvIndex.toFixed(1)} (${getUvAdvice(uvIndex, lang)})` : ``,
        et0 > 0 ? `• ${t("et", lang)}: ${et0.toFixed(1)} mm` : ``,
        radiation > 0 ? `• ${t("rad", lang)}: ${radiation.toFixed(1)} MJ/m²` : ``
      ].filter(Boolean).join("\n");

      const airSec = [
        `🧪 ${tSection("secAir", lang)}`,
        aqiVal !== null
          ? `• ${t("aqi", lang)}: ${aqiVal} ${getAqiGlyph(aqiVal, aqiTypeKey)} (${getAqiLabel(aqiVal, aqiTypeKey, lang)}) [${aqiTypeKey}]`
          : `• ${t("aqi", lang)}: ${t("mon", lang)}`,
        pm25Val !== null ? `• ${t("pm25", lang)}: ${pm25Val} · ${t("pm10", lang)}: ${pm10Val || "--"} µg/m³` : ``,
        pollenVal > 0 ? `• ${t("pollen", lang)}: ${pollenVal} gr/m³` : `• ${t("pollen", lang)}: ${t("polLow", lang)}`
      ].filter(Boolean).join("\n");

      const aggSec = [
        `📅 ${tSection("secAgg", lang)}`,
        `• ${t("rainSum", lang)}: ${aggregates.sevenDayRain} mm`,
        `• ${t("meanTemp", lang)}: ${aggregates.sevenDayMeanTemp}${unitSymbol}`,
        `• ${t("gdd", lang)}: ${aggregates.sevenDayGDD} (${gddNote})`,
        `• ${t("aqi7", lang)}: ${aggregates.sevenDayAqi}`
      ].join("\n");

      const auditSec = [
        `📉 ${tSection("secAudit", lang)}`,
        `• ${t("status", lang)}: ${modelAuditStatus}`,
        `• ${t("drift", lang)}: ±${expectedErr.toFixed(1)}${unitSymbol}`,
        `• ${t("lS", lang).split(" ")[0]}:±0.8° · ${t("lM", lang).split(" ")[0]}:±1.7° · ${t("lL", lang).split(" ")[0]}:±2.9° · ${t("lN", lang).split(" ")[0]}:±4.3°`
      ].join("\n");

      const sections = [header, tempSec, sunSec, airSec, aggSec, auditSec];

      if (showHazards && tempMinInC <= 7) {
        const roadHazard = assessRoadConditions(currentMin, soilTempMin, currentRain, isC, lang);
        sections.push([
          `🚗 ${tSection("secRoad", lang)} (<=7°C)`,
          `• ${t("status", lang)}: ${roadHazard.status}`,
          `• ${t("ground", lang)}: ${Math.round(soilTempMin)}${unitSymbol} (${roadHazard.advisory})`
        ].join("\n"));
      }

      sections.push([
        `💡 ${tSection("secAdvice", lang)}`,
        prioritizedAdvice.map(adv => `• ${adv}`).join("\n"),
        ``,
        `ℹ️ ${t("engine", lang)}: ${modelLabel}`
      ].join("\n"));

      const fullDesc = sections.join("\n\n");
      const uid = `weather_${norm(loc.name)}_${dateKey}@weatherdashboard`;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstampStr}`);
      lines.push(`DTSTART;VALUE=DATE:${icsDate}`);
      lines.push(`DTEND;VALUE=DATE:${icsNextDate}`);
      lines.push(`SUMMARY:${escapeIcsText(title)}`);
      lines.push(`DESCRIPTION:${escapeIcsText(fullDesc)}`);
      lines.push("STATUS:CONFIRMED");
      lines.push("TRANSP:TRANSPARENT");
      lines.push("END:VEVENT");
      eventCount++;
    }
  });

  if (eventCount === 0) {
    throw new Error(
      "generateIcsFeed: no events generated for " + locations.length + " location(s). " +
      "Check API responses, geocoding results, and date filters."
    );
  }

  lines.push("END:VCALENDAR");
  return foldIcsLines(lines);
}

function escapeIcsText(str) {
  if (!str) return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r/g, "");
}

function foldIcsLines(lines) {
  // RFC 5545 §3.1: lines must not exceed 75 octets. Handle UTF-8 by counting
  // each code unit; non-ASCII characters use 2-4 octets so we estimate conservatively.
  const octets = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) < 128 ? 1 : 2; return n; };
  return lines.map(line => {
    if (octets(line) <= 75) return line;
    let out = "";
    let rest = line;
    let first = true;
    while (rest.length > 0) {
      let budget = first ? 75 : 74;
      let used = 0;
      let oct = 0;
      while (used < rest.length && oct < budget) { oct += rest.charCodeAt(used) < 128 ? 1 : 2; used++; }
      out += (first ? "" : "\r\n ") + rest.slice(0, used);
      rest = rest.slice(used);
      first = false;
    }
    return out;
  }).join("\r\n");
}

function fetchIcsAtmosphericDataParallel(loc, unit, aqProvider, aqRadius) {
  const result = { det: null, ens: null, aq: null, hourlyAgg: {} };
  const radius = Number.isFinite(aqRadius) ? aqRadius : 25;
  const dUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,weather_code,precipitation_sum,precipitation_probability_max,windspeed_10m_max,windgusts_10m_max,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration,shortwave_radiation_sum&temperature_unit=${unit}&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;
  const hUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=pressure_msl,soil_temperature_0cm,relative_humidity_2m,dew_point_2m,cloud_cover&temperature_unit=${unit}&forecast_days=${ICAL_CONFIG.deterministicDays}&timezone=auto`;
  const eUrl = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=gfs_seamless&forecast_days=${ICAL_CONFIG.forecastDays}&temperature_unit=${unit}&timezone=auto`;
  const aqDays = Math.min(ICAL_CONFIG.deterministicDays, OPEN_METEO_AQ_FORECAST_DAYS_CAP);
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&hourly=european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,dust,alder_pollen,birch_pollen,grass_pollen&forecast_days=${aqDays}&timezone=auto`;

  try {
    const responses = UrlFetchApp.fetchAll([
      { url: dUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS },
      { url: hUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS },
      { url: eUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS },
      { url: aqUrl, muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS }
    ]);

    if (responses[0].getResponseCode() === 200) result.det = JSON.parse(responses[0].getContentText()).daily;
    else Logger.log(`fetchIcsAtmosphericDataParallel: ${loc.name} deterministic returned HTTP ${responses[0].getResponseCode()}`);
    if (responses[2].getResponseCode() === 200) result.ens = JSON.parse(responses[2].getContentText()).daily;
    else Logger.log(`fetchIcsAtmosphericDataParallel: ${loc.name} ensemble returned HTTP ${responses[2].getResponseCode()}`);
    if (responses[3].getResponseCode() === 200) {
      const h = JSON.parse(responses[3].getContentText()).hourly;
      if (h && h.time) {
        const aqAgg = {};
        for (let k = 0; k < h.time.length; k++) {
          const dStr = h.time[k].slice(0, 10);
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
        result.aq = {
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
      }
    } else {
      Logger.log(`fetchIcsAtmosphericDataParallel: ${loc.name} air-quality returned HTTP ${responses[3].getResponseCode()}`);
    }

    if (responses[1].getResponseCode() === 200) {
      const hData = JSON.parse(responses[1].getContentText()).hourly;
      if (hData && hData.time) {
        const aggs = {};
        for (let i = 0; i < hData.time.length; i++) {
          const dStr = hData.time[i].slice(0, 10);
          if (!aggs[dStr]) aggs[dStr] = { pressures: [], soilTemps: [] };
          if (hData.pressure_msl && hData.pressure_msl[i] !== null) aggs[dStr].pressures.push(hData.pressure_msl[i]);
          if (hData.soil_temperature_0cm && hData.soil_temperature_0cm[i] !== null) aggs[dStr].soilTemps.push(hData.soil_temperature_0cm[i]);
          if (hData.relative_humidity_2m && hData.relative_humidity_2m[i] !== null) (aggs[dStr].hums = aggs[dStr].hums || []).push(hData.relative_humidity_2m[i]);
          if (hData.dew_point_2m && hData.dew_point_2m[i] !== null) (aggs[dStr].dews = aggs[dStr].dews || []).push(hData.dew_point_2m[i]);
          if (hData.cloud_cover && hData.cloud_cover[i] !== null) (aggs[dStr].clouds = aggs[dStr].clouds || []).push(hData.cloud_cover[i]);
        }
        Object.keys(aggs).forEach(dateStr => {
          const pArr = aggs[dateStr].pressures;
          const sArr = aggs[dateStr].soilTemps;
          const hArr = aggs[dateStr].hums || [];
          const dArr = aggs[dateStr].dews || [];
          const cArr = aggs[dateStr].clouds || [];

          result.hourlyAgg[dateStr] = {
            pressure: pArr.length > 0 ? (pArr.reduce((a, b) => a + b, 0) / pArr.length) : 1013.25,
            soilMin: sArr.length > 0 ? Math.min(...sArr) : null,
            humidity: hArr.length > 0 ? Math.round(hArr.reduce((a, b) => a + b, 0) / hArr.length) : null,
            dewPoint: dArr.length > 0 ? Math.round(dArr.reduce((a, b) => a + b, 0) / dArr.length) : null,
            cloudCover: cArr.length > 0 ? Math.round(cArr.reduce((a, b) => a + b, 0) / cArr.length) : null
          };
        });
      }
    }
  } catch (e) {
    Logger.log("iCal atmospheric fetch error: " + e);
  }

  const needsGlobalFallback = aqProvider === "auto"
    ? !result.aq || !result.aq.time
      || (result.aq.european_aqi.every(v => v === null) && result.aq.us_aqi.every(v => v === null))
    : aqProvider === "openaq" || aqProvider === "waqi";

  if (needsGlobalFallback) {
    const globalAqi = fetchGlobalAQI(loc, aqProvider, radius);
    if (globalAqi && globalAqi.time && globalAqi.time.length > 0) {
      if (result.aq && result.aq.time) {
        globalAqi.time.forEach((d, i) => {
          const exIdx = result.aq.time.indexOf(d);
          if (exIdx === -1) {
            result.aq.time.push(d);
            result.aq.european_aqi.push(globalAqi.european_aqi[i]);
            result.aq.us_aqi.push(globalAqi.us_aqi[i]);
            result.aq.pm2_5.push(globalAqi.pm2_5[i]);
            result.aq.pm10.push(globalAqi.pm10[i]);
            result.aq.ozone.push(globalAqi.ozone[i]);
            result.aq.nitrogen_dioxide.push(globalAqi.nitrogen_dioxide[i]);
            result.aq.dust.push(globalAqi.dust[i]);
            result.aq.alder_pollen.push(null);
            result.aq.birch_pollen.push(null);
            result.aq.grass_pollen.push(null);
          }
        });
        const sorted = result.aq.time.map((d, i) => ({ d, i })).sort((a, b) => a.d.localeCompare(b.d));
        result.aq.time = sorted.map(x => x.d);
        result.aq.european_aqi = sorted.map(x => result.aq.european_aqi[x.i]);
        result.aq.us_aqi = sorted.map(x => result.aq.us_aqi[x.i]);
        result.aq.pm2_5 = sorted.map(x => result.aq.pm2_5[x.i]);
        result.aq.pm10 = sorted.map(x => result.aq.pm10[x.i]);
        result.aq.ozone = sorted.map(x => result.aq.ozone[x.i]);
        result.aq.nitrogen_dioxide = sorted.map(x => result.aq.nitrogen_dioxide[x.i]);
        result.aq.dust = sorted.map(x => result.aq.dust[x.i]);
      } else {
        result.aq = globalAqi;
      }
    }
  }

  return result;
}

function fetchGlobalAQI(loc, aqProvider, aqRadius) {
  const r = { time: [], european_aqi: [], us_aqi: [], pm2_5: [], pm10: [], ozone: [], nitrogen_dioxide: [], dust: [] };
  const radius = Number.isFinite(aqRadius) && aqRadius > 0 ? aqRadius : 25;
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
          const now = new Date();
          dates.forEach(d => r.time.push(d));
          const openaqVals = {};
          measurements.forEach(m => {
            const param = (m.parameter || "").toLowerCase();
            if (openaqVals[param] === undefined || (m.lastUpdated && new Date(m.lastUpdated) > new Date(openaqVals[param + "_ts"] || 0))) {
              openaqVals[param] = m.value;
              openaqVals[param + "_ts"] = m.lastUpdated;
            }
          });
          // OpenAQ v3 parameter names vary by station (pm25 vs pm2.5,
          // o3 vs ozone, no2 vs nitrogen_dioxide). Pick the first
          // non-null value across all known aliases.
          const fill = v => (v !== undefined && v !== null && !isNaN(v) ? Math.round(v) : null);
          const firstDefined = (...keys) => {
            for (const k of keys) { const v = fill(openaqVals[k]); if (v !== null) return v; }
            return null;
          };
          const pm25 = firstDefined("pm25", "pm2.5");
          const pm10 = firstDefined("pm10");
          const o3   = firstDefined("o3", "ozone");
          const no2  = firstDefined("no2", "nitrogen_dioxide");
          dates.forEach(() => {
            r.european_aqi.push(pm25);
            r.us_aqi.push(pm25);
            r.pm2_5.push(pm25);
            r.pm10.push(pm10);
            r.ozone.push(o3);
            r.nitrogen_dioxide.push(no2);
            r.dust.push(null);
          });
          return r;
        }
      } else {
        Logger.log(`fetchGlobalAQI/OpenAQ: ${loc.name} returned HTTP ${res.getResponseCode()}`);
      }
    } catch (e) {
      Logger.log(`fetchGlobalAQI/OpenAQ error for ${loc.name}: ${e}`);
    }
  }

  if (aqProvider === "auto" || aqProvider === "waqi") {
    try {
      const token = PropertiesService.getScriptProperties().getProperty("WAQI_TOKEN") || "";
      const url = token
        ? `${WAQI_BASE_ENDPOINT}${loc.lat.toFixed(4)};${loc.lon.toFixed(4)}/?token=${token}`
        : `${WAQI_BASE_ENDPOINT}${loc.lat.toFixed(4)};${loc.lon.toFixed(4)}/`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: FETCH_TIMEOUT_MS });
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        if (json.data && json.data.aqi != null && json.data.aqi !== undefined) {
          const aqiRaw = Number(json.data.aqi);
          const aqi = isNaN(aqiRaw) ? null : Math.round(aqiRaw);
          const iaqi = json.data.iaqi || {};
          const fill = v => { const n = Number(v); return isNaN(n) ? null : Math.round(n); };
          const pm25v = iaqi.pm25 && iaqi.pm25.v != null ? fill(iaqi.pm25.v) : null;
          const pm10v = iaqi.pm10 && iaqi.pm10.v != null ? fill(iaqi.pm10.v) : null;
          dates.forEach(d => {
            r.time.push(d);
            r.european_aqi.push(aqi);
            r.us_aqi.push(aqi);
            r.pm2_5.push(pm25v);
            r.pm10.push(pm10v);
            r.ozone.push(null);
            r.nitrogen_dioxide.push(null);
            r.dust.push(null);
          });
          return r;
        }
      } else {
        Logger.log(`fetchGlobalAQI/WAQI: ${loc.name} returned HTTP ${res.getResponseCode()}`);
      }
    } catch (e) {
      Logger.log(`fetchGlobalAQI/WAQI error for ${loc.name}: ${e}`);
    }
  }

  return null;
}

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

function norm(str) {
  if (str == null) return "";
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isValidLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
         Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function getGddAction(gdd, lang) {
  lang = lang || "en";
  const g = Number(gdd) || 0;
  if (g === 0) return t("gddDorm", lang);
  if (g < 25) return t("gddCool", lang);
  if (g < 60) return t("gddFoli", lang);
  if (g < 100) return t("gddBrss", lang);
  return t("gddPeak", lang);
}

function computeContinuousMultiDayAggregates(data, baseDateStr, isC, calTz) {
  let totalRain = 0, totalMax = 0, totalMin = 0, gddSum = 0, wDays = 0;
  const base10 = isC ? 10 : 50;

  const tz = calTz || "UTC";
  const baseDate = Utilities.parseDate(baseDateStr + " 12:00:00", tz, "yyyy-MM-dd HH:mm:ss");

  // Build the 7-day date list once and reuse for both temp and AQI lookups.
  const dateKeys = [];
  for (let d = 0; d < 7; d++) {
    const curDate = new Date(baseDate.getTime() + d * 24 * 60 * 60 * 1000);
    dateKeys.push(Utilities.formatDate(curDate, tz, "yyyy-MM-dd"));
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
          // Defensive: skip snapshots with missing predicted values rather than
          // poisoning the running error totals with NaN. typeof NaN === "number"
          // so we must use Number.isFinite to catch NaN too.
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

const ADVICE_TEXTS = {
  "allergyHigh": {
    "en": "Pollen burst — antihistamines advised",
    "zh": "花粉高发 — 建议服用抗组胺药",
    "hi": "पराग कण — एंटीहिस्टामाइन लें",
    "es": "Polen alto — tomar antihistamínicos",
    "fr": "Pic de pollen — antihistaminiques",
    "ar": "ذروة حبوب اللقاح — مضادات الهيستامين",
    "de": "Pollen-Belastung — Antihistaminika",
    "nl": "Pollenexplosie — antihistaminica",
  },
  "allergyMod": {
    "en": "Moderate pollen — sensitive groups take care",
    "zh": "中度花粉 — 敏感人群请注意",
    "hi": "मध्यम पराग — संवेदनशील लोग सावधान",
    "es": "Polen moderado — sensibles con cuidado",
    "fr": "Pollen modéré — groupes sensibles",
    "ar": "حبوب لقاح معتدلة — احذر",
    "de": "Mäßiger Pollen — Empfindliche achten",
    "nl": "Matig pollen — gevoeligen opgelet",
  },
  "uvExtreme": {
    "en": "UV extreme — SPF 50+, hat essential",
    "zh": "紫外线极强 — SPF 50+ 与遮阳帽必备",
    "hi": "UV अत्यधिक — SPF 50+ और टोपी ज़रूरी",
    "es": "UV extremo — SPF 50+ y sombrero",
    "fr": "UV extrême — SPF 50+ et chapeau",
    "ar": "UV شديد — SPF 50+ وقبعة",
    "de": "UV extrem — LSF 50+ und Hut",
    "nl": "UV extreem — SPF 50+ en hoed",
  },
  "uvHigh": {
    "en": "UV high — sunscreen & sunglasses",
    "zh": "紫外线强 — 防晒霜与墨镜",
    "hi": "UV उच्च — सनस्क्रीन और धूप का चश्मा",
    "es": "UV alto — protector y gafas",
    "fr": "UV élevé — crème solaire",
    "ar": "UV مرتفع — واقي شمس",
    "de": "UV hoch — Sonnencreme",
    "nl": "UV hoog — zonnebrand",
  },
  "uvMod": {
    "en": "UV moderate — cover-up midday",
    "zh": "紫外线中等 — 正午遮阳",
    "hi": "UV मध्यम — दोपहर छाया लें",
    "es": "UV moderado — cubrirse al mediodía",
    "fr": "UV modéré — couvrir midi",
    "ar": "UV معتدل — غطّ نفسك",
    "de": "UV mäßig — Mittag beschatten",
    "nl": "UV matig — bedekken",
  },
  "aqiHazard": {
    "en": "Air hazardous — N95 mask, indoor only",
    "zh": "空气危险 — 戴 N95 口罩并留在室内",
    "hi": "हवा खतरनाक — N95 मास्क, अंदर ही रहें",
    "es": "Aire peligroso — N95, en interiores",
    "fr": "Air dangereux — masque N95",
    "ar": "هواء خطير — كمامة N95",
    "de": "Luft gefährlich — N95",
    "nl": "Lucht gevaarlijk — N95",
  },
  "aqiUnh": {
    "en": "Air unhealthy — limit outdoor time",
    "zh": "空气不健康 — 减少户外活动",
    "hi": "हवा अस्वस्थ — बाहर कम रहें",
    "es": "Aire no saludable — limita salidas",
    "fr": "Air malsain — limiter le dehors",
    "ar": "هواء غير صحي — قلّل الخروج",
    "de": "Luft ungesund — draußen reduzieren",
    "nl": "Lucht ongezond — beperk buiten",
  },
  "aqiSens": {
    "en": "Air unhealthy for sensitive — reduce exertion",
    "zh": "敏感人群不健康 — 减少运动",
    "hi": "संवेदनशीलों के लिए अस्वस्थ — कम परिश्रम",
    "es": "Malsano para sensibles — menos esfuerzo",
    "fr": "Malsain pour sensibles — moins d'effort",
    "ar": "غير صحي للحساسين — أقل جهد",
    "de": "Ungesund für Sensitive — weniger Anstrengung",
    "nl": "Ongezond voor gevoeligen",
  },
  "humidHigh": {
    "en": "Muggy — stay hydrated, light clothes",
    "zh": "闷热 — 多喝水，穿轻薄衣物",
    "hi": "उमस भरा — पानी पीएँ, हल्के कपड़े",
    "es": "Bochornoso — hidrátate, ropa ligera",
    "fr": "Lourd — hydrater, vêtements légers",
    "ar": "رطب — اشرب الماء",
    "de": "Schwül — trinken, leichte Kleidung",
    "nl": "Zwoel — drink water",
  },
  "humidLow": {
    "en": "Dry air — lip balm & moisturize",
    "zh": "空气干燥 — 润唇与保湿",
    "hi": "सूखी हवा — लिप बाम और मॉइस्चराइज़र",
    "es": "Aire seco — bálsamo e hidratación",
    "fr": "Air sec — baume et crème",
    "ar": "هواء جاف — بلسم ومرطب",
    "de": "Trockene Luft — Balsam",
    "nl": "Droge lucht — balsem",
  },
  "windStrong": {
    "en": "Strong winds — secure loose items",
    "zh": "大风 — 固定松散物品",
    "hi": "तेज़ हवा — ढीली चीज़ें सुरक्षित करें",
    "es": "Viento fuerte — asegura objetos",
    "fr": "Vent fort — fixer les objets",
    "ar": "رياح قوية — ثبّت الأشياء",
    "de": "Starker Wind — sichern",
    "nl": "Harde wind — bevestig losse spullen",
  },
  "windGust": {
    "en": "Gusty — cycle/pedestrian caution",
    "zh": "阵风 — 骑车与行人请小心",
    "hi": "हवा के झोंके — सावधानी",
    "es": "Ráfagas — precaución",
    "fr": "Rafales — prudence",
    "ar": "هبّات — حذر",
    "de": "Böen — Vorsicht",
    "nl": "Windstoten — voorzichtig",
  },
  "frost": {
    "en": "Frost likely — cover plants, icy roads",
    "zh": "可能出现霜冻 — 覆盖植物，路面结冰",
    "hi": "पाला संभव — पौधे ढकें, सड़क बर्फ़ीली",
    "es": "Helada probable — cubre plantas",
    "fr": "Gel probable — couvrir plantes",
    "ar": "صقيع محتمل — غطّ النباتات",
    "de": "Frost möglich — Pflanzen abdecken",
    "nl": "Vorst mogelijk — planten bedekken",
  },
  "freezeHard": {
    "en": "Hard freeze — disconnect hoses, protect pipes",
    "zh": "严寒 — 断开水管，保护管道",
    "hi": "कठोर पाला — पाइप सुरक्षित करें",
    "es": "Helada fuerte — desconecta mangueras",
    "fr": "Grand gel — débrancher tuyaux",
    "ar": "صقيع قاسٍ — افصل الخراطيم",
    "de": "Starkfrost — Schläuche trennen",
    "nl": "Harde vorst — slangen los",
  },
  "heat": {
    "en": "Hot — shade, electrolytes",
    "zh": "炎热 — 阴凉处，电解质饮料",
    "hi": "गर्मी — छाया, इलेक्ट्रोलाइट्स",
    "es": "Calor — sombra, electrolitos",
    "fr": "Chaud — ombre, électrolytes",
    "ar": "حار — ظلّ",
    "de": "Hitze — Schatten, Elektrolyte",
    "nl": "Warmte — schaduw",
  },
  "heatWarn": {
    "en": "Heat warning — check on elderly/pets",
    "zh": "高温警报 — 关注老人与宠物",
    "hi": "गर्मी चेतावनी — बुज़ुर्ग/पालतू देखें",
    "es": "Aviso de calor — revisa mayores",
    "fr": "Alerte chaleur — personnes âgées",
    "ar": "تحذير حرارة — اهتم بكبار السن",
    "de": "Hitzewarnung — Senioren/Tiere",
    "nl": "Hittewaarschuwing — ouderen",
  },
  "stormSevere": {
    "en": "Severe storms — stay indoors, charge devices",
    "zh": "强风暴 — 留在室内，给设备充电",
    "hi": "भीषण तूफ़ान — अंदर रहें",
    "es": "Tormentas severas — en interior",
    "fr": "Orages violents — rester à l'intérieur",
    "ar": "عواصف شديدة — ابق بالداخل",
    "de": "Schwere Stürme — drinnen bleiben",
    "nl": "Zware storm — binnen blijven",
  },
  "snowHeavy": {
    "en": "Heavy snow — avoid non-essential travel",
    "zh": "大雪 — 避免非必要出行",
    "hi": "भारी बर्फ़ — अनावश्यक यात्रा टालें",
    "es": "Nieve fuerte — evita viajes",
    "fr": "Forte neige — éviter les voyages",
    "ar": "ثلج كثيف — تجنّب السفر",
    "de": "Starker Schnee — Reisen meiden",
    "nl": "Zware sneeuw — reis vermijden",
  },
  "ice": {
    "en": "Ice — slow commute, layered grip",
    "zh": "结冰 — 减速慢行",
    "hi": "बर्फ़ — धीमी ड्राइविंग",
    "es": "Hielo — conduce despacio",
    "fr": "Verglas — conduire lentement",
    "ar": "جليد — قُد ببطء",
    "de": "Eis — langsam fahren",
    "nl": "Ijs — langzaam rijden",
  },
  "fog": {
    "en": "Fog — low-beam, extra following distance",
    "zh": "大雾 — 近光灯，保持车距",
    "hi": "कोहरा — लो-बीम, दूरी",
    "es": "Niebla — luces cortas",
    "fr": "Brouillard — feux de croisement",
    "ar": "ضباب — أضواء منخفضة",
    "de": "Nebel — Abblendlicht",
    "nl": "Mist — dimlicht",
  },
  "airQualPoor": {
    "en": "Poor air — postpone outdoor exercise",
    "zh": "空气质量差 — 推迟户外运动",
    "hi": "ख़राब हवा — बाहर व्यायाम टालें",
    "es": "Aire pobre — posponer ejercicio",
    "fr": "Air mauvais — reporter l'exercice",
    "ar": "هواء سيئ — أجّل الرياضة",
    "de": "Schlechte Luft — Sport verschieben",
    "nl": "Slechte lucht — sport uitstellen",
  },
  "pollenHigh": {
    "en": "Tree pollen high — allergy meds advised",
    "zh": "树花粉高 — 建议服用过敏药",
    "hi": "वृक्ष पराग उच्च — एलर्जी दवा",
    "es": "Polen de árbol alto",
    "fr": "Pollen d'arbre élevé",
    "ar": "حبوب أشجار مرتفعة",
    "de": "Baumpollen hoch",
    "nl": "Boompollen hoog",
  },
  "moonFull": {
    "en": "Full moon — vivid stargazing pre-dawn",
    "zh": "满月 — 黎明前观星佳",
    "hi": "पूर्णिमा — भोर में तारे",
    "es": "Luna llena — observación pre-amanecer",
    "fr": "Pleine lune — observation",
    "ar": "بدر — مراقبة النجوم",
    "de": "Vollmond — Sternbeobachtung",
    "nl": "Volle maan — sterren kijken",
  },
  "moonNew": {
    "en": "New moon — peak stargazing",
    "zh": "新月 — 最佳观星",
    "hi": "अमावस्या — उत्तम तारा",
    "es": "Luna nueva — observación óptima",
    "fr": "Nouvelle lune — observation optimale",
    "ar": "محاق — ذروة المراقبة",
    "de": "Neumond — optimale Beobachtung",
    "nl": "Nieuwe maan — optimaal",
  },
  "uvLow": {
    "en": "UV low — no protection needed",
    "zh": "紫外线低 — 无需防护",
    "hi": "UV कम — सुरक्षा ज़रूरी नहीं",
    "es": "UV bajo — sin protección",
    "fr": "UV bas — pas de protection",
    "ar": "UV منخفض",
    "de": "UV niedrig",
    "nl": "UV laag",
  },
};


function adv(key, lang) {
  const entry = ADVICE_TEXTS[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

function generatePrioritizedAdvices(ctx) {
  const isC = ctx.isC;
  const lang = ctx.lang || "en";
  // Guard against null/undefined/NaN tempMax — fall back to neutral 20°C so
  // subsequent comparisons (appC >= 35, maxC >= 30) don't silently all fail
  // or trigger inappropriate freezing advice. Mirrors gcal's safe-default fix.
  const safeMax = Number.isFinite(ctx.tempMax) ? ctx.tempMax : 20;
  const safeMin = Number.isFinite(ctx.tempMin) ? ctx.tempMin : 15;
  const safeApparent = Number.isFinite(ctx.apparentMax) ? ctx.apparentMax : safeMax;
  const maxC = isC ? safeMax : (safeMax - 32) * (5 / 9);
  const minC = isC ? safeMin : (safeMin - 32) * (5 / 9);
  const appC = isC ? safeApparent : (safeApparent - 32) * (5 / 9);
  const uvMax = Number.isFinite(ctx.uv) ? ctx.uv : 0;

  const pool = [];

  if (ctx.aqi !== null && ctx.aqiType === "USAQI" && ctx.aqi > 200) {
    pool.push({ p: 95, text: adv("aqiHazard", lang) });
  } else if (ctx.aqi !== null && ctx.aqiType === "USAQI" && ctx.aqi > 150) {
    pool.push({ p: 90, text: adv("aqiUnh", lang) });
  } else if (ctx.aqi !== null && ctx.aqiType === "USAQI" && ctx.aqi > 100) {
    pool.push({ p: 80, text: adv("aqiSens", lang) });
  }

  if (Number.isFinite(uvMax) && uvMax >= 8) {
    pool.push({ p: 90, text: adv("uvExtreme", lang) });
  } else if (Number.isFinite(uvMax) && uvMax >= 6) {
    pool.push({ p: 70, text: adv("uvHigh", lang) });
  } else if (Number.isFinite(uvMax) && uvMax >= 3) {
    pool.push({ p: 40, text: adv("uvMod", lang) });
  } else if (Number.isFinite(uvMax) && uvMax < 2) {
    pool.push({ p: 5, text: adv("uvLow", lang) });
  }

  if (minC <= 0) {
    pool.push({ p: 85, text: adv("freezeHard", lang) });
  } else if (minC <= 2) {
    pool.push({ p: 60, text: adv("frost", lang) });
  }
  if (appC >= 35) {
    pool.push({ p: 88, text: adv("heatWarn", lang) });
  } else if (maxC >= 30) {
    pool.push({ p: 60, text: adv("heat", lang) });
  }
  if (Number.isFinite(ctx.wind) && ctx.wind >= 12) {
    pool.push({ p: 50, text: adv("windGust", lang) });
  }
  if (Number.isFinite(ctx.rainVol) && ctx.rainVol >= 25) {
    pool.push({ p: 92, text: adv("stormSevere", lang) });
  }
  if (ctx.aqi !== null && ctx.aqiType !== "USAQI" && ctx.aqi > 40) {
    pool.push({ p: 70, text: adv("airQualPoor", lang) });
  }
  if (Number.isFinite(ctx.pollen) && ctx.pollen >= 5) {
    pool.push({ p: 50, text: adv("pollenHigh", lang) });
  }
  if (Number.isFinite(ctx.moonIllum) && ctx.moonIllum >= 0.98) {
    pool.push({ p: 15, text: adv("moonFull", lang) });
  } else if (Number.isFinite(ctx.moonIllum) && ctx.moonIllum <= 0.02) {
    pool.push({ p: 20, text: adv("moonNew", lang) });
  }

  return pool.sort((a, b) => b.p - a.p).slice(0, 3).map(item => item.text);
}

function assessRoadConditions(tMin, soilMin, rainVol, isC, lang) {
  lang = lang || "en";
  // Guard raw inputs with Number.isFinite (not isNaN on derived values):
  // isNaN(null) === false, so null would silently pass and get treated as 0°C
  // in the unit conversion below, triggering a false black-ice advisory.
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
  const ev = ASTRONOMICAL_EVENTS[dateStr.slice(5)];
  if (!ev) return null;
  if (year && /Meteor Peak/i.test(ev)) return ev + " (" + year + ")";
  return ev;
}

function getMoonPhaseDetails(date) {
  if (date == null) return { glyph: "🌑", name: "New Moon", fraction: 0, illumination: "0%" };
  const lp = 2551443; // synodic month in seconds
  // UTC reference epoch for new moon near 1970-01-07.
  const newMoonRef = Date.UTC(1970, 0, 7, 20, 35, 0);
  const ms = (date instanceof Date) ? date.getTime() : Number(date);
  if (!Number.isFinite(ms)) return { glyph: "🌑", name: "New Moon", fraction: 0, illumination: "0%" };
  let phase = ((ms - newMoonRef) / 1000) % lp;
  if (phase < 0) phase += lp; // defensive for pre-1970
  const dayOfCycle = phase / 86400; // days into current cycle
  // Illumination: 0 = new moon, 1 = full moon.
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

function assessStargazingConditions(data, offset, moonFraction, dateKey, cloudCover, lang) {
  lang = lang || "en";
  if (offset >= ICAL_CONFIG.deterministicDays || !data.det || !data.det.time) {
    return moonFraction > 0.7 ? "🌕 " + t("starFlt", lang) : "🔭 " + t("starDec", lang);
  }
  const idx = data.det.time.indexOf(dateKey);
  if (idx === -1) return "🔭 " + t("starMod", lang);
  const codes = data.det.weather_code || data.det.weathercode || [];
  const code = codes[idx] !== undefined ? codes[idx] : 0;
  const rainProb = data.det.precipitation_probability_max ? data.det.precipitation_probability_max[idx] : 0;
  if (cloudCover !== undefined && cloudCover !== null && cloudCover > 70) return "☁️ " + t("starObsc", lang);
  if (code === 0 && moonFraction <= 0.3) return "🔭 " + t("starExc", lang);
  if ((code === 0 || code === 1) && moonFraction > 0.7) return "🌕 " + t("starMoon", lang);
  if (code === 0 || code === 1 || code === 2) return "🔭 " + t("starFair", lang);
  if (rainProb > 40 || code >= 3) return "☁️ " + t("starObsc", lang);
  return "🔭 " + t("starMod", lang);
}

function getGoldenHourWindow(sunsetStr) {
  if (!sunsetStr || sunsetStr === "--:--") return "--";
  const parts = sunsetStr.split(":");
  if (parts.length < 2) return "--";
  const hrRaw = parseInt(parts[0], 10);
  const mnRaw = parseInt(parts[1], 10);
  if (isNaN(hrRaw) || isNaN(mnRaw)) return "--";
  let hr = hrRaw;
  let mn = mnRaw - 45;
  if (mn < 0) { mn += 60; hr -= 1; }
  if (hr < 0) hr += 24;
  const pad = n => (n < 10 ? "0" + n : n);
  return pad(hr) + ":" + pad(mn) + "-" + sunsetStr;
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

function getThermalText(t, isC, lang) {
  lang = lang || "en";
  const c = isC ? t : (t - 32) * (5 / 9);
  if (c <= 0) return t("tFreeze", lang);
  if (c <= 10) return t("tChilly", lang);
  if (c <= 20) return t("tComf", lang);
  if (c <= 26) return t("tPleas", lang);
  if (c <= 32) return t("tWarm", lang);
  return t("tHot", lang);
}

function getHumidityGlyph(h) {
  if (h <= 30) return "🏜️";
  if (h <= 60) return "💧";
  return "🧖";
}

function getHumidityComfort(h, lang) {
  lang = lang || "en";
  if (h <= 30) return t("humDry", lang);
  if (h <= 60) return t("humComf", lang);
  if (h <= 75) return t("humHumid", lang);
  return t("humMuggy", lang);
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

function getAqiLabel(aqi, aqiType, lang) {
  lang = lang || "en";
  if (aqi === null) return t("aqiUnk", lang);
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
  lang = lang || "en";
  if (uv <= 2) return t("uvLow", lang);
  if (uv <= 5) return t("uvMod", lang);
  if (uv <= 7) return t("uvHigh", lang);
  return t("uvVhigh", lang);
}
