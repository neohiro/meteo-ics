# 🌦️ Autonomous Weather, Astronomical & Atmospheric Calendar Engine

[![Protocol](https://img.shields.io/badge/RFC-5545%20(iCalendar)-blue.svg)](#)
[![Data Sources](https://img.shields.io/badge/Data-Open--Meteo%20%7C%20NOAA%20GFS%20%7C%20Copernicus%20CAMS-orange.svg)](#)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20NL%20%7C%20DE%20%7C%20FR-green.svg)](#)

A high-precision, zero-maintenance, cross-platform calendar subscription (`.ics` / WebCal) powered by Open-Meteo, NOAA GFS Ensembles, and Copernicus CAMS. Compatible with **Apple Calendar**, **Microsoft Outlook**, **Google Calendar**, and **Thunderbird**.

---

## 📑 Table of Contents

- [Overview](#overview)
- [Base Endpoint](#base-endpoint)
- [URL Parameter Flags](#url-parameter-flags)
- [Ready-to-Use Link Examples](#ready-to-use-link-examples)
- [Subscribing in Your Calendar Client](#subscribing-in-your-calendar-client)
- [Event Anatomy & Data Hierarchy](#event-anatomy--data-hierarchy)

---

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
