# 🌦️ Autonomous Weather, Astronomical & Atmospheric Calendar Engine

[![Protocol](https://img.shields.io/badge/RFC-5545%20(iCalendar)-blue.svg)](#)
[![Data Sources](https://img.shields.io/badge/Data-Open--Meteo%20%7C%20NOAA%20GFS%20%7C%20Copernicus%20CAMS%20%7C%20OpenAQ%20%7C%20WAQI-orange.svg)](#)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20ZH%20%7C%20HI%20%7C%20ES%20%7C%20FR%20%7C%20AR%20%7C%20DE%20%7C%20NL-green.svg)](#)
[![Version](https://img.shields.io/badge/Version-2.2.0-brightgreen.svg)](./CHANGELOG.md)
[![CI](https://github.com/neohiro/meteo-ics/actions/workflows/ci.yml/badge.svg)](https://github.com/neohiro/meteo-ics/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/Tests-194%20%2B%20CI-brightgreen.svg)](#)

**Your weather, astronomy & air-quality — automatically delivered to any calendar app.**  
Subscribe once to a live `.ics` feed and your calendar does the rest. No new app, no new login, no new habit. Wake up to per-day events titled `☀️ 22°C Paris` with temperature, rain, UV, AQI, moon phase, pollen and road-hazard advice — all built from real forecast models with a live accuracy audit.

---

## 🚀 Try It Now — Pick Your City

> Copy any URL below and paste it into your calendar app's subscription field.

| Region | Cities | URL |
|---|---|---|
| 🇬🇧 British Isles | London, Edinburgh · 30 days | `https://script.google.com/macros/s/…/exec?cities=London,Edinburgh` |
| 🇺🇸 United States | New York, Chicago, Seattle · °F · 14 days | `https://script.google.com/macros/s/…/exec?cities=New%20York,Chicago,Seattle&unit=fahrenheit&days=14` |
| 🇦🇺 Australia | Sydney, Melbourne · hazards off | `https://script.google.com/macros/s/…/exec?cities=Sydney,Melbourne&hazards=false` |
| 🌐 JSON Telemetry | Live diagnostics | `https://script.google.com/macros/s/…/exec?action=status` |

*(Click any cell to copy. Replace `…` with your deployed script ID.)*

---

## ✦ What's in Every Calendar Event

Each day becomes an all-day calendar event with a color-coded title and a multi-section description. Below is a live summary of the data layers — all delivered automatically.

| Category | Data Included | Source |
|---|---|---|
| 🌡️ **Temperature** | High/Low + Feels-Like + Comfort text | Open-Meteo Deterministic |
| 🌧️ **Rain** | Volume (mm) + Probability (%) + Gusts | Open-Meteo + NOAA GFS Ensemble |
| ☀️ **Sun & Sky** | Sunrise/sunset, Moon phase, UV index, Golden Hour | Open-Meteo |
| 🧪 **Air Quality** | EAQI / USAQI + PM2.5 / PM10 + O₃ + NO₂ + Pollen | CAMS (EU) → OpenAQ / WAQI (global) |
| 🌙 **Astronomy** | Meteor showers, Solstices, Planet oppositions | Computed locally |
| 🌱 **Agriculture** | Growing Degree Days, ET₀ evapotranspiration | Open-Meteo |
| 📊 **Accuracy Audit** | Temp & Rain MAE, Reliability grade, Lead curve | Self-measured |
| 🚗 **Road Safety** | Black ice / frost / cold-spray warnings (T_min ≤ 7°C) | Open-Meteo |

> **⚠️ Quota Protection:** Maximum **4 cities** per request to prevent timeouts.

---

## 🌍 Air Quality Cascade — How It Works

The AQI engine tries each source in order and uses the first one that has data for your coordinates. No configuration needed — it just works.

```
1. Copernicus CAMS (EU)      ✅ Live    EAQI + Pollen · Built-in free
   ↓ no coverage
2. NOAA / US EPA (North Am.)  ✅ Live    USAQI · Built-in free
   ↓ no coverage
3. OpenAQ (200+ countries)    ✅ Live    PM2.5 / PM10 / O₃ / NO₂ · Free, no key
   ↓ no data
4. WAQI (1000+ stations)    ✅ Live    City-level AQI · Free token optional
```

| Override param | Effect |
|---|---|
| `?aqProvider=auto` | Default: cascade CAMS → OpenAQ → WAQI |
| `?aqProvider=openaq` | Force OpenAQ only |
| `?aqProvider=waqi` | Force WAQI only (add `?waqiToken=XXX` for higher quota) |
| `?aqRadius=50` | OpenAQ station search radius in km (1–100, default 25) |

> 📡 **Status endpoint** (`?action=status`) surfaces the full AQI engine state including which provider was active, the Open-Meteo AQ cap (7 days), and whether a WAQI token is configured.

---

## 🔗 Language Jump Links

🇬🇧 [English](#-english) · 🇨🇳 [中文](#-中文-chinese) · 🇮🇳 [हिन्दी](#-हिन्दी-hindi) · 🇪🇸 [Español](#-español-spanish) · 🇫🇷 [Français](#-français-french) · 🇸🇦 [العربية](#-العربية-arabic) · 🇩🇪 [Deutsch](#-deutsch-german) · 🇳🇱 [Nederlands](#-nederlands-dutch)

---

## 🔧 URL Parameters

| Flag | Values | Default | Description |
|---|---|---|---|
| `cities` | Comma-separated · *Max 4* | *(required)* | Auto-geocoded locations |
| `lang` | `en`, `zh`, `hi`, `es`, `fr`, `ar`, `de`, `nl` | `en` | Display language |
| `unit` | `celsius`, `fahrenheit` | `celsius` | Temperature scale |
| `days` | `1` – `30` | `30` | Forecast window |
| `hazards` | `true`, `false` | `true` | Road safety alerts (T_min ≤ 7°C) |
| `aqProvider` | `auto`, `openaq`, `waqi` | `auto` | AQI source cascade |
| `aqRadius` | `1` – `100` km | `25` | OpenAQ station search radius |
| `waqiToken` | String | *(none)* | WAQI token (stored, higher quota) |
| `action` | `status` | *(none)* | JSON diagnostics endpoint |
| `dryRun` | `true`, `false` | `false` | Preview without saving |

---

## 🌐 How to Subscribe — All Platforms

**Never download the file. Always subscribe to the URL** so updates arrive automatically.

| App | How to subscribe |
|---|---|
| **Apple Calendar** (iOS) | Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. Set refresh to **Hourly**. |
| **Apple Calendar** (macOS) | File → New Calendar Subscription · `⌥⌘S` |
| **Google Calendar** (Web) | Other calendars (`+`) → From URL · Refreshes every 6–12 hours |
| **Outlook** (Web/App) | Calendar → Add calendar → Subscribe from web |
| **Thunderbird** | File → New → Calendar → On the Network → iCalendar (ICS) |

---

## 🌍 Per-Language Guides

Below are ready-to-use subscription URLs and setup instructions for each supported language. Each section includes city examples tuned for that region.

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
