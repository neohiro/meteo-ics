/**
 * Deployment Verification Script
 * 
 * Run this in Apps Script console after deploying to verify everything works.
 * 
 * For gcalweather.gs: Run verifyGcalDeployment()
 * For icalweather.gs: Run verifyIcalDeployment()
 */

// ============================================================
// GCALWEATHER VERIFICATION
// ============================================================

function verifyGcalDeployment() {
  console.log("=== gcalweather.gs Deployment Verification ===\n");
  
  // 1. Check CONFIG
  console.log("1. CONFIG check:");
  console.log("   calendarId:", CONFIG.calendarId || "(auto-create)");
  console.log("   locations:", CONFIG.locations.length, "cities");
  CONFIG.locations.forEach((loc, i) => {
    console.log(`   [${i}] ${loc.name}${loc.country ? `, ${loc.country}` : ''}${loc.lat ? ` (${loc.lat}, ${loc.lon})` : ''}`);
  });
  console.log("   temperatureUnit:", CONFIG.temperatureUnit);
  console.log("   forecastDays:", CONFIG.forecastDays);
  console.log("   deterministicDays:", CONFIG.deterministicDays, "(must be ≤16)");
  console.log("   aqProvider:", CONFIG.aqProvider);
  console.log("   language:", CONFIG.language);
  console.log("   dryRun:", CONFIG.dryRun);
  
  // 2. Validate deterministicDays
  if (CONFIG.deterministicDays > 16) {
    console.log("\n⚠️  WARNING: deterministicDays > 16 exceeds Open-Meteo limit!");
    console.log("   Set CONFIG.deterministicDays = 14 (or ≤16)");
  }
  
  // 3. Check Script Properties
  console.log("\n2. Script Properties:");
  const props = PropertiesService.getScriptProperties();
  const newsKey = props.getProperty("NEWS_API_KEY");
  const waqiPass = props.getProperty("WAQI_PASSPHRASE");
  console.log("   NEWS_API_KEY:", newsKey ? "✓ SET" : "✗ NOT SET (breaking news disabled)");
  console.log("   WAQI_PASSPHRASE:", waqiPass ? "✓ SET" : "✗ NOT SET (WAQI disabled)");
  
  // 4. Test geocoder
  console.log("\n3. Geocoder test:");
  const testCity = CONFIG.locations[0]?.name || "Amsterdam";
  const geo = geocodeCity(testCity);
  if (geo) {
    console.log(`   ✓ "${testCity}" → ${geo.name} (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}) TZ: ${geo.tz}`);
  } else {
    console.log(`   ✗ "${testCity}" geocoding failed — check network/Open-Meteo`);
  }
  
  // 5. Test calendar resolution
  console.log("\n4. Calendar resolution:");
  let cal;
  try {
    cal = resolveCalendar();
    console.log(`   ✓ Calendar: "${cal.getName()}" (ID: ${cal.getId()}) | TZ: ${cal.getTimeZone()}`);
    if (!CONFIG.calendarId) {
      console.log("   ℹ️  calendarId is empty — auto-created calendar. To use existing shared calendar, set calendarId in CONFIG.");
    }
  } catch (e) {
    console.log(`   ✗ Calendar error: ${e.message}`);
    return;
  }
  
  // 6. Test calendar write permission
  console.log("\n5. Calendar write permission test:");
  try {
    const testDate = new Date();
    const testEvent = cal.createAllDayEvent("🧪 meteo-ics write test", testDate, { description: "Test write - safe to delete" });
    testEvent.deleteEvent();
    console.log("   ✓ Write permission confirmed (test event created & deleted)");
  } catch (e) {
    console.log(`   ✗ Write permission FAILED: ${e.message}`);
    console.log("   → You need Edit access on this calendar. Check sharing settings.");
  }
  
  // 7. Full pipeline test (dry run)
  console.log("\n6. Full pipeline test (dry run):");
  const originalDryRun = CONFIG.dryRun;
  CONFIG.dryRun = true;
  try {
    syncWeatherToCalendar();
    console.log("   ✓ Pipeline dry run completed — check Execution log for details");
  } catch (e) {
    console.log(`   ✗ Pipeline failed: ${e.message}`);
  }
  CONFIG.dryRun = originalDryRun;
  
  // 8. Check circuit breakers
  console.log("\n7. Circuit breakers:");
  Object.keys(CB.cfg).forEach(name => {
    console.log(`   ${name}: ${CB.getState(name)}`);
  });
  
  console.log("\n=== Verification Complete ===");
  console.log("Next: Add daily trigger (06:00-07:00) → Triggers → Add Trigger → syncWeatherToCalendar");
}


// ============================================================
// ICALWEATHER VERIFICATION
// ============================================================

function verifyIcalDeployment() {
  console.log("=== icalweather.gs Deployment Verification ===\n");
  
  // 1. Check ICAL_CONFIG
  console.log("1. ICAL_CONFIG check:");
  console.log("   calendarName:", ICAL_CONFIG.calendarName);
  console.log("   temperatureUnit:", ICAL_CONFIG.temperatureUnit);
  console.log("   forecastDays:", ICAL_CONFIG.forecastDays);
  console.log("   deterministicDays:", ICAL_CONFIG.deterministicDays, "(must be ≤16)");
  console.log("   maxCities:", ICAL_CONFIG.maxCities);
  console.log("   defaultLang:", ICAL_CONFIG.defaultLang);
  console.log("   hazardsEnabled:", ICAL_CONFIG.hazardsEnabled);
  
  // 2. Validate deterministicDays
  if (ICAL_CONFIG.deterministicDays > 16) {
    console.log("\n⚠️  WARNING: deterministicDays > 16 exceeds Open-Meteo limit!");
  }
  
  // 3. Check Script Properties
  console.log("\n2. Script Properties:");
  const props = PropertiesService.getScriptProperties();
  const newsKey = props.getProperty("NEWS_API_KEY");
  const waqiPass = props.getProperty("WAQI_PASSPHRASE");
  console.log("   NEWS_API_KEY:", newsKey ? "✓ SET" : "✗ NOT SET");
  console.log("   WAQI_PASSPHRASE:", waqiPass ? "✓ SET" : "✗ NOT SET");
  
  // 4. Test geocoder
  console.log("\n3. Geocoder test:");
  const geo = geocodeCity("Amsterdam");
  if (geo) {
    console.log(`   ✓ "Amsterdam" → ${geo.name} (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}) TZ: ${geo.tz}`);
  } else {
    console.log(`   ✗ Geocoding failed`);
  }
  
  // 5. Test ICS generation (dry run)
  console.log("\n4. ICS generation test (dry run):");
  try {
    const mockEvent = { 
      parameter: { 
        cities: "Amsterdam", 
        dryRun: "true",
        unit: "celsius",
        days: "3",
        lang: "en"
      } 
    };
    const result = doGet(mockEvent);
    const content = result.getContent();
    if (content.includes("BEGIN:VCALENDAR")) {
      console.log("   ✓ ICS generated successfully");
      console.log(`   Size: ${content.length} chars`);
      // Check for color-coded titles (in description for ICS)
      if (content.includes("TEMPERATURE & COMFORT")) {
        console.log("   ✓ Dashboard sections present");
      }
    } else {
      console.log("   ✗ Invalid ICS output");
      console.log("   Preview:", content.slice(0, 200));
    }
  } catch (e) {
    console.log(`   ✗ ICS generation failed: ${e.message}`);
  }
  
  // 6. Test status endpoint
  console.log("\n5. Status endpoint test:");
  try {
    const statusEvent = { parameter: { action: "status" } };
    const statusResult = doGet(statusEvent);
    const statusJson = JSON.parse(statusResult.getContent());
    console.log("   ✓ Status endpoint working");
    console.log("   Version:", statusJson.scriptVersion);
    console.log("   Config health:", statusJson.configHealth?.deterministicDaysWarning ? "⚠️ WARNING" : "✓ OK");
    console.log("   AQI provider:", statusJson.airQuality?.provider);
    console.log("   WAQI token:", statusJson.airQuality?.waqiTokenConfigured ? "✓ Configured" : "✗ Not configured");
  } catch (e) {
    console.log(`   ✗ Status endpoint failed: ${e.message}`);
  }
  
  // 7. Check circuit breakers
  console.log("\n6. Circuit breakers:");
  Object.keys(CB.cfg).forEach(name => {
    console.log(`   ${name}: ${CB.getState(name)}`);
  });
  
  console.log("\n=== Verification Complete ===");
  console.log("Share your custom URLs with users (see CONFIG.icalweather.example.js)");
}


// ============================================================
// UNIVERSAL HELPERS
// ============================================================

function showAllConfig() {
  console.log("=== gcalweather CONFIG ===");
  console.log(JSON.stringify(CONFIG, null, 2));
  console.log("\n=== icalweather ICAL_CONFIG ===");
  console.log(JSON.stringify(ICAL_CONFIG, null, 2));
}

function testAqiCascade() {
  console.log("Testing AQI cascade for Amsterdam...");
  const loc = geocodeCity("Amsterdam");
  if (!loc) return console.log("Geocoder failed");
  
  const aq = fetchGlobalAQI(loc.lat, loc.lon, "auto", 25, "");
  console.log("AQI Result:", JSON.stringify(aq, null, 2));
}

function resetAllCaches() {
  CB.create('openmeteo');
  CB.create('wikipedia');
  CB.create('newsapi');
  CB.create('openaq');
  CB.create('waqi');
  CB.create('timezone');
  CB.create('geocoder');
  waqiTokenReset();
  console.log("All circuit breakers reset, WAQI cache cleared");
}

function showBudgetStatus() {
  const start = budgetStart();
  console.log("Budget started at:", new Date(start).toISOString());
  console.log("Limit:", APPS_SCRIPT_BUDGET_MS / 1000, "seconds (5m45s)");
  console.log("Warn thresholds:", BUDGET_WARN_AT_MS.map(ms => ms/1000 + "s"));
}