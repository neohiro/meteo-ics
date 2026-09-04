# 🌦️ Autonomous Weather, Astronomical & Atmospheric Calendar Engine

[![Protocol](https://img.shields.io/badge/RFC-5545%20(iCalendar)-blue.svg)](#)
[![Data Sources](https://img.shields.io/badge/Data-Open--Meteo%20%7C%20NOAA%20GFS%20%7C%20Copernicus%20CAMS%20%7C%20OpenAQ%20%7C%20WAQI-orange.svg)](#)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20ZH%20%7C%20HI%20%7C%20ES%20%7C%20FR%20%7C%20AR%20%7C%20DE%20%7C%20NL-green.svg)](#)
[![Version](https://img.shields.io/badge/Version-2.2.0-brightgreen.svg)](./CHANGELOG.md)

**Your weather, astronomy & air-quality — automatically delivered to any calendar app.**  
Subscribe once to a live `.ics` feed (Apple Calendar, Outlook, Google Calendar, Thunderbird) or deploy the Google Apps Script to get personalized, location-aware weather dashboards synced directly to your Google Calendar. Every morning, your calendar shows you what's coming — temperature swings, rain probability, road hazards, UV index, pollen loads, moon phases, and even meteor showers — with a built-in forecast accuracy audit that learns from reality over time.

---

## 🌟 What This Service Does — At a Glance

> **Transform your calendar into a personal meteorologist.**  
> Stop checking weather apps. Your calendar already shows you your day — now it also shows you what's coming: hot, cold, wet, wild, hazy, or perfect. Real forecast data from Open-Meteo, NOAA GFS ensembles, Copernicus CAMS, OpenAQ (200+ countries), and WAQI (1000+ stations) — delivered automatically to Apple Calendar, Outlook, Google Calendar, or Thunderbird via a simple `.ics` subscription URL.

### What's new in 2.2.0

- **Global AQI Engine** — When a city is outside the Open-Meteo CAMS coverage (most of Africa, South America, South & Southeast Asia, Pacific islands, etc.), the engine transparently falls back to **OpenAQ v3** (free, no key) and then **WAQI** (token-optional). One URL parameter — `aqProvider=auto|openmeteo|openaq|waqi` — controls the source. See the [Air Quality Data Sources](#-air-quality-data-sources) section for details.
- **WAQI token passthrough** — Provide your own WAQI API token via `?waqiToken=XXX` and it will be stored in `ScriptProperties` for higher rate limits.
- **13 new tests** (172 total) cover the OpenAQ/WAQI integration, URL parameter parsing, and the new fallback paths.
- **GitHub Actions CI** runs the full test suite on every push and PR.
- **CHANGELOG.md** with full release notes from 2.2.0 backwards.

### Why calendars?

Your calendar is the one app you already check every morning. A weather forecast that lives *inside* the calendar — as a per-day all-day event titled "☀️ 22°C Paris" — is the most natural place for it. You glance at the day and you immediately know: dress warm, take the umbrella, drive carefully, the AQI is bad today. No new app, no new habit, no new login.

### How it works under the hood

1. **You request a URL** (e.g. `?cities=Tokyo&lang=ja&days=14`) once. The script auto-geocodes the city via Open-Meteo's free geocoder, fetches 4 endpoints in parallel (deterministic forecast, hourly aggregates, NOAA GFS ensemble, and air quality), and assembles them into one ICS feed.
2. **Your calendar subscribes** to that URL and refreshes it on its own schedule (Apple Calendar: every hour; Google Calendar: every 6–12 hours; Outlook: every 24 hours by default).
3. **Each day is a calendar event** with a colored title (e.g. blue=cool, orange=warm, red=hot) and a multi-section description showing temperature, sky, rain, wind, sun, moon, AQI, UV, pollen, road conditions (when T_min ≤ 7°C), 7-day aggregates, and a model accuracy audit.
4. **The script self-audits**: every day, the latest forecast snapshot is stored in `ScriptProperties` (capped at 5 snapshots per day per city, retained 45 days). Once a day becomes "past", the stored actuals are compared against each historical snapshot to compute a lifetime Mean Absolute Error (MAE) for both temperature and precipitation, plus a lead-curve breakdown (D1–3, D4–7, D8–14, D15+).
5. **You see your model's reliability** before you trust the forecast. After ~7 days of operation, the dashboard shows `±2.3°C` (lifetime), `A (High)`, and a lead curve: `D1-3:±0.8° · D4-7:±1.7° · D8-14:±2.9° · D15+:±4.3°`.

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
| **iCal / WebCal Feed** | `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec` |
| **AI Telemetry (JSON)** | Append `?action=status` to any URL above |

---

## 🔧 URL Parameters (Flags)

Append `?` for the first parameter and `&` for additional flags.

| Flag | Values | Default | Description |
|---|---|---|---|
| `cities` | Comma-separated *(Max 4)* | *(required — none)* | Target locations (auto-geocoded via Open-Meteo) |
| `lang` | `en`, `zh`, `hi`, `es`, `fr`, `ar`, `de`, `nl` | `en` | Display language for event descriptions |
| `unit` | `celsius`, `fahrenheit` | `celsius` | Temperature scale |
| `days` | `1` to `30` | `30` | Forecast window |
| `hazards` | `true`, `false` | `true` | Road risk alerts (active when T_min ≤ 7°C) |
| `aqProvider` | `auto`, `openmeteo`, `openaq`, `waqi` | `auto` | AQI source: `auto` cascades CAMS → USAQI → OpenAQ → WAQI; specific values force a single source |
| `waqiToken` | any string | *(none)* | WAQI API token (stored in `ScriptProperties` for higher rate limit) |
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

The AQI engine has a priority cascade. For each city, it tries them in order and uses the first one that returns data:

| Priority | Source | Coverage | API Access | Best For | Status |
|---|---|---|---|---|---|
| 1 | **Copernicus CAMS** (via Open-Meteo) | Europe | Built-in (free) | EAQI, pollen (EU residents) | ✅ Live |
| 2 | **NOAA / US EPA** (via Open-Meteo) | United States | Built-in (free) | USAQI (US residents) | ✅ Live |
| 3 | **OpenAQ** (openaq.org v3) | 200+ countries | Free, no key (60 req/min) | Global PM2.5, PM10, NO₂, O₃ | ✅ Live (v2.2.0+) |
| 4 | **WAQI** (aqicn.org) | 1000+ stations | Free token optional (1000 req/s with token) | City-level AQI (any country) | ✅ Live (v2.2.0+) |
| 5 | **NASA FIRMS** (firms.modaps.eosdi.nasa.gov) | Global (fire/smoke) | Free, no key | Wildfire smoke advisories | 📝 Roadmap |

The `aqProvider` URL parameter lets you override the cascade:
- `aqProvider=auto` (default) — try CAMS → USAQI → OpenAQ → WAQI in order
- `aqProvider=openmeteo` — only CAMS/USAQI (no global fallback)
- `aqProvider=openaq` — force OpenAQ only
- `aqProvider=waqi` — force WAQI only (provide `?waqiToken=XXX` for higher quota)

**Example:** a city in Lagos, Nigeria, with no CAMS coverage: `?cities=Lagos&aqProvider=auto` will automatically fall through to OpenAQ for the AQI value.

> **For developers:** the OpenAQ and WAQI integration lives in `fetchGlobalAQI()` (icalweather.gs) and `gcalFetchGlobalAQI()` (gcalweather.gs). Both attempt OpenAQ first, then WAQI, and merge results into the same `data.aq` shape that downstream consumers expect — so no other code needs to change when you switch providers.

---

# 🇬🇧 English

**Your personal weather dashboard — in any calendar app.**

Wake up to a calendar that shows you exactly what's coming. High-precision forecasts (D1–14) powered by Open-Meteo's deterministic model, extended with NOAA GFS 31-member ensemble projections for D15–30. Yesterday's predictions are verified against ground-truth data, so you always know how much trust to place in today's forecast. Air quality, UV rays, pollen, moon phases, meteor showers, and road-hazard alerts — all automatically delivered to your calendar.

- **D1–14:** Deterministic high-res forecast (temp, rain prob/vol, wind, pressure, UV, ET₀).
- **D15–30:** NOAA GFS 31-member probabilistic ensemble trajectory (`±°`).
- **D-5 to D-1:** Verified ground-truth logbook with D-countdown accuracy drift auditing.
- **Air Quality & Sky:** CAMS AQI (Europe) / US EPA AQI (North America) / **OpenAQ + WAQI global fallback** (200+ countries) — PM2.5, PM10, pollen count, moon phases, meteor peaks.
- **Road Hazards:** Ice/frost advisories auto-rendered only when T_min ≤ 7°C.
- **Global AQI Engine (v2.2.0+):** when the Open-Meteo CAMS/NOAA endpoints return no data for a region (most of Africa, South America, South & Southeast Asia, Pacific islands), the script transparently falls back to OpenAQ (free, no key) and then WAQI (token-optional). Override with `?aqProvider=openaq` or `?aqProvider=waqi` to force a specific source.

### 🇬🇧 Quick Links

- **British Isles (London & Edinburgh, 30 Days):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=London,Edinburgh`

- **US Metro in Fahrenheit (New York, Chicago, Seattle, 14 Days):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=New%20York,Chicago,Seattle&unit=fahrenheit&days=14`

- **No Road Hazard Warnings (Sydney & Melbourne):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Sydney,Melbourne&hazards=false`

- **AI Telemetry Endpoint (JSON):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?action=status`

---

# 🇨🇳 中文 (Chinese)

**把天气预报装进你的日历 — 订阅一次，全平台同步。**

每天早晨，你的日历自动呈现未来 30 天的精准天气：高分辨率确定性模型（D1–14）配合美国 NOAA GFS 集合预报（D15–30），历史预测与实测数据交叉验证，准确度实时审计。空气质量、紫外线、花粉指数、月相、流星雨峰值、道路结冰预警 — 全部自动推送到 Apple Calendar、Outlook、Google Calendar 或 Thunderbird。

- **第 1–14 天：** 高精度确定性融合模型（气温、体感、降水率/量、风速、气压、UV、ET₀）。
- **第 15–30 天：** 美国 NOAA GFS 31 成员集合预报模型（附带模型分歧度 `±°`）。
- **过去 5 天：** 历史实测回溯（Ground Truth），以 D 倒计时坐标审计预测漂移。
- **空气质量与天象：** 欧洲 CAMS AQI 指数、PM2.5、PM10、花粉浓度、月相、流星雨极大期。
- **全球空气质量引擎 (v2.2.0+)：** 在 CAMS 与美国 EPA AQI 覆盖范围之外（非洲、南美洲、南亚/东南亚、太平洋岛国等），脚本自动回退到 **OpenAQ**（200+ 国家，免费，无需密钥）和 **WAQI**（1000+ 站点，可选 token）。使用 `?aqProvider=openaq` 或 `?aqProvider=waqi` 强制指定数据源。
- **道路安全：** 当气温 ≤ 7°C 时自动激活结冰与湿滑预警。

### 🇨🇳 快捷链接

- **京津冀与长三角 (北京与上海, 30天周期):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Beijing,Shanghai&lang=zh`

- **华南及大湾区核心城市 (广州、深圳、香港、台北, 14天):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Guangzhou,Shenzhen,Hong%20Kong,Taipei&lang=zh&days=14`

---

# 🇮🇳 हिन्दी (Hindi)

**अपने कैलेंडर में मौसम — बस एक बार सब्सक्राइब करें, सभी ऐप्स में अपडेट।**

हर सुबह आपका कैलेंडर आपको बताएगा कि आगे क्या आने वाला है। ओपन-मीटियो के उच्च-परिशुद्ध निर्धारक मॉडल (D1–14) से NOAA GFS 31-सदस्यीय समुच्चय पूर्वानुमान (D15–30) तक। कल के पूर्वानुमानों को वास्तविक डेटा से सत्यापित किया जाता है — ताकि आपको पता रहे कि आज के पूर्वानुमान पर कितना भरोसा करें। वायु गुणवत्ता, UV, पराग, चंद्र कलाएं, उल्कापिंड और सड़क खतरे — सब कुछ स्वचालित रूप से आपके कैलेंडर में।

- **दिन 1–14:** उच्च-सटीक पूर्वानुमान (तापमान, बारिश की संभावना/मात्रा, हवा, वायुदाब, UV, ET₀)।
- **दिन 15–30:** NOAA GFS 31-सदस्यीय संभावित मौसम मॉडल (सटीकता अंतर `±°` के साथ)।
- **पिछले 5 दिन:** वास्तविक दर्ज मौसम और D-काउंटडाउन प्रणाली पर आधारित मॉडल ऑडिट।
- **वायु गुणवत्ता और खगोल:** यूरोपीय CAMS AQI, PM2.5, PM10, पराग स्तर, चंद्र कलाएं, उल्कापिंड गतिविधि।
- **वैश्विक AQI इंजन (v2.2.0+):** जब कोई शहर CAMS/नोएए EPA AQI कवरेज से बाहर है (अफ्रीका, दक्षिण अमेरिका, दक्षिण/दक्षिण-पूर्व एशिया, प्रशांत द्वीप समूह), तो स्क्रिप्ट स्वचालित रूप से **OpenAQ** (200+ देश, मुफ्त, बिना कुंजी) और फिर **WAQI** (token-वैकल्पिक) पर गिरती है। `?aqProvider=openaq` या `?aqProvider=waqi` से विशेष स्रोत बाध्य करें।
- **सड़क चेतावनी:** तापमान <= 7°C होने पर सड़क पर फिसलन और पाले की चेतावनी।

### 🇮🇳 तैयार लिंक

- **उत्तर भारत मेट्रो (दिल्ली और लखनऊ, 30 दिन):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Delhi,Lucknow&lang=hi`

- **भारतीय प्रमुख आर्थिक केंद्र (मुंबई, बेंगलुरु, हैदराबाद, कोलकाता, 14 दिन):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Mumbai,Bengaluru,Hyderabad,Kolkata&lang=hi&days=14`

---

# 🇪🇸 Español (Spanish)

**Tu panel meteorológico personal — en cualquier calendario.**

Recibe cada mañana lo que viene: temperaturas, lluvia, viento, UV, calidad del aire, fases lunares y alertas de hielo. El motor de predicción combina el modelo determinista de alta resolución (D1–14) con el conjunto probabilístico NOAA GFS de 31 miembros (D15–30), verificando cada predicción contra datos reales para mostrarte la fiabilidad real. Suscríbete una vez y recibe actualizaciones automáticas en Apple Calendar, Outlook, Google Calendar o Thunderbird.

- **Días 1–14:** Modelo determinista de alta resolución (temperatura, lluvia, viento, presión, UV, ET₀).
- **Días 15–30:** Modelo probabilístico NOAA GFS (31 miembros) con dispersión (`±°`).
- **Días -5 a -1:** Registro histórico verificado con auditoría de error según cuenta regresiva D.
- **Calidad del Aire y Cielo:** CAMS AQI, PM2.5, PM10, polen, fases lunares y lluvias de meteoros.
- **Motor AQI global (v2.2.0+):** cuando una ciudad queda fuera de la cobertura CAMS/EPA (África, Sudamérica, Sur/Sureste asiático, islas del Pacífico), el script recurre automáticamente a **OpenAQ** (200+ países, gratis, sin clave) y luego a **WAQI** (token opcional). Usa `?aqProvider=openaq` o `?aqProvider=waqi` para forzar una fuente.
- **Seguridad Vial:** Advertencias automáticas de calzada deslizante activas solo con T_min ≤ 7°C.

### 🇪🇸 Enlaces Directos

- **Península Ibérica (Madrid y Barcelona, 30 Días):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Madrid,Barcelona&lang=es`

- **Hispanoamérica (Ciudad de México, Bogotá, Buenos Aires, Santiago, 14 Días):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Mexico%20City,Bogota,Buenos%20Aires,Santiago&lang=es&days=14`

---

# 🇫🇷 Français (French)

**Votre tableau de bord météo personnel — dans n'importe quel calendrier.**

Chaque matin, votre calendrier vous montre ce qui arrive. Des prévisions haute résolution (J1–14) combinées aux projections d'ensemble NOAA GFS à 31 membres (J15–30), avec vérification des prédictions passées contre les mesures réelles. Qualité de l'air, UV, pollen, phases lunaires, averses d'étoiles filantes et alertes routières — le tout automatiquement dans Apple Calendar, Outlook, Google Calendar ou Thunderbird.

- **J1–14 :** Modèle déterministe haute résolution (température, pluie, vent, pression, UV, ET₀).
- **J15–30 :** Ensemble probabiliste NOAA GFS (31 membres) avec dispersion (`±°`).
- **J-5 à J-1 :** Historique vérifié et calcul de dérive du modèle basé sur le compte à rebours D.
- **Qualité de l'Air & Espace :** CAMS AQI, PM2.5, PM10, pollens, phases lunaires, météo.
- **Moteur AQI mondial (v2.2.0+) :** lorsqu'une ville est hors couverture CAMS/EPA (Afrique, Amérique du Sud, Asie du Sud/du Sud-Est, îles du Pacifique), le script bascule automatiquement sur **OpenAQ** (200+ pays, gratuit, sans clé) puis sur **WAQI** (jeton optionnel). Forcer une source avec `?aqProvider=openaq` ou `?aqProvider=waqi`.
- **Sécurité Routière :** Alertes de verglas/gel activées uniquement lorsque T_min ≤ 7°C.

### 🇫🇷 Liens Prêts à l'Emploi

- **France Métropolitaine (Paris & Lyon, 30 Jours) :**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Paris,Lyon&lang=fr`

- **Espace Francophone (Marseille, Bruxelles, Genève, Montréal, 14 Jours) :**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Marseille,Brussels,Geneva,Montreal&lang=fr&days=14`

---

# 🇸🇦 العربية (Arabic)

**لوحة الطقس الشخصية — في أي تقويم تريد.**

كل صباح، يُطلعك تقويمك على ما هو قادم. نماذج تنبؤية عالية الدقة (اليوم 1–14) مع إسقاطات مجموعة NOAA GFS ذات الـ 31 عضوًا (اليوم 15–30)، مع التحقق من كل توقع مقابل البيانات الفعلية. جودة الهواء، الأشعة فوق البنفسجية، حبوب اللقاح، أطوار القمر، زخات الشهب وتحذيرات الطرق — كل ذلك يُرسَل تلقائيًا إلى تقويمك.

- **الأيام 1–14:** نماذج حتمية عالية الدقة (الحرارة، المطر، الرياح، الضغط، UV، التبخر ET₀).
- **الأيام 15–30:** نموذج التجميع الاحتمالي NOAA GFS مع نسبة تشتت النموذج (`±°`).
- **الأيام السابقة (-5 إلى -1):** سجل الرصد الواقعي لقياس هامش خطأ التوقعات بنظام العد التنازلي D.
- **جودة الهواء والفلك:** مؤشر CAMS AQI، والجسيمات PM2.5/PM10، واللقاح، ومنازل القمر والشهب.
- **محرك AQI العالمي (v2.2.0+):** عندما تقع مدينة خارج تغطية CAMS/EPA (أفريقيا، أمريكا الجنوبية، جنوب/جنوب شرق آسيا، جزر المحيط الهادئ)، يلجأ السكريبت تلقائياً إلى **OpenAQ** (200+ دولة، مجاني، بدون مفتاح) ثم **WAQI** (رمز اختياري). اضغط `?aqProvider=openaq` أو `?aqProvider=waqi` لإجبار مصدر محدد.
- **مخاطر الطرق:** تنبيهات الصقيع والانزلاق تتفعل تلقائياً فقط عند حرارة <= 7°C.

### 🇸🇦 روابط مباشرة

- **الخليج العربي (الرياض وأبوظبي, 30 يوماً):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Riyadh,Abu%20Dhabi&lang=ar`

- **عواصم عربية كبرى (القاهرة، دبي، الدوحة، عمّان, 14 يوماً):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Cairo,Dubai,Doha,Amman&lang=ar&days=14`

---

# 🇩🇪 Deutsch (German)

**Ihr persönliches Wetter-Dashboard — in jedem Kalender.**

Jeden Morgen zeigt Ihnen Ihr Kalender, was kommt. Hochauflösende Vorhersagen (T1–14) kombiniert mit NOAA GFS 31-Member Ensemble-Projektionen (T15–30), mit Echtzeit-Verifizierung gegen Messdaten. Luftqualität, UV-Index, Pollen, Mondphasen, Sternschnuppen-Ströme und Straßen-Warnungen — alles automatisch in Apple Calendar, Outlook, Google Calendar oder Thunderbird.

- **T1–14:** Hochauflösende deterministische Vorhersagen (Temperatur, Regen, Wind, Druck, UV, ET₀).
- **T15–30:** Probabilistisches NOAA GFS 31-Member Ensemble mit Unsicherheitsbereich (`±°`).
- **T-5 bis T-1:** Verifiziertes Realdaten-Logbuch mit Modellabweichungs-Audit via D-Countdown.
- **Luftqualität & Himmel:** CAMS AQI, PM2.5, PM10, Pollenflug, Mondphasen und Sternschnuppen-Peaks.
- **Globale AQI-Engine (v2.2.0+):** Liegt eine Stadt außerhalb der CAMS/EPA-Abdeckung (Afrika, Südamerika, Süd-/Südostasien, Pazifikinseln), fällt das Skript automatisch auf **OpenAQ** (200+ Länder, kostenlos, ohne Schlüssel) und dann auf **WAQI** (Token optional) zurück. Mit `?aqProvider=openaq` oder `?aqProvider=waqi` eine bestimmte Quelle erzwingen.
- **Straßenglätte:** Automatische Warnungen aktiv ausschließlich bei T_min ≤ 7°C.

### 🇩🇪 Sofort-Links

- **Deutschland Achse (Berlin & München, 30 Tage):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Berlin,Munich&lang=de`

- **DACH-Großstädte (Hamburg, Frankfurt, Wien, Zürich, 14 Tage):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Hamburg,Frankfurt,Vienna,Zurich&lang=de&days=14`

---

# 🇳🇱 Nederlands (Dutch)

**Uw persoonlijke weer-dashboard — in elke agenda.**

Elke ochtend toont uw agenda wat er aankomt. Hoge-resolutie voorspellingen (D1–14) gecombineerd met NOAA GFS 31-lid ensemble-projecties (D15–30), met verificatie tegen actuele metingen. Luchtkwaliteit, UV-index, pollen, maanfasen, meteoorregens en wegwaarschuwingen — allemaal automatisch in Apple Calendar, Outlook, Google Calendar of Thunderbird.

- **D1–14:** Deterministische hoge-resolutie modellen (temperatuur, regen, wind, luchtdruk, UV, ET₀).
- **D15–30:** NOAA GFS 31-lid ensemble projecties met modelspreiding (`±°`).
- **D-5 tot D-1:** Geverifieerd waarnemingenlogboek met drift-auditing volgens D-aftellogica.
- **Luchtkwaliteit & Hemel:** CAMS LKI/AQI, PM2.5, PM10, pollenbelasting, maanfasen en meteorenzwermen.
- **Wereldwijde AQI-engine (v2.2.0+):** valt een stad buiten de CAMS/EPA-dekking (Afrika, Zuid-Amerika, Zuid-/Zuidoost-Azië, Pacifische eilanden), dan valt het script automatisch terug op **OpenAQ** (200+ landen, gratis, geen sleutel) en daarna op **WAQI** (token optioneel). Gebruik `?aqProvider=openaq` of `?aqProvider=waqi` om een specifieke bron te forceren.
- **Wegcondities:** Gladheidswaarschuwingen automatisch actief zodra T_min ≤ 7°C.

### 🇳🇱 Directe Links

- **Randstad Hart (Amsterdam & Rotterdam, 30 Dagen):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Amsterdam,Rotterdam&lang=nl`

- **Benelux Knooppunten (Utrecht, Eindhoven, Antwerpen, Gent, 14 Dagen):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=Utrecht,Eindhoven,Antwerp,Ghent&lang=nl&days=14`

- **Kustzone Zonder Gladheidswaarschuwingen (Den Haag & Vlissingen):**  
  `https://script.google.com/macros/s/AKfycbw1gKGanPWuP36IcmQDjZ5VxEdwE0utSRuHzLGFv6-JMWBpiJgp9jRWwcMXAr-W0TcaFQ/exec?cities=The%20Hague,Vlissingen&lang=nl&hazards=false`
