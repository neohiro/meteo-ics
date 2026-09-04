# Contributing to meteo-ics

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/neohiro/meteo-ics.git
   cd meteo-ics
   ```

2. **Deploy to Google Apps Script**
   - Open [script.google.com](https://script.google.com)
   - New project → paste contents of `gcalweather.gs` or `icalweather.gs`
   - Save → deploy as Web App (for iCal) or installable trigger (for gCal)

3. **Run tests**
   - See [tests/README.md](tests/README.md) for integration test checklist

## Code Style

- Use `const` / `let` (no `var`)
- Template literals for string interpolation
- Descriptive section headers in event descriptions
- Emoji glyphs for visual scanning in calendar titles

## Data Sources

| Source | License | Rate Limit | Coverage |
|---|---|---|---|
| Open-Meteo Weather API | CC-BY 4.0 | Generous | Global |
| NOAA GFS Ensemble | Public Domain | Generous | Global |
| Copernicus CAMS AQI | Free | Generous | EU + Global |
| Open-Meteo Geocoding | CC-BY 4.0 | Generous | Global |

## Adding New Features

1. **New weather variable**: Add to API URL in `fetchIcsAtmosphericDataParallel()` or `fetchAllAtmosphericDataParallel()`
2. **New advice type**: Add entry to `generatePrioritizedAdvices()`
3. **New astronomical event**: Add to `getAstronomicalEvents()` date map
4. **New language**: Add translation strings in `generatePrioritizedAdvices()` and update URL `lang` parameter handler

## Reporting Issues

- **Bug reports**: Use GitHub Issues with the "bug" template
- **Feature requests**: Use GitHub Discussions or Issues with "enhancement" label
- **Air quality data gaps**: Report your region and preferred data source

## Pull Requests

1. Fork → branch → make changes → test → PR
2. Keep commits atomic and descriptive
3. Update tests/README.md if adding new test cases
4. Do not commit API keys or personal location data
