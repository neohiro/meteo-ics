# 🌦️ Autonomous Weather, Astronomical & Atmospheric Calendar Engine

[![Protocol](https://img.shields.io/badge/RFC-5545%20(iCalendar)-blue.svg)](#)
[![Data Sources](https://img.shields.io/badge/Data-Open--Meteo%20%7C%20NOAA%20GFS%20%7C%20Copernicus%20CAMS-orange.svg)](#)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20ZH%20%7C%20HI%20%7C%20ES%20%7C%20FR%20%7C%20AR%20%7C%20DE%20%7C%20NL-green.svg)](#)

**Your weather, astronomy & air-quality — automatically delivered to any calendar app.**  
Subscribe once to a live `.ics` feed (Apple Calendar, Outlook, Google Calendar, Thunderbird) or deploy the Google Apps Script to get personalized, location-aware weather dashboards synced directly to your Google Calendar. Every morning, your calendar shows you what's coming — temperature swings, rain probability, road hazards, UV index, pollen loads, moon phases, and even meteor showers — with a built-in forecast accuracy audit that learns from reality over time.

---

## 🌟 What This Service Does — At a Glance

> **Transform your calendar into a personal meteorologist.**  
> Stop checking weather apps. Your calendar already shows you your day — now it also shows you what's coming: hot, cold, wet, wild, hazy, or perfect. Real forecast data from Open-Meteo, NOAA GFS ensembles, and Copernicus CAMS, delivered automatically to Apple Calendar, Outlook, Google Calendar, or Thunderbird via a simple `.ics` subscription URL.

---

## 📂 Feature Categories — Explained

<details>
<summary>🌡️ TEMPERATURE & COMFORT</summary>

- **High / Low temperature** — daily maximum and minimum with thermal comfort text (Freezing / Chilly / Comfortable / Pleasant / Warm / Hot)
- **Feels-Like (apparent temperature)** — wind-chill adjusted or heat-index adjusted perceived temperature
- **Rain volume & probability** — mm of expected precipitation with percentage likelihood
- **Wind speed & gusts** — km/h with gust peaks
- **Barometric pressure** — expressed in Standard Atmosphere (atm), baseline 1.01325 bar
- **Relative humidity & dew point** — comfort level assessment
- **Growing Degree Days (GDD)** — accumulated warmth metric for gardening/agriculture

</details>
<details>
<summary>☀️ SUN & CELESTIAL</summary>

- **Sunrise / Sunset times** — with total daylight duration
- **Golden Hour window** — optimal photography/landscape lighting window (sunset − 45 min)
- **Moon phase & illumination** — glyph + name + percent lit, computed locally
- **UV Index** — with advice (Low / Moderate / High / Very High)
- **Evapotranspiration (ET₀)** — mm of water loss from soil/plants
- **Solar radiation** — MJ/m² of incoming shortwave radiation
- **Astronomical events** — meteor shower peaks, solstices, equinoxes, planet oppositions
- **Stargazing conditions** — assessed from cloud cover and moon phase (Exceptional / Fair / Moderate / Obscured / Moonlit)

</details>
<details>
<summary>🧪 AIR QUALITY & BIO</summary>

- **European AQI (EAQI)** — 0–100 scale, available for Europe (via Copernicus CAMS)
- **US EPA AQI** — 0–500 scale, available for North America
- **Global AQI fallback** — when neither EAQI nor US-AQI is available, raw pollutant concentrations are shown
- **PM2.5 & PM10** — µg/m³ particulate matter concentrations
- **Ozone, NO₂, dust** — additional pollutant readings
- **Pollen load** — Alder, Birch, Grass pollen indices (Europe only)
- **📍 Global AQI coverage note:** Air-quality data is primarily sourced from Copernicus CAMS (EU) and NOAA (US). For regions outside Europe and the United States, **OpenAQ** (openaq.org, 200+ countries, free tier) and **WAQI** (aqicn.org, 1000+ stations globally) offer complementary real-time AQI via their respective APIs. See the [Air Quality Data Sources](#-air-quality-data-sources) section for integration guidance.

</details>
<details>
<summary>📅 LAST WEEK TOTALS (7-Day Aggregate)</summary>

- **Rain sum** — total precipitation over the past 7 days
- **Mean temperature** — average of daily high/low over 7 days
- **Growing Degree Days** — accumulated warmth over 7 days with crop-growth context (Dormant / Cool greens / Steady foliage / Brassicas booming / Peak growth)
- **Mean AQI** — average air quality index over 7 days

</details>
<details>
<summary>📉 MODEL AUDIT</summary>

- **Prediction drift** — temperature and rain delta between forecast snapshot and current conditions
- **Stability indicator** — 🟢 Stable / 🟡 Moderate / 🔴 High Drift based on historical deviation
- **Lifetime Temp MAE** — mean absolute error in °C / °F across all verified days
- **Lifetime Rain MAE** — mean absolute error in mm
- **Reliability grade** — A+ (Excellent, MAE ≤ 1.5°) / A (High, MAE ≤ 2.5°) / B (Moderate, MAE ≤ 3.5°) / C (Divergent)
- **Lead curve** — accuracy bands by forecast horizon: D1–3 · D4–7 · D8–14 · D15+

</details>
<details>
<summary>🚗 ADVICE & RELIABILITY</summary>

- **Actionable weather advice** — top 3 prioritized, emoji-rich recommendations based on current conditions (e.g., heat warnings, frost alerts, UV protection, road safety, gardening irrigation)
- **Road safety advisory** — auto-rendered when T_min ≤ 7°C: black ice detection, frost/slick spots, cold spray risk, chilled asphalt status
- **Engine label** — Deterministic (D-0 to D-14, high-resolution) vs. NOAA Ensemble (D-15+, probabilistic with spread ±°)

</details>

---

## Language Jump Links / 语言导航 / भाषा चयन

- [🇬🇧 English](#-english)
- [🇨🇳 中文 (Chinese)](#-中文-chinese)
- [🇮🇳 हिन्दी (Hindi)](#-हिन्दी-hindi)
- [🇪🇸 Español (Spanish)](#-español-spanish)
- [🇫🇷 Français (French)](#-français-french)
- [🇸🇦 العربية (Arabic)](#-العربية-arabic)
- [🇩🇪 Deutsch (German)](#-deutsch-german)
- [🇳🇱 Nederlands (Dutch)](#-nederlands-dutch)

---

## 🔗 Base Endpoints

| Service | Endpoint |
|---|---|
| **iCal / WebCal Feed** | `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec` |
| **AI Telemetry (JSON)** | Append `?action=status` to any URL above |

---

## 🔧 URL Parameters (Flags)

Append `?` for the first parameter and `&` for additional flags.

| Flag | Values | Default | Description |
|---|---|---|---|
| `cities` | Comma-separated *(Max 4)* | `London,Dublin` | Target locations (auto-geocoded via Open-Meteo) |
| `lang` | `en`, `zh`, `hi`, `es`, `fr`, `ar`, `de`, `nl` | `en` | Display language for event descriptions |
| `unit` | `celsius`, `fahrenheit` | `celsius` | Temperature scale |
| `days` | `1` to `30` | `30` | Forecast window |
| `hazards` | `true`, `false` | `true` | Road risk alerts (active when T_min ≤ 7°C) |
| `action` | `status`, `metrics` | *(none)* | Returns live JSON diagnostics |

> **⚠️ Quota Protection:** Hard cap of **4 cities** per request to prevent execution timeouts.

---

## 🌐 Universal Setup Guide

Do not download the `.ics` file; subscribe to the URL for automatic updates:
- **Apple Calendar (iOS):** Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. Set refresh to Hourly.
- **Apple Calendar (macOS):** File → New Calendar Subscription (`⌥⌘S`).
- **Outlook (Web/App):** Add Calendar → Subscribe from web.
- **Google Calendar (Web):** Other calendars (`+`) → From URL.

---

## 🌐 Air Quality Data Sources

| Source | Coverage | API Access | Best For |
|---|---|---|---|
| **Copernicus CAMS** (via Open-Meteo) | Europe | Built-in (free) | EAQI, pollen (EU residents) |
| **NOAA / US EPA** (via Open-Meteo) | United States | Built-in (free) | USAQI (US residents) |
| **OpenAQ** (openaq.org) | 200+ countries | Free API key, 60 req/min | Global PM2.5, PM10, NO₂, O₃ |
| **WAQI** (aqicn.org) | 1000+ stations | Free token, 1000 req/s | City-level AQI + forecast |
| **NASA FIRMS** (firms.modaps.eosdi.nasa.gov) | Global (fire/smoke) | Free, no key | Wildfire smoke advisories |

> **For developers:** OpenAQ and WAQI can be integrated via standard `UrlFetchApp.fetch()` calls in Google Apps Script. See the `gcalweather.gs` source for pattern.

---

# 🇬🇧 English

**Your personal weather dashboard — in any calendar app.**

Wake up to a calendar that shows you exactly what's coming. High-precision forecasts (D1–14) powered by Open-Meteo's deterministic model, extended with NOAA GFS 31-member ensemble projections for D15–30. Yesterday's predictions are verified against ground-truth data, so you always know how much trust to place in today's forecast. Air quality, UV rays, pollen, moon phases, meteor showers, and road-hazard alerts — all automatically delivered to your calendar.

- **D1–14:** Deterministic high-res forecast (temp, rain prob/vol, wind, pressure, UV, ET₀).
- **D15–30:** NOAA GFS 31-member probabilistic ensemble trajectory (`±°`).
- **D-5 to D-1:** Verified ground-truth logbook with D-countdown accuracy drift auditing.
- **Air Quality & Sky:** CAMS AQI, PM2.5, PM10, pollen count, moon phases, meteor peaks.
- **Road Hazards:** Ice/frost advisories auto-rendered only when T_min ≤ 7°C.

### 🇬🇧 Quick Links

- **British Isles (London & Edinburgh, 30 Days):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=London,Edinburgh`

- **US Metro in Fahrenheit (New York, Chicago, Seattle, 14 Days):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=New%20York,Chicago,Seattle&unit=fahrenheit&days=14`

- **No Road Hazard Warnings (Sydney & Melbourne):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Sydney,Melbourne&hazards=false`

- **AI Telemetry Endpoint (JSON):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?action=status`

---

# 🇨🇳 中文 (Chinese)

**把天气预报装进你的日历 — 订阅一次，全平台同步。**

每天早晨，你的日历自动呈现未来 30 天的精准天气：高分辨率确定性模型（D1–14）配合美国 NOAA GFS 集合预报（D15–30），历史预测与实测数据交叉验证，准确度实时审计。空气质量、紫外线、花粉指数、月相、流星雨峰值、道路结冰预警 — 全部自动推送到 Apple Calendar、Outlook、Google Calendar 或 Thunderbird。

- **第 1–14 天：** 高精度确定性融合模型（气温、体感、降水率/量、风速、气压、UV、ET₀）。
- **第 15–30 天：** 美国 NOAA GFS 31 成员集合预报模型（附带模型分歧度 `±°`）。
- **过去 5 天：** 历史实测回溯（Ground Truth），以 D 倒计时坐标审计预测漂移。
- **空气质量与天象：** 欧洲 CAMS AQI 指数、PM2.5、PM10、花粉浓度、月相、流星雨极大期。
- **道路安全：** 当气温 ≤ 7°C 时自动激活结冰与湿滑预警。

### 🇨🇳 快捷链接

- **京津冀与长三角 (北京与上海, 30天周期):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Beijing,Shanghai&lang=zh`

- **华南及大湾区核心城市 (广州、深圳、香港、台北, 14天):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Guangzhou,Shenzhen,Hong%20Kong,Taipei&lang=zh&days=14`

---

# 🇮🇳 हिन्दी (Hindi)

**अपने कैलेंडर में मौसम — बस एक बार सब्सक्राइब करें, सभी ऐप्स में अपडेट।**

हर सुबह आपका कैलेंडर आपको बताएगा कि आगे क्या आने वाला है। ओपन-मीटियो के उच्च-परिशुद्ध निर्धारक मॉडल (D1–14) से NOAA GFS 31-सदस्यीय समुच्चय पूर्वानुमान (D15–30) तक। कल के पूर्वानुमानों को वास्तविक डेटा से सत्यापित किया जाता है — ताकि आपको पता रहे कि आज के पूर्वानुमान पर कितना भरोसा करें। वायु गुणवत्ता, UV, पराग, चंद्र कलाएं, उल्कापिंड और सड़क खतरे — सब कुछ स्वचालित रूप से आपके कैलेंडर में।

- **दिन 1–14:** उच्च-सटीक पूर्वानुमान (तापमान, बारिश की संभावना/मात्रा, हवा, वायुदाब, UV, ET₀)।
- **दिन 15–30:** NOAA GFS 31-सदस्यीय संभावित मौसम मॉडल (सटीकता अंतर `±°` के साथ)।
- **पिछले 5 दिन:** वास्तविक दर्ज मौसम और D-काउंटडाउन प्रणाली पर आधारित मॉडल ऑडिट।
- **वायु गुणवत्ता और खगोल:** यूरोपीय CAMS AQI, PM2.5, PM10, पराग स्तर, चंद्र कलाएं, उल्कापिंड गतिविधि।
- **सड़क चेतावनी:** तापमान <= 7°C होने पर सड़क पर फिसलन और पाले की चेतावनी।

### 🇮🇳 तैयार लिंक

- **उत्तर भारत मेट्रो (दिल्ली और लखनऊ, 30 दिन):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Delhi,Lucknow&lang=hi`

- **भारतीय प्रमुख आर्थिक केंद्र (मुंबई, बेंगलुरु, हैदराबाद, कोलकाता, 14 दिन):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Mumbai,Bengaluru,Hyderabad,Kolkata&lang=hi&days=14`

---

# 🇪🇸 Español (Spanish)

**Tu panel meteorológico personal — en cualquier calendario.**

Recibe cada mañana lo que viene: temperaturas, lluvia, viento, UV, calidad del aire, fases lunares y alertas de hielo. El motor de predicción combina el modelo determinista de alta resolución (D1–14) con el conjunto probabilístico NOAA GFS de 31 miembros (D15–30), verificando cada predicción contra datos reales para mostrarte la fiabilidad real. Suscríbete una vez y recibe actualizaciones automáticas en Apple Calendar, Outlook, Google Calendar o Thunderbird.

- **Días 1–14:** Modelo determinista de alta resolución (temperatura, lluvia, viento, presión, UV, ET₀).
- **Días 15–30:** Modelo probabilístico NOAA GFS (31 miembros) con dispersión (`±°`).
- **Días -5 a -1:** Registro histórico verificado con auditoría de error según cuenta regresiva D.
- **Calidad del Aire y Cielo:** CAMS AQI, PM2.5, PM10, polen, fases lunares y lluvias de meteoros.
- **Seguridad Vial:** Advertencias automáticas de calzada deslizante activas solo con T_min ≤ 7°C.

### 🇪🇸 Enlaces Directos

- **Península Ibérica (Madrid y Barcelona, 30 Días):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Madrid,Barcelona&lang=es`

- **Hispanoamérica (Ciudad de México, Bogotá, Buenos Aires, Santiago, 14 Días):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Mexico%20City,Bogota,Buenos%20Aires,Santiago&lang=es&days=14`

---

# 🇫🇷 Français (French)

**Votre tableau de bord météo personnel — dans n'importe quel calendrier.**

Chaque matin, votre calendrier vous montre ce qui arrive. Des prévisions haute résolution (J1–14) combinées aux projections d'ensemble NOAA GFS à 31 membres (J15–30), avec vérification des prédictions passées contre les mesures réelles. Qualité de l'air, UV, pollen, phases lunaires, averses d'étoiles filantes et alertes routières — le tout automatiquement dans Apple Calendar, Outlook, Google Calendar ou Thunderbird.

- **J1–14 :** Modèle déterministe haute résolution (température, pluie, vent, pression, UV, ET₀).
- **J15–30 :** Ensemble probabiliste NOAA GFS (31 membres) avec dispersion (`±°`).
- **J-5 à J-1 :** Historique vérifié et calcul de dérive du modèle basé sur le compte à rebours D.
- **Qualité de l'Air & Espace :** CAMS AQI, PM2.5, PM10, pollens, phases lunaires, météo.
- **Sécurité Routière :** Alertes de verglas/gel activées uniquement lorsque T_min ≤ 7°C.

### 🇫🇷 Liens Prêts à l'Emploi

- **France Métropolitaine (Paris & Lyon, 30 Jours) :**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Paris,Lyon&lang=fr`

- **Espace Francophone (Marseille, Bruxelles, Genève, Montréal, 14 Jours) :**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Marseille,Brussels,Geneva,Montreal&lang=fr&days=14`

---

# 🇸🇦 العربية (Arabic)

**لوحة الطقس الشخصية — في أي تقويم تريد.**

كل صباح، يُطلعك تقويمك على ما هو قادم. نماذج تنبؤية عالية الدقة (اليوم 1–14) مع إسقاطات مجموعة NOAA GFS ذات الـ 31 عضوًا (اليوم 15–30)، مع التحقق من كل توقع مقابل البيانات الفعلية. جودة الهواء، الأشعة فوق البنفسجية، حبوب اللقاح، أطوار القمر، زخات الشهب وتحذيرات الطرق — كل ذلك يُرسَل تلقائيًا إلى تقويمك.

- **الأيام 1–14:** نماذج حتمية عالية الدقة (الحرارة، المطر، الرياح، الضغط، UV، التبخر ET₀).
- **الأيام 15–30:** نموذج التجميع الاحتمالي NOAA GFS مع نسبة تشتت النموذج (`±°`).
- **الأيام السابقة (-5 إلى -1):** سجل الرصد الواقعي لقياس هامش خطأ التوقعات بنظام العد التنازلي D.
- **جودة الهواء والفلك:** مؤشر CAMS AQI، والجسيمات PM2.5/PM10، واللقاح، ومنازل القمر والشهب.
- **مخاطر الطرق:** تنبيهات الصقيع والانزلاق تتفعل تلقائياً فقط عند حرارة <= 7°C.

### 🇸🇦 روابط مباشرة

- **الخليج العربي (الرياض وأبوظبي, 30 يوماً):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Riyadh,Abu%20Dhabi&lang=ar`

- **عواصم عربية كبرى (القاهرة، دبي، الدوحة، عمّان, 14 يوماً):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Cairo,Dubai,Doha,Amman&lang=ar&days=14`

---

# 🇩🇪 Deutsch (German)

**Ihr persönliches Wetter-Dashboard — in jedem Kalender.**

Jeden Morgen zeigt Ihnen Ihr Kalender, was kommt. Hochauflösende Vorhersagen (T1–14) kombiniert mit NOAA GFS 31-Member Ensemble-Projektionen (T15–30), mit Echtzeit-Verifizierung gegen Messdaten. Luftqualität, UV-Index, Pollen, Mondphasen, Sternschnuppen-Ströme und Straßen-Warnungen — alles automatisch in Apple Calendar, Outlook, Google Calendar oder Thunderbird.

- **T1–14:** Hochauflösende deterministische Vorhersagen (Temperatur, Regen, Wind, Druck, UV, ET₀).
- **T15–30:** Probabilistisches NOAA GFS 31-Member Ensemble mit Unsicherheitsbereich (`±°`).
- **T-5 bis T-1:** Verifiziertes Realdaten-Logbuch mit Modellabweichungs-Audit via D-Countdown.
- **Luftqualität & Himmel:** CAMS AQI, PM2.5, PM10, Pollenflug, Mondphasen und Sternschnuppen-Peaks.
- **Straßenglätte:** Automatische Warnungen aktiv ausschließlich bei T_min ≤ 7°C.

### 🇩🇪 Sofort-Links

- **Deutschland Achse (Berlin & München, 30 Tage):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Berlin,Munich&lang=de`

- **DACH-Großstädte (Hamburg, Frankfurt, Wien, Zürich, 14 Tage):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Hamburg,Frankfurt,Vienna,Zurich&lang=de&days=14`

---

# 🇳🇱 Nederlands (Dutch)

**Uw persoonlijke weer-dashboard — in elke agenda.**

Elke ochtend toont uw agenda wat er aankomt. Hoge-resolutie voorspellingen (D1–14) gecombineerd met NOAA GFS 31-lid ensemble-projecties (D15–30), met verificatie tegen actuele metingen. Luchtkwaliteit, UV-index, pollen, maanfasen, meteoorregens en wegwaarschuwingen — allemaal automatisch in Apple Calendar, Outlook, Google Calendar of Thunderbird.

- **D1–14:** Deterministische hoge-resolutie modellen (temperatuur, regen, wind, luchtdruk, UV, ET₀).
- **D15–30:** NOAA GFS 31-lid ensemble projecties met modelspreiding (`±°`).
- **D-5 tot D-1:** Geverifieerd waarnemingenlogboek met drift-auditing volgens D-aftellogica.
- **Luchtkwaliteit & Hemel:** CAMS LKI/AQI, PM2.5, PM10, pollenbelasting, maanfasen en meteorenzwermen.
- **Wegcondities:** Gladheidswaarschuwingen automatisch actief zodra T_min ≤ 7°C.

### 🇳🇱 Directe Links

- **Randstad Hart (Amsterdam & Rotterdam, 30 Dagen):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Amsterdam,Rotterdam&lang=nl`

- **Benelux Knooppunten (Utrecht, Eindhoven, Antwerpen, Gent, 14 Dagen):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=Utrecht,Eindhoven,Antwerp,Ghent&lang=nl&days=14`

- **Kustzone Zonder Gladheidswaarschuwingen (Den Haag & Vlissingen):**  
  `https://script.google.com/macros/s/AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg/exec?cities=The%20Hague,Vlissingen&lang=nl&hazards=false`
