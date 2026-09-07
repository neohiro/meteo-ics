"""Audit script for ASTRONOMICAL_EVENTS / PLANETARY_EVENTS / SOLAR_ECLIPSES / LUNAR_ECLIPSES key overlaps."""
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

gcal = open('gcalweather.gs', encoding='utf-8').read()
ical = open('icalweather.gs', encoding='utf-8').read()

for name, content in (('gcal', gcal), ('ical', ical)):
    print(f'=== {name} ===')
    objects = {
        'ASTRONOMICAL_EVENTS': re.search(r'const ASTRONOMICAL_EVENTS = \{([\s\S]*?)\n\};', content),
        'SOLAR_ECLIPSES': re.search(r'const SOLAR_ECLIPSES = \{([\s\S]*?)\n\};', content),
        'LUNAR_ECLIPSES': re.search(r'const LUNAR_ECLIPSES = \{([\s\S]*?)\n\};', content),
        'PLANETARY_EVENTS': re.search(r'const PLANETARY_EVENTS = \{([\s\S]*?)\n\};', content),
    }
    parsed = {}
    for label, m in objects.items():
        if m:
            body = m.group(1)
            parsed[label] = dict(re.findall(r'"(\d{2}-\d{2})":\s*"([^"]+)"', body))
        else:
            parsed[label] = {}
    # Print all keys
    all_keys = sorted(set().union(*[set(d.keys()) for d in parsed.values()]))
    for k in all_keys:
        present_in = [lbl for lbl, d in parsed.items() if k in d]
        if len(present_in) > 1:
            print(f'KEY COLLISION {k}: present in {present_in}')
            for lbl in present_in:
                print(f'  {lbl}: {parsed[lbl][k]}')
