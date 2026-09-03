# 🌦️ Autonomous Weather, Astronomical & Atmospheric Calendar Engine

[![Protocol](https://img.shields.io/badge/RFC-5545%20(iCalendar)-blue.svg)](#)
[![Data Sources](https://img.shields.io/badge/Data-Open--Meteo%20%7C%20NOAA%20GFS%20%7C%20Copernicus%20CAMS-orange.svg)](#)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20ZH%20%7C%20HI%20%7C%20ES%20%7C%20FR%20%7C%20AR%20%7C%20DE%20%7C%20NL-green.svg)](#)

High-precision, cross-platform calendar subscription (`.ics` / WebCal) powered by Open-Meteo, NOAA GFS Ensembles, and Copernicus CAMS. Compatible with Apple Calendar, Microsoft Outlook, Google Calendar, and Thunderbird.

### Language Jump Links / 语言导航 / भाषा चयन
- [🇬🇧 English](#-english)
- [🇨🇳 中文 (Chinese)](#-中文-chinese)
- [🇮🇳 हिन्दी (Hindi)](#-हिन्दी-hindi)
- [🇪🇸 Español (Spanish)](#-español-spanish)
- [🇫🇷 Français (French)](#-français-french)
- [🇸🇦 العربية (Arabic)](#-العربية-arabic)
- [🇩🇪 Deutsch (German)](#-deutsch-german)
- [🇳🇱 Nederlands (Dutch)](#-nederlands-dutch)

---

## Base Endpoint

https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec

---

## URL Parameters (Flags)

Append `?` for the first parameter and `&` for additional flags.

| Flag | Values | Default | Description |
|---|---|---|---|
| `cities` | Comma-separated *(Max 4)* | `London,Dublin` | Target locations (auto-geocoded) |
| `lang` | `en`, `zh`, `hi`, `es`, `fr`, `ar`, `de`, `nl` | `en` | Display language |
| `unit` | `celsius`, `fahrenheit` | `celsius` | Temperature scale |
| `days` | `1` to `30` | `30` | Forecast window |
| `hazards` | `true`, `false` | `true` | Road risk alerts (active when T_min <= 7°C) |
| `action` | `status`, `metrics` | *(none)* | Returns live JSON diagnostics |

> **⚠️ Quota Protection:** Hard cap of **4 cities** per request to prevent execution timeouts.

---

## Universal Setup Guide

Do not download the `.ics` file; subscribe to the URL for automatic updates:
- **Apple Calendar (iOS):** Settings > Calendar > Accounts > Add Account > Other > Add Subscribed Calendar. Set refresh to Hourly.
- **Apple Calendar (macOS):** File > New Calendar Subscription (`⌥⌘S`).
- **Outlook (Web/App):** Add Calendar > Subscribe from web.
- **Google Calendar (Web):** Other calendars (`+`) > From URL.

---

# 🇬🇧 English

- **D1–14:** Deterministic high-res forecast (temp, rain prob/vol, wind, pressure, UV, ET₀).
- **D15–30:** NOAA GFS 31-member probabilistic ensemble trajectory (`±°`).
- **D-5 to D-1:** Verified ground-truth logbook with D-countdown accuracy drift auditing.
- **Air Quality & Sky:** CAMS AQI, PM2.5, PM10, pollen count, moon phases, meteor peaks.
- **Road Hazards:** Ice/frost advisories auto-rendered only when T_min <= 7°C.

### Quick Links
- **British Isles (London & Edinburgh, 30 Days):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=London,Edinburgh

- **US Metro in Fahrenheit (New York, Chicago, Seattle, 14 Days):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=New%20York,Chicago,Seattle&unit=fahrenheit&days=14

- **No Road Hazard Warnings (Sydney & Melbourne):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Sydney,Melbourne&hazards=false

- **AI Telemetry Endpoint (JSON):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?action=status

---

# 🇨🇳 中文 (Chinese)

- **第 1–14 天：** 高精度确定性融合模型（气温、体感、降水率/量、风速、气压、UV、ET₀）。
- **第 15–30 天：** 美国 NOAA GFS 31 成员集合预报模型（附带模型分歧度 `±°`）。
- **过去 5 天：** 历史实测回溯（Ground Truth），以 D 倒计时坐标审计预测漂移。
- **空气质量与天象：** 欧洲 CAMS AQI 指数、PM2.5、PM10、花粉浓度、月相、流星雨极大期。
- **道路安全：** 当气温 <= 7°C 时自动激活结冰与湿滑预警。

### 快捷链接
- **京津冀与长三角 (北京与上海, 30天周期):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Beijing,Shanghai&lang=zh

- **华南及大湾区核心城市 (广州、深圳、香港、台北, 14天):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Guangzhou,Shenzhen,Hong%20Kong,Taipei&lang=zh&days=14

---

# 🇮🇳 हिन्दी (Hindi)

- **दिन 1–14:** उच्च-सटीक पूर्वानुमान (तापमान, बारिश की संभावना/मात्रा, हवा, वायुदाब, यूवी, ET₀)।
- **दिन 15–30:** NOAA GFS 31-सदस्यीय संभावित मौसम मॉडल (सटीकता अंतर `±°` के साथ)।
- **पिछले 5 दिन:** वास्तविक दर्ज मौसम और D-काउंटडाउन प्रणाली पर आधारित मॉडल ऑडिट।
- **वायु गुणवत्ता और खगोल:** यूरोपीय CAMS AQI, PM2.5, PM10, पराग स्तर, चंद्र कलाएं, उल्कापिंड गतिविधि।
- **सड़क चेतावनी:** तापमान <= 7°C होने पर सड़क पर फिसलन और पाले की चेतावनी।

### तैयार लिंक
- **उत्तर भारत मेट्रो (दिल्ली और लखनऊ, 30 दिन):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Delhi,Lucknow&lang=hi

- **भारतीय प्रमुख आर्थिक केंद्र (मुंबई, बेंगलुरु, हैदराबाद, कोलकाता, 14 दिन):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Mumbai,Bengaluru,Hyderabad,Kolkata&lang=hi&days=14

---

# 🇪🇸 Español (Spanish)

- **Días 1–14:** Modelo determinista de alta resolución (temperatura, lluvia, viento, presión, UV, ET₀).
- **Días 15–30:** Modelo probabilístico NOAA GFS (31 miembros) con dispersión (`±°`).
- **Días -5 a -1:** Registro histórico verificado con auditoría de error según cuenta atrás D.
- **Calidad del Aire y Cielo:** CAMS AQI, PM2.5, PM10, polen, fases lunares y lluvias de meteoros.
- **Seguridad Vial:** Advertencias automáticas de calzada deslizante activas solo con T_min <= 7°C.

### Enlaces Directos
- **Península Ibérica (Madrid y Barcelona, 30 Días):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Madrid,Barcelona&lang=es

- **Hispanoamérica (Ciudad de México, Bogotá, Buenos Aires, Santiago, 14 Días):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Mexico%20City,Bogota,Buenos%20Aires,Santiago&lang=es&days=14

---

# 🇫🇷 Français (French)

- **J1–14 :** Modèle déterministe haute résolution (température, pluie, vent, pression, UV, ET₀).
- **J15–30 :** Ensemble probabiliste NOAA GFS (31 membres) avec dispersion (`±°`).
- **J-5 à J-1 :** Historique vérifié et calcul de dérive du modèle basé sur le compte à rebours D.
- **Qualité de l'Air & Espace :** CAMS AQI, PM2.5, PM10, pollens, phases lunaires, météores.
- **Sécurité Routière :** Alertes de verglas/gel activées uniquement lorsque T_min <= 7°C.

### Liens Prêts à l'Emploi
- **France Métropolitaine (Paris & Lyon, 30 Jours) :**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Paris,Lyon&lang=fr

- **Espace Francophone (Marseille, Bruxelles, Genève, Montréal, 14 Jours) :**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Marseille,Brussels,Geneva,Montreal&lang=fr&days=14

---

# 🇸🇦 العربية (Arabic)

- **الأيام 1–14:** نماذج حتمية عالية الدقة (الحرارة، المطر، الرياح، الضغط، UV، التبخر ET₀).
- **الأيام 15–30:** نموذج التجميع الاحتمالي NOAA GFS مع نسبة تشتت النموذج (`±°`).
- **الأيام السابقة (-5 إلى -1):** سجل الرصد الواقعي لقياس هامش خطأ التوقعات بنظام العد التنازلي D.
- **جودة الهواء والفلك:** مؤشر CAMS AQI، والجسيمات PM2.5/PM10، واللقاح، ومنازل القمر والشهب.
- **مخاطر الطرق:** تنبيهات الصقيع والانزلاق تتفعل تلقائياً فقط عند حرارة <= 7°C.

### روابط مباشرة
- **الخليج العربي (الرياض وأبوظبي, 30 يوماً):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Riyadh,Abu%20Dhabi&lang=ar

- **عواصم عربية كبرى (القاهرة، دبي، الدوحة، عمّان, 14 يوماً):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Cairo,Dubai,Doha,Amman&lang=ar&days=14

---

# 🇩🇪 Deutsch (German)

- **T1–14:** Hochauflösende deterministische Vorhersagen (Temperatur, Regen, Wind, Druck, UV, ET₀).
- **T15–30:** Probabilistisches NOAA GFS 31-Member Ensemble mit Unsicherheitsbereich (`±°`).
- **T-5 bis T-1:** Verifiziertes Realdaten-Logbuch mit Modellabweichungs-Audit via D-Countdown.
- **Luftqualität & Himmel:** CAMS AQI, PM2.5, PM10, Pollenflug, Mondphasen und Sternschnuppen-Peaks.
- **Straßenglätte:** Automatische Warnungen aktiv ausschließlich bei T_min <= 7°C.

### Sofort-Links
- **Deutschland Achse (Berlin & München, 30 Tage):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Berlin,Munich&lang=de

- **DACH-Großstädte (Hamburg, Frankfurt, Wien, Zürich, 14 Tage):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Hamburg,Frankfurt,Vienna,Zurich&lang=de&days=14

---

# 🇳🇱 Nederlands (Dutch)

- **D1–14:** Deterministische hoge-resolutie modellen (temperatuur, regen, wind, luchtdruk, UV, ET₀).
- **D15–30:** NOAA GFS 31-lid ensemble projecties met modelspreiding (`±°`).
- **D-5 tot D-1:** Geverifieerd waarnemingenlogboek met drift-auditing volgens D-aftellogica.
- **Luchtkwaliteit & Hemel:** CAMS LKI/AQI, PM2.5, PM10, pollenbelasting, maanfasen en meteorenzwermen.
- **Wegcondities:** Gladheidswaarschuwingen automatisch actief zodra T_min <= 7°C.

### Directe Links
- **Randstad Hart (Amsterdam & Rotterdam, 30 Dagen):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Amsterdam,Rotterdam&lang=nl

- **Benelux Knooppunten (Utrecht, Eindhoven, Antwerpen, Gent, 14 Dagen):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=Utrecht,Eindhoven,Antwerp,Ghent&lang=nl&days=14

- **Kustzone Zonder Gladheidswaarschuwingen (Den Haag & Vlissingen):**  
https://script.google.com/macros/s/AKfycbxOoYfZPQ7pK8y4xBuyWOchUSkFZ4h4ww73oT_KLUGNt0SOrnA--0tUQWMAJo6YZVqpnQ/exec?cities=The%20Hague,Vlissingen&lang=nl&hazards=false
