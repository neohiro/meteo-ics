# 🌦️ Autonomous Weather, Astronomical & Atmospheric Calendar Engine

[![Protocol](https://img.shields.io/badge/RFC-5545%20(iCalendar)-blue.svg)](#)
[![Data Sources](https://img.shields.io/badge/Data-Open--Meteo%20%7C%20NOAA%20GFS%20%7C%20Copernicus%20CAMS-orange.svg)](#)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20NL%20%7C%20DE%20%7C%20FR-green.svg)](#)

A high-precision, zero-maintenance, cross-platform calendar subscription (`.ics` / WebCal) powered by Open-Meteo, NOAA GFS Ensembles, and Copernicus CAMS. Compatible with **Apple Calendar**, **Microsoft Outlook**, **Google Calendar**, and **Thunderbird**.

> 🇳🇱 **Nederlandstalige handleiding nodig?** [👉 Klik hier om direct naar de Nederlandse sectie te gaan](#-nederlandse-handleiding).

---

## 📑 Table of Contents / Inhoudsopgave

- [English Manual](#-english-manual)
  - [Overview](#overview)
  - [Base Endpoint](#base-endpoint)
  - [URL Parameter Flags](#url-parameter-flags)
  - [Ready-to-Use Link Examples](#ready-to-use-link-examples)
  - [Subscribing in Your Calendar Client](#subscribing-in-your-calendar-client)
  - [Event Anatomy & Data Hierarchy](#event-anatomy--data-hierarchy)
- [Nederlandse Handleiding](#-nederlandse-handleiding)
  - [Overzicht](#overzicht)
  - [Basis-URL](#basis-url)
  - [Beschikbare Parameters (Flags)](#beschikbare-parameters-flags)
  - [Kant-en-klare Voorbeelden](#kant-en-klare-voorbeelden)
  - [Installatie per Agenda-applicatie](#installatie-per-agenda-applicatie)
  - [Opbouw van een Kalender-event](#opbouw-van-een-kalender-event)

---

# 🇬🇧 English Manual

## Overview

The engine serves an RFC 5545-compliant subscription feed directly to your calendar app. It compiles:
- **Days 1–14:** High-resolution deterministic blend (temperature, precipitation volume/probability, wind, pressure, solar radiation, UV index, evapotranspiration).
- **Days 15–30:** NOAA GFS 31-member probabilistic ensemble trajectory with confidence spread (`±°`).
- **Days -5 to -1:** Verified ground-truth logbook tracking actual measured data against historical predictions with prediction error ($\Delta$) auditing using standard countdown notation ($D-24$, $D-7$, $D-1$).
- **Air Quality & Bio-Load:** Copernicus CAMS European AQI, PM2.5, PM10, O3, and birch/grass/alder pollen counts.
- **Astronomy & Night Sky:** Moon phases, sunrise/sunset, golden hour windows, and major annual meteor shower peak tracking.
- **Conditional Road Safety:** Automatically activated only when minimum surface/air temperature <= 7°C.

## Base Endpoint

```text
[https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec)
```

## URL Parameter Flags

Configure your personal feed by appending parameters to the base URL. Start the query string with `?` and join multiple flags with `&`.

| Parameter | Type | Accepted Values | Default | Purpose |
|---|---|---|---|---|
| `cities` / `locations` | String | Comma-separated list *(Max 4)* | `Brunssum,Hasselt` | Geographic targets (automatically geocoded). |
| `lang` | String | `en`, `nl`, `de`, `fr` | `en` | UI language for headers, labels, and status alerts. |
| `unit` | String | `celsius`, `fahrenheit` | `celsius` | Unit for temperature metrics. |
| `days` | Integer | `1` to `30` | `30` | Total forecast horizon in days. |
| `hazards` | Boolean | `true`, `false` | `true` | Show/hide conditional road safety advisories (<= 7°C). |
| `action` | String | `status`, `metrics` | *(none)* | Returns raw live JSON telemetry instead of an iCal feed. |

> **⚠️ Quota Protection:** To avoid execution timeouts and preserve upstream API thresholds, feeds are strictly clamped to a maximum of **4 cities** per request.

## Ready-to-Use Link Examples

* **Default Dual Location (Brunssum & Hasselt, 30-Day Complete Horizon):**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Brunssum,Hasselt](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Brunssum,Hasselt)
  ```

* **Global Major Cities in Fahrenheit (14 Days):**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=New%20York,London,Tokyo&unit=fahrenheit&days=14](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=New%20York,London,Tokyo&unit=fahrenheit&days=14)
  ```

* **Clean Forecast Without Road Hazard Modules:**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Paris,Rome,Vienna&hazards=false](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Paris,Rome,Vienna&hazards=false)
  ```

* **Live AI Assistant JSON Telemetry Endpoint:**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?action=status](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?action=status)
  ```

## Subscribing in Your Calendar Client

Do not download the `.ics` file directly. Subscribe to the URL so updates sync automatically.

* **Apple Calendar (iOS / iPadOS):**
  1. Open **Settings** > **Calendar** > **Calendar Accounts** > **Add Account**.
  2. Select **Other** > **Add Subscribed Calendar**.
  3. Paste your configured link into the **Server** field and tap **Next**.
  4. Set auto-refresh to **Hourly** or **Every 15 Minutes** and tap **Save**.

* **Apple Calendar (macOS):**
  1. Open **Calendar**.
  2. In the menu bar, select **File** > **New Calendar Subscription...** (`⌥⌘S`).
  3. Paste your configured URL and click **Subscribe**.
  4. Set auto-refresh to **Every hour** and save.

* **Microsoft Outlook (Web & Microsoft 365):**
  1. Open Outlook Calendar.
  2. Click **Add calendar** in the sidebar > **Subscribe from web**.
  3. Paste the URL, choose a name and icon, and click **Import**.

* **Google Calendar (Web):**
  1. Open [calendar.google.com](https://calendar.google.com/).
  2. In the left sidebar, click the `+` icon next to **Other calendars** > **From URL**.
  3. Paste the link and click **Add calendar**. *(Note: Google crawls third-party feeds roughly every 8–24 hours).*

## Event Anatomy & Data Hierarchy

Each all-day event adheres to a compact, non-intrusive format:

* **Event Title:** `🌤️ 22° Brunssum` *(or probabilistic consensus: `🎯 ~21° Brunssum (±2°)`)*
* **Event Transparency:** Marked `TRANSPARENT` (Free) so it never causes false scheduling conflicts.
* **Description Payload Structure:**
  1. `📍 Location & Day Indicator` (D-Day, D-7, or Verified Past Observation)
  2. `🌡️ Thermal & Atmospheric` (High, Low, Feels-Like, Wind, Pressure, Rain probability/volume)
  3. `🌌 Celestial, Light & Space` (Sunrise/Sunset, Golden Hour, Moon Phase, Meteor Shower peaks)
  4. `🧪 Air Quality & Bio-Load` (European AQI, PM2.5, PM10, O3, Pollen allergen risk)
  5. `📅 7-Day Aggregate Outlook` (Cumulative Rain, Mean Temp, Growing Degree Days, Mean AQI)
  6. `📉 Model Audit & Stability` (D-Day countdown error drift vs. baseline, lifetime model MAE)
  7. `🚗 Road & Travel Advisory` *(Conditional: rendered only if T_min <= 7°C)*

---

# 🇳🇱 Nederlandse Handleiding

## Overzicht

Deze agenda-engine levert een geautomatiseerde, RFC 5545-compatibele kalenderfeed (`.ics` / WebCal) voor jouw agenda-app. De feed combineert:
- **Dag 1–14:** Hoge-resolutie deterministische modellen (temperatuur, neerslagvolume en -kans, windstoten, luchtdruk, zonnestraling, UV-index, verdamping).
- **Dag 15–30:** NOAA GFS 31-lid ensemble projecties inclusief modelspreiding (`±°`).
- **Dag -5 tot -1:** Geverifieerd waarnemingenlogboek waarin werkelijk gemeten waarden worden vergeleken met eerdere voorspellingen, inclusief modelafwijking ($\Delta$) via aftellogica ($D-24$, $D-7$, $D-1$).
- **Luchtkwaliteit & Pollen:** Copernicus CAMS Europese LKI/AQI, fijnstof (PM2.5, PM10), ozon (O3) en boompollen (berk, els, gras).
- **Astronomie & Nachtelijke Hemel:** Maanfasen, zonsopkomst/-ondergang, gouden uur en pieken van meteorenzwermen.
- **Wegcondities & Gladheid:** Automatische waarschuwingen zodra de minimum grond- of luchttemperatuur <= 7°C zakt.

## Basis-URL

```text
[https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec)
```

## Beschikbare Parameters (Flags)

Stel jouw persoonlijke feed samen door variabelen achter de basis-URL te plaatsen. Begin met een `?` en koppel meerdere parameters aan elkaar met `&`.

| Parameter | Type | Toegestane Waarden | Standaard | Doel |
|---|---|---|---|---|
| `cities` / `locations` | Tekst | Komma-gescheiden lijst *(Max 4)* | `Brunssum,Hasselt` | Gekozen locaties (worden automatisch geogecodeerd). |
| `lang` | Tekst | `nl`, `en`, `de`, `fr` | `en` | Taal van de interface, headers en waarschuwingen. |
| `unit` | Tekst | `celsius`, `fahrenheit` | `celsius` | Eenheid voor alle temperatuurwaarden. |
| `days` | Geheel getal | `1` tot `30` | `30` | Lengte van de voorspellingshorizon in dagen. |
| `hazards` | Booleaans | `true`, `false` | `true` | Gladheidswaarschuwingen bij kou (<= 7°C) tonen/verbergen. |
| `action` | Tekst | `status`, `metrics` | *(geen)* | Geeft live JSON-telemetrie terug voor API/AI-koppelingen. |

> **⚠️ Quota-bescherming:** Om uitvoeringstime-outs te voorkomen en binnen de limieten van de API's te blijven, worden verzoeken begrensd tot maximaal **4 steden** tegelijk.

## Kant-en-klare Voorbeelden

* **Nederlandse Standaardfeed (Brunssum & Hasselt, 30 Dagen):**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Brunssum,Hasselt&lang=nl](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Brunssum,Hasselt&lang=nl)
  ```

* **Benelux Mix (Nederlands, 14 Dagen Vooruit):**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Amsterdam,Antwerpen,Eindhoven&lang=nl&days=14](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Amsterdam,Antwerpen,Eindhoven&lang=nl&days=14)
  ```

* **Weerfeed Zonder Gladheidsmodules:**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Maastricht,Luik&lang=nl&hazards=false](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?cities=Maastricht,Luik&lang=nl&hazards=false)
  ```

* **Status- en Telemetrie-interface (JSON):**
  ```text
  [https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?action=status](https://script.google.com/macros/s/AKfycbwv-7_XaQYTqnXB2UuZ-pf_OUxll-6mrzUJqW5kiyu2pAX4tjbvO2WQIa1jRd4Zx8WAfg/exec?action=status)
  ```

## Installatie per Agenda-applicatie

Download het `.ics`-bestand niet los, maar abonneer je op de link. Dan blijft de agenda automatisch up-to-date.

* **Apple Agenda (iPhone & iPad):**
  1. Ga naar **Instellingen** > **Agenda** > **Accounts**.
  2. Tik op **Nieuwe account** > **Andere** > **Abonnement op agenda**.
  3. Plak de samengestelde URL in het server-veld en tik op **Volgende**.
  4. Zet de verversingsfrequentie op **Elk uur** of **Elk kwartier** en tik op **Gereed**.

* **Apple Agenda (Mac):**
  1. Open de **Agenda**-app.
  2. Kies in de menubalk bovenin voor **Archief** > **Nieuw agenda-abonnement...** (`⌥⌘S`).
  3. Plak de link in het venster en klik op **Abonneer**.
  4. Stel de verversingssnelheid in op **Elk uur** en klik op **OK**.

* **Microsoft Outlook (Web & Microsoft 365):**
  1. Open Outlook en navigeer naar de agendaweergave.
  2. Klik in de linkerkolom op **Agenda toevoegen** > **Abonneren via internet**.
  3. Plak de link, kies een herkenbare naam en kleur, en klik op **Importeren**.

* **Google Agenda (Desktop Web):**
  1. Ga naar [calendar.google.com](https://calendar.google.com/).
  2. Zoek links naar **Andere agenda's** en klik op het plus-icoon (`+`) > **Via URL**.
  3. Plak de link en klik op **Agenda toevoegen**. *(Let op: Google ververst externe feeds autonoom met intervallen van circa 8 tot 24 uur).*

## Opbouw van een Kalender-event

Elke daggebeurtenis is geformatteerd als een overzichtelijke all-day afspraak:

* **Titel:** `🌤️ 22° Brunssum` *(of bij lange termijn: `🎯 ~21° Brunssum (±2°)`)*
* **Beschikbaarheid:** Gemarkeerd als `Vrij` (`TRANSPARENT`), zodat het geen werkagenda's blokkeert.
* **Inhoudelijke Gegevensstructuur:**
  1. `📍 Locatie & Dagstatus` (D-Day, D-7, of Geverifieerd waarnemingenlogboek)
  2. `🌡️ Temperatuur & Atmosfeer` (Max, Min, Gevoelstemperatuur, Wind, Luchtdruk, Neerslagkans en -volume)
  3. `🌌 Hemel, Licht & Ruimte` (Zon-op/onder, Gouden Uur, Maanfase, Meteorenzwermen)
  4. `🧪 Luchtkwaliteit & Bio-belasting` (Europese LKI/AQI, PM2.5, PM10, O3, Pollenbelasting)
  5. `📅 7-Daagse Totalen & Trends` (Cumulatieve Neerslag, Gem. Temperatuur, Groeidagen GDD, Gem. LKI)
  6. `📉 Modelnauwkeurigheid & Stabiliteit` (Afwijking ten opzichte van eerste voorspelling, historische MAE)
  7. `🚗 Weg- & Rijcondities` *(Wordt uitsluitend weergegeven wanneer T_min <= 7°C)*
