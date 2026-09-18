/**
 * Interactive Location Setup Helper
 * 
 * Run setupLocations() in Apps Script console to interactively configure your cities.
 * Then copy the output to CONFIG.locations in gcalweather.gs or use in URL for icalweather.gs.
 */

function setupLocations() {
  console.log("=== Interactive Location Setup ===\n");
  console.log("Enter city names (one per line), empty line to finish:");
  console.log("Examples: Amsterdam, London, Tokyo, New York, Paris");
  console.log("With country: Amsterdam,NL or London,GB");
  console.log("With coords: Tokyo:35.6762:139.6503\n");
  
  // This is a template — replace with your cities and run:
  const MY_CITIES = [
    "Amsterdam,NL",
    "Rotterdam,NL", 
    "Utrecht,NL",
    "Den Haag,NL"
  ];
  
  console.log("Your cities:");
  MY_CITIES.forEach(c => console.log("  - " + c));
  
  const results = [];
  MY_CITIES.forEach(input => {
    const parts = input.split(",");
    const name = parts[0].trim();
    const country = parts[1]?.trim()?.toUpperCase();
    
    console.log(`\nGeocoding: ${name}${country ? ` (${country})` : ''}...`);
    const geo = geocodeCity(name, country);
    
    if (geo) {
      results.push({
        name: geo.name,
        lat: geo.lat,
        lon: geo.lon,
        tz: geo.tz,
        country: geo.country || country
      });
      console.log(`  ✓ ${geo.name} → ${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)} (${geo.tz})`);
    } else {
      console.log(`  ✗ Failed — will use fallback if available`);
      // Try fallback
      const fallbackKey = name.toLowerCase().trim();
      if (FALLBACK_CITY_COORDS[fallbackKey]) {
        const fb = FALLBACK_CITY_COORDS[fallbackKey];
        results.push({
          name: fb.name,
          lat: fb.lat,
          lon: fb.lon,
          tz: fb.tz,
          country: fb.country
        });
        console.log(`  ↻ Fallback: ${fb.name} → ${fb.lat.toFixed(4)}, ${fb.lon.toFixed(4)} (${fb.tz})`);
      }
    }
  });
  
  console.log("\n=== CONFIG.locations for gcalweather.gs ===");
  console.log("Copy this into gcalweather.gs CONFIG.locations:");
  console.log(JSON.stringify(results, null, 2));
  
  console.log("\n=== URL params for icalweather.gs ===");
  if (results.length <= 4) {
    const citiesParam = results.map(r => r.name).join(",");
    console.log(`cities=${encodeURIComponent(citiesParam)}`);
  } else {
    console.log("# Too many for 'cities' param (max 4) — use 'locations':");
    const locationsParam = results.slice(0, 4).map(r => `${r.name}:${r.lat}:${r.lon}`).join(",");
    console.log(`locations=${encodeURIComponent(locationsParam)}`);
  }
  
  return results;
}

// Quick presets for common regions
const PRESETS = {
  netherlands: ["Amsterdam,NL", "Rotterdam,NL", "Utrecht,NL", "Den Haag,NL"],
  belgium: ["Brussels,BE", "Antwerp,BE", "Ghent,BE", "Bruges,BE"],
  uk: ["London,GB", "Edinburgh,GB", "Manchester,GB", "Birmingham,GB"],
  us: ["New York,US", "Los Angeles,US", "Chicago,US", "Houston,US"],
  germany: ["Berlin,DE", "Munich,DE", "Hamburg,DE", "Frankfurt,DE"],
  france: ["Paris,FR", "Lyon,FR", "Marseille,FR", "Toulouse,FR"],
  japan: ["Tokyo,JP", "Osaka,JP", "Kyoto,JP", "Sapporo,JP"],
  australia: ["Sydney,AU", "Melbourne,AU", "Brisbane,AU", "Perth,AU"],
  canada: ["Toronto,CA", "Vancouver,CA", "Montreal,CA", "Calgary,CA"]
};

function usePreset(region) {
  const cities = PRESETS[region?.toLowerCase()];
  if (!cities) {
    console.log("Available presets:", Object.keys(PRESETS).join(", "));
    return;
  }
  console.log(`Using preset: ${region}`);
  // Temporarily replace MY_CITIES and run setupLocations
  // (In practice, edit the MY_CITIES array in setupLocations() above)
  console.log("Edit MY_CITIES in setupLocations() to use this preset:");
  console.log(cities.map(c => `  "${c}"`).join(",\n"));
}

// Run: usePreset("netherlands") to see the list