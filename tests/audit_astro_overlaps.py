"""Audit script for ASTRONOMICAL_EVENTS / PLANETARY_EVENTS / SOLAR_ECLIPSES / LUNAR_ECLIPSES key overlaps.

ASTRONOMICAL_EVENTS intentionally spreads ECLIPSES / PLANETARY / AURORA into itself
as the single source of truth for ICS event titles, so the same MM-DD key can
appear in both ASTRONOMICAL_EVENTS and one of the source tables. We treat such
collisions as expected when ASTRONOMICAL_EVENTS contains the source value as a
substring (intentional merge) and only flag the collision as a real bug when
ASTRONOMICAL_EVENTS has a different value (e.g. forgotten merge override).
"""
import os
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

_root = os.path.dirname(os.path.abspath(__file__))
gcal = open(os.path.join(_root, '..', 'gcalweather.gs'), encoding='utf-8').read()
ical = open(os.path.join(_root, '..', 'icalweather.gs'), encoding='utf-8').read()

errors_found = 0
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
    astro = parsed.get('ASTRONOMICAL_EVENTS', {})
    for k in all_keys:
        present_in = [lbl for lbl, d in parsed.items() if k in d]
        if len(present_in) <= 1:
            continue
        # ASTRONOMICAL_EVENTS is the merged target; compare its value against
        # each source. If ASTRONOMICAL_EVENTS contains the source value as a
        # substring, the merge is intentional. Otherwise, the ASTRONOMICAL_EVENTS
        # entry was overwritten or the source entry is stale.
        astro_val = astro.get(k)
        for lbl in present_in:
            if lbl == 'ASTRONOMICAL_EVENTS':
                continue
            src_val = parsed[lbl].get(k)
            if astro_val is not None and src_val in astro_val:
                continue  # intentional merge
            print(f'KEY COLLISION {k}: ASTRONOMICAL_EVENTS does not contain {lbl} value')
            print(f'  ASTRONOMICAL_EVENTS: {astro_val}')
            print(f'  {lbl}: {src_val}')
            errors_found += 1

if errors_found:
    print(f'\nFAIL: {errors_found} real collision(s) found (ASTRONOMICAL_EVENTS must contain each source value as a substring).')
    sys.exit(1)
print('OK: no unmerged collisions')
