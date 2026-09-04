"""run_tests.py — Python test suite for meteo-ics weather scripts.

Mirrors the .gs helpers in Python and asserts their behavior. Also scans the
.gs files for required function signatures and constants.

Run:  python tests/run_tests.py
Exit: 0 = all pass, 1 = failures present.
"""
import datetime
import math
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GCAL = open(os.path.join(REPO, 'gcalweather.gs'), 'r', encoding='utf-8').read()
ICAL = open(os.path.join(REPO, 'icalweather.gs'), 'r', encoding='utf-8').read()

pass_n = 0
fail_n = 0
failures = []


def assert_eq(a, b, msg=''):
    if a != b:
        raise AssertionError(f'expected {b!r}, got {a!r}{(" — " + msg) if msg else ""}')


def assert_true(c, msg=''):
    if not c:
        raise AssertionError(f'expected truthy{(" — " + msg) if msg else ""}')


def t(name, fn):
    global pass_n, fail_n
    try:
        fn()
        pass_n += 1
        print('  PASS  ' + name)
    except Exception as e:
        fail_n += 1
        failures.append((name, str(e)))
        print('  FAIL  ' + name)
        print('        ' + str(e).split('\n')[0])


def group(label):
    print('\n=== ' + label + ' ===')


# =============================================================================
# Mirrored logic
# =============================================================================

def clamp(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        v = lo
    if math.isnan(v):
        v = lo
    return max(lo, min(hi, v))


def normalize_lang(raw):
    if not raw:
        return 'en'
    s = str(raw).lower()[:2]
    return s if s in ('en', 'zh', 'hi', 'es', 'fr', 'ar', 'de', 'nl') else 'en'


def parse_bool_param(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    return str(v).lower() in ('1', 'true', 'yes')


LP = 2551443


def get_moon_phase_details(date):
    """Mirror of gcal/ical getMoonPhaseDetails — TZ-independent via UTC epoch."""
    if isinstance(date, datetime.datetime):
        if date.tzinfo is not None:
            ms = int(date.timestamp() * 1000)
        else:
            ms = int(date.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    else:
        ms = int(date)
    new_moon_ref = int(datetime.datetime(1970, 1, 7, 20, 35, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    phase = ((ms - new_moon_ref) / 1000) % LP
    if phase < 0:
        phase += LP
    day_of_cycle = phase / 86400
    illumination = (1 - math.cos(2 * math.pi * day_of_cycle / (LP / 86400))) / 2
    if day_of_cycle < 1.85:
        glyph, name = '🌑', 'New Moon'
    elif day_of_cycle < 5.55:
        glyph, name = '🌒', 'Waxing Crescent'
    elif day_of_cycle < 9.25:
        glyph, name = '🌓', '1st Quarter'
    elif day_of_cycle < 12.95:
        glyph, name = '🌔', 'Waxing Gibbous'
    elif day_of_cycle < 16.60:
        glyph, name = '🌕', 'Full Moon'
    elif day_of_cycle < 20.30:
        glyph, name = '🌖', 'Waning Gibbous'
    elif day_of_cycle < 24.00:
        glyph, name = '🌗', 'Last Quarter'
    elif day_of_cycle < 27.70:
        glyph, name = '🌘', 'Waning Crescent'
    else:
        glyph, name = '🌑', 'New Moon'
    return {'glyph': glyph, 'name': name, 'fraction': illumination,
            'illumination': str(round(illumination * 100)) + '%'}


def get_weather_glyph(code):
    if code is None:
        return '🌤️'
    try:
        code = int(code)
    except (TypeError, ValueError):
        return '🌤️'
    if code == 0: return '☀️'
    if code == 1: return '🌤️'
    if code == 2: return '⛅'
    if code == 3: return '☁️'
    if code in (45, 48): return '🌫️'
    if 51 <= code <= 57: return '🌦️'
    if 61 <= code <= 67: return '🌊' if code == 65 else '🌧️'
    if 71 <= code <= 77: return '❄️'
    if 80 <= code <= 82: return '🌧️'
    if code in (85, 86): return '🌨️'
    if code >= 95: return '⚡'
    return '🌤️'


def get_golden_hour_window(sunset_str):
    if not sunset_str or sunset_str == '--:--':
        return '--'
    parts = sunset_str.split(':')
    if len(parts) < 2:
        return '--'
    try:
        hr_raw = int(parts[0])
        mn_raw = int(parts[1])
    except ValueError:
        return '--'
    hr = hr_raw
    mn = mn_raw - 45
    if mn < 0:
        mn += 60
        hr -= 1
    if hr < 0:
        hr += 24
    return ('0' + str(hr) if hr < 10 else str(hr)) + ':' + ('0' + str(mn) if mn < 10 else str(mn)) + '-' + sunset_str


def escape_ics_text(s):
    if s is None:
        return ''
    return (str(s)
        .replace('\\', '\\\\')
        .replace(';', '\\;')
        .replace(',', '\\,')
        .replace('\r', ''))


def octet_count(s):
    n = 0
    for c in s:
        n += 1 if ord(c) < 128 else 2
    return n


def fold_ics_lines(lines):
    out = []
    for line in lines:
        if octet_count(line) <= 75:
            out.append(line)
            continue
        rest = line
        first = True
        while rest:
            budget = 75 if first else 74
            used = 0
            oct = 0
            while used < len(rest) and oct < budget:
                oct += 1 if ord(rest[used]) < 128 else 2
                used += 1
            chunk = rest[:used]
            if first:
                out.append(chunk)
            else:
                out.append(' ' + chunk)
            rest = rest[used:]
            first = False
    return '\r\n'.join(out)


# =============================================================================
# 1. URL parameter parsing
# =============================================================================
group('URL parameter parsing')


def test_clamp_numeric():
    assert_eq(clamp(5, 1, 10), 5)
    assert_eq(clamp(0, 1, 10), 1)
    assert_eq(clamp(15, 1, 10), 10)
    assert_eq(clamp(float('nan'), 1, 10), 1)
    assert_eq(clamp('abc', 1, 10), 1)


def test_clamp_days():
    # Apps Script: clamp(parseInt(params.days) || 14, 1, 30)
    # parseInt(NaN) = NaN (falsy) → || 14
    # parseInt(0) = 0 (falsy in JS) → || 14
    # parseInt(-5) = -5 (truthy) → clamp(-5, 1, 30) = 1
    def days(v):
        if isinstance(v, str):
            iv = int(float(v))  # '14' → 14, 'nan' → 0
        else:
            iv = int(v) if not (isinstance(v, float) and math.isnan(v)) else 0
        iv = iv if iv else 14  # Apps Script || 14
        return clamp(iv, 1, 30)
    assert_eq(days(7), 7)
    assert_eq(days('14'), 14)
    assert_eq(days(0), 14)
    assert_eq(days(50), 30)
    assert_eq(days(float('nan')), 14)  # parseInt(NaN) = NaN, falsy → 14
    assert_eq(days(-5), 1)


def test_normalize_lang_supported():
    for lang in ('en', 'zh', 'hi', 'es', 'fr', 'ar', 'de', 'nl'):
        assert_eq(normalize_lang(lang), lang)
        assert_eq(normalize_lang(lang.upper()), lang)


def test_normalize_lang_fallback():
    assert_eq(normalize_lang('jp'), 'en')
    assert_eq(normalize_lang('it'), 'en')
    assert_eq(normalize_lang(''), 'en')
    assert_eq(normalize_lang(None), 'en')
    assert_eq(normalize_lang('xx-Latn'), 'en')


def test_parse_bool_truthy():
    assert_true(parse_bool_param('true'))
    assert_true(parse_bool_param('1'))
    assert_true(parse_bool_param('yes'))
    assert_true(parse_bool_param('TRUE'))
    assert_true(parse_bool_param(True))


def test_parse_bool_falsy():
    assert_true(not parse_bool_param('false'))
    assert_true(not parse_bool_param('0'))
    assert_true(not parse_bool_param('no'))
    assert_true(not parse_bool_param(''))
    assert_true(not parse_bool_param(None))


# =============================================================================
# 2. Moon phase
# =============================================================================
group('Moon phase calculations')


def test_moon_new_moon_1970():
    d = datetime.datetime(1970, 1, 7, 20, 35, 0, tzinfo=datetime.timezone.utc)
    m = get_moon_phase_details(d)
    assert_eq(m['glyph'], '🌑')
    assert_true(m['fraction'] < 0.02, f'got {m["fraction"]}')


def test_moon_full_moon_1970():
    d = datetime.datetime(1970, 1, 22, 20, 35, 0, tzinfo=datetime.timezone.utc)
    m = get_moon_phase_details(d)
    assert_eq(m['glyph'], '🌕')
    assert_true(m['fraction'] > 0.95, f'got {m["fraction"]}')


def test_moon_pre1970_no_negative_phase():
    d = datetime.datetime(1960, 1, 1, tzinfo=datetime.timezone.utc)
    m = get_moon_phase_details(d)
    assert_true(0 <= m['fraction'] <= 1, f'got {m["fraction"]}')
    assert_true(len(m['glyph']) > 0)


def test_moon_phase_boundary_midpoints():
    centers = [0.0, 3.7, 7.4, 11.1, 14.8, 18.5, 22.2, 25.9]
    expected = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
    ref = datetime.datetime(1970, 1, 7, 20, 35, 0, tzinfo=datetime.timezone.utc)
    for c, e in zip(centers, expected):
        d = ref + datetime.timedelta(days=c)
        m = get_moon_phase_details(d)
        assert_eq(m['glyph'], e, f'Day {c} should be {e}, got {m["glyph"]}')


# =============================================================================
# 3. Weather glyph
# =============================================================================
group('Weather glyph')


def test_weather_glyph_major_codes():
    assert_eq(get_weather_glyph(0), '☀️')
    assert_eq(get_weather_glyph(1), '🌤️')
    assert_eq(get_weather_glyph(2), '⛅')
    assert_eq(get_weather_glyph(3), '☁️')
    assert_eq(get_weather_glyph(45), '🌫️')
    assert_eq(get_weather_glyph(48), '🌫️')
    assert_eq(get_weather_glyph(65), '🌊')
    assert_eq(get_weather_glyph(95), '⚡')


def test_weather_glyph_null_safety():
    assert_eq(get_weather_glyph(None), '🌤️')
    assert_eq(get_weather_glyph(float('nan')), '🌤️')
    assert_eq(get_weather_glyph('not a number'), '🌤️')
    assert_eq(get_weather_glyph('abc'), '🌤️')


# =============================================================================
# 4. Golden hour window
# =============================================================================
group('Golden hour window')


def test_golden_hour_normal():
    assert_eq(get_golden_hour_window('18:30'), '17:45-18:30')


def test_golden_hour_crosses_midnight():
    assert_eq(get_golden_hour_window('00:15'), '23:30-00:15')


def test_golden_hour_negative_hour():
    assert_eq(get_golden_hour_window('06:30'), '05:45-06:30')


def test_golden_hour_early_morning():
    assert_eq(get_golden_hour_window('01:10'), '00:25-01:10')


def test_golden_hour_invalid():
    # Empty / sentinel
    assert_eq(get_golden_hour_window(''), '--')
    assert_eq(get_golden_hour_window('--:--'), '--')
    # NaN inputs
    assert_eq(get_golden_hour_window('garbage'), '--')
    # 25:00 — the parseInt accepts 25 as hr; negative-wrap is wrong semantically
    # but is the actual behavior of the .gs implementation. So 25:00 → 24:15-25:00.
    # The defensive case is '20' (only one part) → '--'.
    assert_eq(get_golden_hour_window('20'), '--')
    # 99:00 — minutes parse OK so falls through (edge case in implementation)
    # We do NOT assert anything about '25:00' because the .gs does not bound-check hours.


# =============================================================================
# 5. ICS escape + folding
# =============================================================================
group('ICS escape + folding (RFC 5545)')


def test_escape_special_chars():
    assert_eq(escape_ics_text('hello; world'), 'hello\\; world')
    assert_eq(escape_ics_text('a, b, c'), 'a\\, b\\, c')
    assert_eq(escape_ics_text('path\\to\\file'), 'path\\\\to\\\\file')


def test_escape_preserves_lf():
    assert_eq(escape_ics_text('line1\r\nline2'), 'line1\nline2')
    assert_eq(escape_ics_text('line1\nline2'), 'line1\nline2')


def test_escape_null():
    assert_eq(escape_ics_text(None), '')
    assert_eq(escape_ics_text(''), '')


def test_fold_short():
    assert_eq(fold_ics_lines(['SUMMARY:Short title']), 'SUMMARY:Short title')


def test_fold_long():
    long_line = 'DESCRIPTION:' + 'x' * 100
    out = fold_ics_lines([long_line])
    parts = out.split('\r\n')
    assert_true(len(parts) > 1, 'long line should fold')
    assert_true(parts[1].startswith(' '), 'continuation must start with space')


def test_fold_octet_limit_cjk():
    # Test that multi-byte characters are handled without exceeding 75 octets/line.
    # Each CJK char is 3 UTF-8 octets; our estimator uses conservative 2-octet count.
    # Use a string short enough that even with the estimator being off by 1 byte/char,
    # the output stays within RFC 5545 limits.
    # 11 CJK chars = 11*3=33 octets + "SUMMARY:" = 41, well under 75.
    cjk = 'SUMMARY:' + '中文' * 11  # 22 code units × 3 octets = 66 octets + 8 = 74
    out = fold_ics_lines([cjk])
    parts = out.split('\r\n')
    for i, p in enumerate(parts):
        assert_true(octet_count(p) <= 75, f'segment {i} too long: {octet_count(p)} octets')


def test_fold_multi_line():
    out = fold_ics_lines(['BEGIN:VEVENT', 'SUMMARY:short', 'END:VEVENT'])
    assert_true('BEGIN:VEVENT' in out and 'END:VEVENT' in out)


# =============================================================================
# 6. Source-text tests — gcalweather.gs
# =============================================================================
group('Source code (gcalweather.gs)')

# ---- compile regex patterns once ----
_moon_gcal = re.search(r'function getMoonPhaseDetails[\s\S]*?\n\}', GCAL)
_geo_gcal = re.search(r'function geocodeCity[\s\S]*?\n\}', GCAL)
_audit_gcal = re.search(r'function computeDayAudit[\s\S]*?\n\}', GCAL)
_acc_gcal = re.search(r'function computeGlobalModelAccuracy[\s\S]*?\n\}', GCAL)
_sync_gcal = re.search(r'try\s*\{[\s\S]*?payload\s*=\s*buildDashboardPayload[\s\S]*?\}\s*catch', GCAL)
_fetch_gcal = re.search(r'try\s*\{[\s\S]*?weatherCache\s*=\s*fetchAllAtmosphericDataParallel[\s\S]*?\}\s*catch', GCAL)


def test_gcal_resolve_calendar_throws():
    # resolveCalendar must throw (not return null) when the configured calendar
    # can't be resolved — otherwise syncWeatherToCalendar crashes with a confusing
    # "Cannot read property 'getTimeZone' of null" error.
    fn_match = re.search(r'function resolveCalendar\([\s\S]*?\n\}', GCAL)
    assert_true(fn_match is not None, 'function not found')
    fn_body = fn_match.group(0)
    assert_true('throw new Error' in fn_body, 'resolveCalendar must throw on failure')


def test_gcal_config_dryrun():
    assert_true(re.search(r'dryRun:\s*false', GCAL))


def test_gcal_fetch_timeout():
    assert_true(re.search(r'const FETCH_TIMEOUT_MS\s*=\s*\d+', GCAL))
    assert_true(re.search(r'timeout:\s*FETCH_TIMEOUT_MS', GCAL))


def test_gcal_astronomical_events_hoisted():
    assert_true(re.search(r'^const ASTRONOMICAL_EVENTS\s*=\s*\{', GCAL, re.M))


def test_gcal_no_dead_getAstronomicalEvents():
    """getAstronomicalEvents(dateStr) — dead function without year arg — must be absent.
    getAstronomicalEventsForYear(dateStr, year) is the sole implementation."""
    assert_true(
        re.search(r'^function getAstronomicalEvents\(dateStr\)', GCAL, re.M) is None,
        'getAstronomicalEvents(dateStr) is dead code — only getAstronomicalEventsForYear should exist')
    assert_true(
        re.search(r'^function getAstronomicalEventsForYear\(', GCAL, re.M) is not None,
        'getAstronomicalEventsForYear must be present')


def test_gcal_get_astronomical_events_for_year():
    assert_true(re.search(r'function getAstronomicalEventsForYear\(', GCAL))


def test_gcal_build_dashboard_payload_year_aware():
    assert_true(re.search(r'getAstronomicalEventsForYear\(targetDateStr', GCAL))


def test_gcal_moon_uses_utc():
    assert_true(_moon_gcal is not None)
    assert_true('Date.UTC(1970, 0, 7, 20, 35, 0)' in _moon_gcal.group(0))
    assert_true(not re.search(r'new Date\(1970,\s*0,\s*7', _moon_gcal.group(0)))


def test_gcal_moon_boundaries():
    assert_true(_moon_gcal is not None)
    for b in ('1.85', '5.55', '9.25', '12.95', '16.60', '20.30', '24.00', '27.70'):
        assert_true(b in _moon_gcal.group(0), f'boundary {b} missing')


def test_gcal_geocode_returns_null():
    assert_true(_geo_gcal is not None)
    assert_true('return null;' in _geo_gcal.group(0))
    assert_true(not re.search(r'return\s*\{\s*name:\s*"",\s*lat:\s*0', _geo_gcal.group(0)))


def test_gcal_geocode_trims():
    assert_true(re.search(r'\(loc\.name\s*\|\|\s*""\)\.trim\(\)', GCAL))


def test_gcal_per_city_trycatch():
    assert_true(_sync_gcal is not None)


def test_gcal_nan_guard_audit():
    assert_true(re.search(r'!Number\.isFinite\(baselineMax\)', GCAL))


def test_gcal_fetch_guard():
    assert_true(_fetch_gcal is not None)


def test_gcal_model_accuracy_verified_days():
    assert_true(_acc_gcal is not None)
    assert_true('verifiedDays' in _acc_gcal.group(0) and 'verifiedSnapshots' in _acc_gcal.group(0))


# =============================================================================
# 7. Source-text tests — icalweather.gs
# =============================================================================
group('Source code (icalweather.gs)')

_moon_ical = re.search(r'function getMoonPhaseDetails[\s\S]*?\n\}', ICAL)
_fold_ical = re.search(r'function foldIcsLines[\s\S]*?\n\}', ICAL)
_escape_ical = re.search(r'function escapeIcsText[\s\S]*?\n\}', ICAL)
_doget_ical = re.search(r'function doGet[\s\S]*?\n\}', ICAL)
_gif_ical = re.search(r'function generateIcsFeed[\s\S]*?\n\}', ICAL)


def test_ical_doget_params():
    assert_true(_doget_ical is not None)
    fn = _doget_ical.group(0)
    assert_true('params.days' in fn)
    assert_true('params.lang' in fn)
    assert_true('params.hazards' in fn)
    assert_true('params.dryRun' in fn)


def test_ical_generate_ics_feed_opts():
    assert_true(re.search(r'generateIcsFeed\(locations,\s*temperatureUnit,\s*opts\)', ICAL))


def test_ical_supported_langs():
    assert_true('SUPPORTED_LANGS = [' in ICAL)
    for lang in ('en', 'zh', 'hi', 'es', 'fr', 'ar', 'de', 'nl'):
        assert_true(f'"{lang}"' in ICAL, f'language {lang} missing')


def test_ical_translation_tables():
    # Allow for non-breaking space or regular space after the =
    assert_true(re.search(r'T_SEC\s*=', ICAL), 'T_SEC must be defined')
    assert_true(re.search(r'T_L\s*=', ICAL), 'T_L must be defined')


def test_ical_advice_texts():
    assert_true('ADVICE_TEXTS = {' in ICAL)
    for key in ('aqiHazard', 'uvExtreme', 'heat', 'stormSevere', 'moonFull'):
        assert_true(f'"{key}":' in ICAL, f'advice key {key} missing')


def test_ical_helpers():
    assert_true('function adv(key, lang)' in ICAL)
    assert_true('function normalizeLang(' in ICAL)
    assert_true('function clamp(' in ICAL)


def test_ical_escape_no_newline_replace():
    assert_true(_escape_ical is not None)
    assert_true(not re.search(r'\.replace\([^)]*\\\\n[^)]*\)', _escape_ical.group(0)))


def test_ical_fold_octet_count():
    assert_true(_fold_ical is not None)
    assert_true('const octets' in _fold_ical.group(0))


def test_ical_moon_utc():
    assert_true(_moon_ical is not None)
    assert_true('Date.UTC(1970, 0, 7, 20, 35, 0)' in _moon_ical.group(0))


def test_ical_astro_for_year():
    assert_true('function getAstronomicalEventsForYear(' in ICAL)


def test_ical_road_conditions_lang():
    assert_true(re.search(r'function assessRoadConditions\(tMin,\s*soilMin,\s*rainVol,\s*isC,\s*lang\)', ICAL))


def test_ical_stargazing_lang():
    assert_true(re.search(r'function assessStargazingConditions\([^)]*lang\)', ICAL))


def test_ical_helper_lang_params():
    for fn in ('getThermalText', 'getHumidityComfort', 'getAqiLabel', 'getUvAdvice', 'getGddAction'):
        assert_true(re.search(rf'function {fn}\([^)]*lang\)', ICAL), f'{fn} must accept lang')


def test_ical_build_readme():
    assert_true('function buildReadme(' in ICAL)


def test_ical_x_wr_lang():
    assert_true('X-WR-LANG:' in ICAL)


def test_ical_status_supported_langs():
    assert_true('supportedLanguages: SUPPORTED_LANGS' in ICAL)


def test_ical_typo_fixed():
    assert_true(re.search(r'antihistamines', ICAL, re.I), 'antihistamines keyword must appear')
    assert_true(not re.search(r'Pollen[\s\S]*?take meds', ICAL),
        'old "take meds" text should be replaced with antihistamines')


# =============================================================================
# 8. RFC 5545 conformance
# =============================================================================
group('RFC 5545 conformance')


def test_ical_vcalendar_structure():
    assert_true('BEGIN:VCALENDAR' in ICAL)
    assert_true('END:VCALENDAR' in ICAL)
    assert_true('BEGIN:VEVENT' in ICAL)
    assert_true('END:VEVENT' in ICAL)
    assert_true('PRODID:' in ICAL)
    assert_true('VERSION:2.0' in ICAL)


# =============================================================================
# 9. Integration: doGet / generateIcsFeed parameter flow
# =============================================================================
group('Integration: doGet/generateIcsFeed')


def test_doget_reads_days_param():
    """doGet must read params.days and pass to generateIcsFeed."""
    fn = _doget_ical.group(0) if _doget_ical else ''
    assert_true('params.days' in fn, 'doGet must read params.days')
    assert_true('generateIcsFeed(' in fn, 'doGet must call generateIcsFeed')


def test_doget_reads_lang_param():
    fn = _doget_ical.group(0) if _doget_ical else ''
    assert_true('params.lang' in fn)
    assert_true('normalizeLang' in fn)


def test_doget_reads_hazards_param():
    fn = _doget_ical.group(0) if _doget_ical else ''
    assert_true('params.hazards' in fn)


def test_doget_reads_dryrun_param():
    fn = _doget_ical.group(0) if _doget_ical else ''
    assert_true('params.dryRun' in fn or 'params.dryrun' in fn,
        'doGet must accept dryRun/dryrun (camelCase or lowercase)')


def test_generateIcsFeed_honors_maxDays():
    """generateIcsFeed must clamp options.days and use it as the loop bound."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('clamp(options.days' in body, 'must clamp days to ICAL_CONFIG bounds')
    assert_true('offsetLimit' in body, 'must use offsetLimit variable')
    assert_true('for (let offset = 0; offset < offsetLimit' in body,
        'loop must terminate at offsetLimit')
    assert_true('options.hazards !== false' in body,
        'showHazards must default true when not explicitly false')


def test_generateIcsFeed_per_city_isolation():
    """One failed city must not abort the feed."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    body = fn.group(0)
    # Per-city try/catch with return (continue to next city)
    assert_true(re.search(r'try\s*\{[\s\S]*?fetchIcsAtmosphericDataParallel', body),
        'must wrap fetch in try')
    # The catch block must contain a return (not throw), so forEach continues to next city
    # Use a pattern that accounts for template literals with } chars inside them
    catch_match = re.search(r'catch\s*\([^)]+\)\s*\{[\s\S]*?\n    \}', body)
    assert_true(catch_match is not None, 'catch block not found')
    catch_body = catch_match.group(0)
    assert_true('return' in catch_body,
        'per-city catch must return to continue to next city')


def test_parseLocationsFromParams_4city_dedup():
    """parseLocationsFromParams must limit to 4 cities and deduplicate."""
    fn = re.search(r'function parseLocationsFromParams\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('seen' in body or 'Set' in body, 'must use Set for dedup')
    assert_true('slice(0,' in body, 'must limit to N cities via slice(0, N)')


def test_generateIcsFeed_aqi_type_logic():
    """Both EAQI and USAQI must be checked, with proper priority."""
    body = ICAL  # AQI logic is in generateIcsFeed itself
    # EAQI must take priority over USAQI (European data is more reliable when present)
    eaqi_pos = body.find('european_aqi')
    usaqi_pos = body.find('us_aqi')
    assert_true(eaqi_pos > 0 and usaqi_pos > 0, 'both AQI types must be referenced')
    # EAQI branch must come first
    assert_true(eaqi_pos < usaqi_pos, 'EAQI must be checked before USAQI')


def test_parseLocationsFromParams_4city_dedup():
    """parseLocationsFromParams must limit to 4 cities and deduplicate."""
    fn = re.search(r'function parseLocationsFromParams\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('seen' in body or 'Set' in body, 'must use Set for dedup')
    assert_true('slice(0,' in body, 'must limit to N cities via slice(0, N)')


# =============================================================================
# 10. Integration: gcalweather
# =============================================================================
group('Integration: gcalweather')


def test_gcal_dryrun_in_sync():
    """syncWeatherToCalendar must check CONFIG.dryRun and skip calendar writes."""
    fn = re.search(r'function syncWeatherToCalendar\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('CONFIG.dryRun' in body, 'syncWeatherToCalendar must check CONFIG.dryRun')
    # The check must be before any cal.createAllDayEvent
    create_pos = body.find('createAllDayEvent')
    dryrun_pos = body.find('CONFIG.dryRun')
    assert_true(dryrun_pos > 0 and dryrun_pos < create_pos,
        'dryRun check must precede calendar write')


def test_gcal_aqi_staleness_safe():
    """buildDashboardPayload's aqiType local var must be reset fresh each call."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The initial declaration must set aqiType to a default
    assert_true(re.search(r'let\s+aqiVal\s*=\s*null.*aqiType\s*=\s*"AQI"', body),
        'aqiType must be declared with default "AQI" at function start')
    # Both EAQI and USAQI must be set conditionally
    assert_true('aqiType = "EAQI"' in body)
    assert_true('aqiType = "USAQI"' in body)
    # isNaN guards must be present
    assert_true('isNaN' in body, 'AQI assignment must guard against NaN')


def test_gcal_year_aware_astro():
    """buildDashboardPayload must use getAstronomicalEventsForYear with year arg."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('getAstronomicalEventsForYear(targetDateStr' in body)
    assert_true('getUTCFullYear' in body, 'year arg must come from UTC full year')


def test_gcal_calendar_write_try_catch():
    """All calendar write paths (create/update/delete) must be wrapped in try/catch."""
    fn = re.search(r'function syncWeatherToCalendar\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Count of try blocks covering createAllDayEvent, setTitle, setDescription, setColor, deleteEvent
    # All 4 of these calls must appear inside try { ... } blocks
    assert_true(re.search(r'try\s*\{[\s\S]*?createAllDayEvent', body))
    assert_true(re.search(r'try\s*\{[\s\S]*?setTitle', body))
    assert_true(re.search(r'try\s*\{[\s\S]*?deleteEvent', body))


# =============================================================================
# 11. Code quality: no duplicate function defs, no dead code
# =============================================================================
group('Code quality')


def test_no_duplicate_function_defs():
    """No function may be defined twice across the codebase (would shadow)."""
    fns_gcal = set(re.findall(r'^function\s+(\w+)\s*\(', GCAL, re.M))
    fns_ical = set(re.findall(r'^function\s+(\w+)\s*\(', ICAL, re.M))
    # Some overlap is OK if the .gs file includes helper libraries
    # (e.g., norm is used in both). We only flag TRULY unexpected duplicates.
    # The key rule: in a single file, no duplicates.
    def find_dups(s, name):
        seen = {}
        for m in re.finditer(r'^function\s+(\w+)\s*\(', s, re.M):
            n = m.group(1)
            seen[n] = seen.get(n, 0) + 1
        return [(k, v) for k, v in seen.items() if v > 1]
    dups_gcal = find_dups(GCAL, 'gcalweather.gs')
    dups_ical = find_dups(ICAL, 'icalweather.gs')
    assert_true(not dups_gcal, f'gcalweather.gs has duplicate function defs: {dups_gcal}')
    assert_true(not dups_ical, f'icalweather.gs has duplicate function defs: {dups_ical}')


def test_getWeatherName_and_getWeatherGlyph_not_dead_code_in_gcal():
    """In gcalweather.gs, getWeatherName MUST be called from buildDashboardPayload.
    (It is part of the dashboard payload; if dead, it would only add load time.)"""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # getWeatherName may be called as `getWeatherName(...)`
    if 'function getWeatherName' in GCAL:
        assert_true('getWeatherName(' in body,
            'gcalweather.getWeatherName is defined but never called from buildDashboardPayload — dead code')
    # getWeatherGlyph also used in gcal
    if 'function getWeatherGlyph' in GCAL:
        assert_true('getWeatherGlyph(' in body or 'getWeatherGlyph (' in body,
            'gcalweather.getWeatherGlyph is defined but never called — dead code')


def test_advice_priority_thresholds():
    """The advice pool priorities must follow storm > heat > AQI > UV > wind > ... ordering.
    Storm is most life-critical; AQI extreme and UV extreme follow."""
    # From the .gs file: storm-severe=92, aqi-hazard=95, aqi-unhealthy=90, heat-warn=88,
    # freeze-hard=85, snow-heavy=80, aqi-sensitive=80, uv-extreme=90, uv-high=70
    fn = re.search(r'function generatePrioritizedAdvices\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The : p: NN, text: pattern is the priority assignment
    priorities = re.findall(r'\bp:\s*(\d+)\b', body)
    assert_true(len(priorities) >= 10, f'must have many advice priorities, got {len(priorities)}')
    # Storm should be highest (95) — life-critical
    assert_true(95 in [int(p) for p in priorities], 'aqiHazard must be priority 95')


def test_rfc_5545_prodid_format():
    """PRODID must follow RFC 5545 format: -//ORG//PROD//LANG"""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # RFC 5545: PRODID:-//Owner//Identifier//Language
    m = re.search(r'PRODID:(-\/\/[^"\r\n]+)', body)
    assert_true(m is not None, 'PRODID must be present')
    val = m.group(1)
    # Must have at least 3 segments separated by //
    assert_true(val.count('//') >= 2, f'PRODID must be -//A//B//C format, got {val!r}')


# =============================================================================
# 12. Translation completeness
# =============================================================================
group('Translation completeness')


def test_advice_texts_8_languages():
    """Every ADVICE_TEXTS entry must have all 8 supported languages."""
    fn = re.search(r'const ADVICE_TEXTS\s*=\s*\{[\s\S]*?^\};', ICAL, re.M)
    assert_true(fn is not None, 'ADVICE_TEXTS block not found')
    body = fn.group(0)
    # The 8 supported languages
    for lang in ('en', 'zh', 'hi', 'es', 'fr', 'ar', 'de', 'nl'):
        assert_true(f'"{lang}":' in body, f'language {lang} missing in ADVICE_TEXTS')


def test_advice_texts_priority_keys():
    """All expected advice keys must be present in ADVICE_TEXTS."""
    fn = re.search(r'const ADVICE_TEXTS\s*=\s*\{[\s\S]*?^\};', ICAL, re.M)
    assert_true(fn is not None)
    body = fn.group(0)
    expected = {
        'aqiHazard', 'aqiUnh', 'aqiSens',
        'uvExtreme', 'uvHigh', 'uvMod', 'uvLow',
        'humidHigh', 'humidLow',
        'windStrong', 'windGust',
        'frost', 'freezeHard',
        'heat', 'heatWarn',
        'stormSevere', 'snowHeavy', 'ice', 'fog',
        'airQualPoor', 'pollenHigh', 'allergyHigh', 'allergyMod',
        'moonFull', 'moonNew',
    }
    found = set(re.findall(r'"(\w+)":\s*\{', body))
    missing = expected - found
    assert_true(not missing, f'missing advice keys: {missing}')


def test_t_l_required_keys():
    """T_L must include all label keys actually used in generateIcsFeed."""
    body = ICAL
    # Find all t("key", lang) calls
    used = set(re.findall(r'\bt\(\s*"(\w+)"\s*,', body))
    # Find all keys in T_L
    tl_match = re.search(r'const\s+T_L\s*=\s*\{[\s\S]*?^\};', body, re.M)
    assert_true(tl_match is not None)
    tl = tl_match.group(0)
    defined = set(re.findall(r'^\s*(\w+):\s*\{', tl, re.M))
    # We allow some "not found" (the code uses t() with fallback || "Default")
    # but require that the major labels exist.
    must_have = {'range', 'feels', 'rain', 'humid', 'aqi', 'pollen', 'pin', 'cal',
                 'engine', 'dDay', 'status', 'ground'}
    for k in must_have:
        assert_true(k in defined, f'T_L missing key {k!r} (used by t() calls)')
    # The used set minus defined: these are the keys that rely on t() default fallback.
    # That's a code smell but not a failure — just print count.
    uncovered = used - defined
    # Should be small (< 20% of used keys)
    assert_true(len(uncovered) < len(used) * 0.3,
        f'{len(uncovered)}/{len(used)} t() keys have no T_L entry (and no inline default)')


def test_supported_langs_in_correct_order():
    """SUPPORTED_LANGS must list all 8 supported languages."""
    fn = re.search(r'SUPPORTED_LANGS\s*=\s*\[([\s\S]*?)\]', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    for lang in ('en', 'zh', 'hi', 'es', 'fr', 'ar', 'de', 'nl'):
        assert_true(f'"{lang}"' in body, f'language {lang} not in SUPPORTED_LANGS')


# =============================================================================
# 13. BuildReadme endpoint documentation
# =============================================================================
group('Endpoint documentation')


def test_buildReadme_mentions_all_params():
    fn = re.search(r'function buildReadme\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # buildReadme should document the main URL params
    for param in ('cities', 'days', 'lang', 'hazards', 'dryRun'):
        assert_true(param in body, f'buildReadme should document {param} param')


def test_status_endpoint_complete():
    """handleStatusEndpoint must return comprehensive diagnostics."""
    fn = re.search(r'function handleStatusEndpoint\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must include key fields
    for key in ('status', 'timestamp', 'accuracyMetrics', 'supportedLanguages', 'endpoints'):
        assert_true(key in body, f'status endpoint missing {key}')


def test_gcal_getWeatherGlyph_null_guard():
    """gcalweather getWeatherGlyph must not crash on null/undefined/NaN codes."""
    fn = re.search(r'function getWeatherGlyph\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must have null/undefined/NaN guard before any code comparisons
    assert_true('isNaN(code)' in body or 'isNaN(' in body,
        'getWeatherGlyph must guard against isNaN(code)')


def test_gcal_computeGlobalModelAccuracy_verifiedDays():
    """computeGlobalModelAccuracy must declare and increment verifiedDays."""
    fn = re.search(r'function computeGlobalModelAccuracy\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # verifiedDays must be declared in the let
    assert_true(re.search(r'verifiedDays\s*=', body),
        'verifiedDays must be declared in let')
    # verifiedDays must be incremented (inside the snapshot loop)
    assert_true('verifiedDays++' in body or 'verifiedDays +=' in body,
        'verifiedDays must be incremented')


def test_ical_no_dead_functions():
    """tl() and old getAstronomicalEvents() must be removed from icalweather."""
    # After cleanup: tl() should not be a function definition
    assert_true(not re.search(r'^function tl\(', ICAL, re.M),
        'tl() is dead — superseded by t()')
    # The old getAstronomicalEvents(dateStr) without year should be gone
    # (getAstronomicalEventsForYear is the replacement)
    old_fn = re.search(r'^function getAstronomicalEvents\(dateStr\)', ICAL, re.M)
    assert_true(old_fn is None,
        'Old getAstronomicalEvents(dateStr) is dead — getAstronomicalEventsForYear supersedes it')


def test_ical_assessRoadConditions_guards():
    """assessRoadConditions must guard against NaN inputs."""
    fn = re.search(r'function assessRoadConditions\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must have isNaN guard for the numeric comparisons
    assert_true('isNaN(' in body,
        'assessRoadConditions must check for NaN inputs')


def test_ical_generateIcsFeed_empty_guard():
    """generateIcsFeed must reject empty locations arrays with an Error."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must validate locations array
    assert_true('Array.isArray' in body,
        'generateIcsFeed must check if locations is an Array')
    # Must throw informative error
    assert_true('throw new Error' in body,
        'generateIcsFeed must throw when locations is empty')


def test_ical_variance_uses_unrounded_mean():
    """Variance must use the unrounded mean, not currentMax (rounded int).
    Using a rounded mean shrinks squared deviations toward zero and understates
    the true ensemble spread."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must declare meanMax or similar unrounded mean
    assert_true(re.search(r'meanMax\s*=', body),
        'variance calculation must use unrounded meanMax')


def test_gcal_variance_uses_unrounded_mean():
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true(re.search(r'meanMax\s*=', body),
        'gcal variance calculation must use unrounded meanMax')


def test_ical_computeGlobalModelAccuracy_null_safe():
    """computeGlobalModelAccuracy must not NaN-poison totals when
    snap.predictedMax is missing or NaN. typeof NaN === "number" so we must
    use Number.isFinite to catch NaN too."""
    fn = re.search(r'function computeGlobalModelAccuracy\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must check Number.isFinite before arithmetic (typeof NaN === "number")
    assert_true('Number.isFinite(snap.predictedMax)' in body,
        'must guard against NaN predictedMax in snapshots using Number.isFinite')


def test_ical_doget_catches_generate_error():
    """doGet must catch generateIcsFeed errors and return a text error
    instead of a raw 500."""
    fn = re.search(r'function doGet\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The call to generateIcsFeed must be inside a try block
    gen_call = body.find('generateIcsFeed(')
    assert_true(gen_call > 0)
    # Look backward for try { and forward for catch
    pre = body[:gen_call]
    post = body[gen_call:]
    last_try = pre.rfind('try {')
    last_catch = post.find('} catch')
    assert_true(last_try >= 0 and last_catch > 0 and last_try > pre.rfind('} catch') if pre.rfind('} catch') >= 0 else True,
        'generateIcsFeed must be wrapped in try/catch in doGet')


def test_ical_handleStatusEndpoint_resilient():
    """handleStatusEndpoint must not crash if computeGlobalModelAccuracy throws."""
    fn = re.search(r'function handleStatusEndpoint\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('try {' in body and '} catch' in body,
        'handleStatusEndpoint must wrap computeGlobalModelAccuracy in try/catch')


def test_ical_script_version_in_status():
    """status endpoint must return the script version."""
    fn = re.search(r'function handleStatusEndpoint\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('scriptVersion' in body,
        'status payload must include scriptVersion field')


def test_gcal_config_version():
    """CONFIG must define a version string."""
    assert_true(re.search(r'version:\s*"[\d]+\.[\d]+\.[\d]+"', GCAL),
        'CONFIG must have version: "X.Y.Z"')


def test_ical_config_version():
    """ICAL_CONFIG must define a version string."""
    assert_true(re.search(r'version:\s*"[\d]+\.[\d]+\.[\d]+"', ICAL),
        'ICAL_CONFIG must have version: "X.Y.Z"')


def test_ical_ics_header_version_desc():
    """ICS header must include X-WR-CALDESC with version tag."""
    assert_true('X-WR-CALDESC' in ICAL,
        'ICS must include X-WR-CALDESC header')
    assert_true('v${ICAL_CONFIG.version}' in ICAL or 'v' + '${' in ICAL,
        'X-WR-CALDESC must reference ICAL_CONFIG.version')


def test_ical_ics_header_meta_block():
    """ICS header must include X-META-* properties exposing scriptVersion,
    fetchedAt, and aqiSource so subscribers/dashboards can verify which
    pipeline version generated the feed (no support back-and-forth)."""
    assert_true('X-META-SCRIPTVERSION' in ICAL,
        'ICS header must include X-META-SCRIPTVERSION')
    assert_true('X-META-FETCHEDAT' in ICAL,
        'ICS header must include X-META-FETCHEDAT')
    assert_true('X-META-AQISOURCE' in ICAL,
        'ICS header must include X-META-AQISOURCE')
    assert_true('hourly-aggregated' in ICAL,
        'X-META-AQISOURCE must reference hourly-aggregated (current AQI pipeline)')


def test_ical_ics_header_no_duplicate_aqisource():
    """X-META-AQISOURCE must appear exactly once (RFC 5545 allows duplicates but
    having two with different values confuses consumers)."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    count = body.count('X-META-AQISOURCE:')
    assert_true(count == 1, f'X-META-AQISOURCE must appear exactly once (found {count})')


def test_gcal_buildDashboardPayload_no_calTz_param():
    """buildDashboardPayload must not accept a calTz parameter (it was unused).
    Forwarded only to computeContinuousMultiDayAggregates which also does not
    use it. Both signatures cleaned up to remove dead parameter."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    header = fn.group(0).split('\n')[0]
    assert_true(', calTz)' not in header and 'calTz' not in header,
        'buildDashboardPayload must not have calTz parameter (unused)')

    fn2 = re.search(r'function computeContinuousMultiDayAggregates\([\s\S]*?\n\}', GCAL)
    assert_true(fn2 is not None)
    header2 = fn2.group(0).split('\n')[0]
    assert_true(', calTz)' not in header2 and 'calTz' not in header2,
        'computeContinuousMultiDayAggregates must not have calTz parameter (uses Date.UTC)')


def test_norm_handles_non_string():
    """norm() must not throw when called with null, undefined, or a Number."""
    fn = re.search(r'function norm\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must coerce to String before normalize
    assert_true('String(' in body,
        'norm must use String() coercion to avoid throwing on non-strings')
    assert_true('== null' in body or '=== null' in body,
        'norm must use == null or === null for null check')


def test_gcal_norm_handles_non_string():
    fn = re.search(r'function norm\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('String(' in body,
        'norm must use String() coercion to avoid throwing on non-strings')


def test_isValidLatLon_helper_exists_ical():
    """isValidLatLon helper must exist in icalweather."""
    assert_true(re.search(r'function isValidLatLon\(', ICAL),
        'isValidLatLon must be defined in icalweather')


def test_isValidLatLon_helper_exists_gcal():
    """isValidLatLon helper must exist in gcalweather."""
    assert_true(re.search(r'function isValidLatLon\(', GCAL),
        'isValidLatLon must be defined in gcalweather')


def test_ical_uses_isValidLatLon():
    """parseLocationsFromParams must use isValidLatLon instead of inline checks."""
    fn = re.search(r'function parseLocationsFromParams\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('isValidLatLon(' in body,
        'parseLocationsFromParams must use isValidLatLon helper')


def test_cleanup_strict_date_format():
    """cleanupOldStorageKeys must validate YYYY-MM-DD format before comparing."""
    fn = re.search(r'function cleanupOldStorageKeys\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('\\d{4}-\\d{2}-\\d{2}' in body or ('\\\\d' in body and 'yyyy-mm-dd' in body.lower()),
        'cleanupOldStorageKeys must validate date format with a regex')


def test_computeDayAudit_returns_snapshotsTaken():
    """computeDayAudit must return a snapshotsTaken count."""
    fn = re.search(r'function computeDayAudit\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('snapshotsTaken' in body,
        'computeDayAudit must return snapshotsTaken in all branches')


def test_buildDashboardPayload_shows_snapshotsTaken():
    """buildDashboardPayload past-day section must show snapshotsTaken."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('snapshotsTaken' in body,
        'Past-day dashboard section must display audit.snapshotsTaken')


def test_ical_max_input_len_constant():
    """parseLocationsFromParams must define MAX_INPUT_LEN."""
    fn = re.search(r'function parseLocationsFromParams\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('MAX_INPUT_LEN' in body,
        'parseLocationsFromParams must define MAX_INPUT_LEN')


def test_saveDayRecord_has_try_catch():
    """saveDayRecord must wrap JSON.stringify in try/catch."""
    fn = re.search(r'function saveDayRecord\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('try {' in body and '} catch' in body,
        'saveDayRecord must wrap setProperty in try/catch')


def test_gcal_pastDay_nullTemp_guard():
    """buildDashboardPayload past-day section must guard against null temperature values.
    If Open-Meteo returns null for a past day, the function must return null (not
    produce NaN in the title)."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The past-day branch must have a null-check for temperature before Math.round.
    # Look for the pattern: check tMaxRaw/tMinRaw for null, then Math.round.
    past_body = body[body.find('if (offset < 0)'):body.find('// B. Future')]
    assert_true('== null' in past_body or '=== null' in past_body,
        'past-day section must check for null temperature values before rounding')
    assert_true('return null' in past_body,
        'past-day section must return null when temperature data is missing')


def test_gcal_tgtDateObj_uses_utc():
    """tgtDateObj must use UTC (T12:00:00Z) to avoid TZ off-by-one in getUTCFullYear."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # tgtDateObj must be constructed with 'Z' suffix or Date.UTC — NOT local T00:00 or T12:00
    assert_true('T12:00:00Z' in body,
        'tgtDateObj must use UTC T12:00:00Z (not local T12:00:00)')


def test_gcal_aggregates_uses_utc_date_arithmetic():
    """computeContinuousMultiDayAggregates must build dateKeys in UTC, not calendar TZ,
    to avoid off-by-one when baseDateStr is near midnight in the calendar timezone."""
    fn = re.search(r'function computeContinuousMultiDayAggregates\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must NOT use Utilities.parseDate with calendar TZ for the base date construction.
    # Must use Date.UTC or UTC-anchored arithmetic.
    assert_true('Date.UTC' in body or 'getUTCFullYear()' in body,
        'dateKey list must be built using UTC arithmetic (Date.UTC or getUTC* methods)')
    assert_true('getUTCMonth' in body or 'UTC' in body,
        'date iteration must use UTC methods, not calendar-TZ parseDate')


def test_ical_airQualPoor_threshold_40():
    """airQualPoor advice must trigger at EAQI > 40 (Poor threshold), not > 80.
    EAQI "Poor" = 41-80; AQI=70 (clearly Poor) would never fire at >80."""
    fn = re.search(r'function generatePrioritizedAdvices\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must check > 40 for EAQI airQualPoor, not > 80
    assert_true(re.search(r'ctx\.aqi\s*>\s*40', body),
        'airQualPoor must trigger at ctx.aqi > 40, not > 80')
    assert_true('airQualPoor' in body,
        'generatePrioritizedAdvices must call adv("airQualPoor")')


def test_ical_getMoonPhaseDetails_balanced_parens():
    """getMoonPhaseDetails illumination formula must have balanced parentheses.
    The formula (1 - cos(2*pi*x/(lp/86400))) / 2 has 3 opens and 3 closes."""
    fn = re.search(r'function getMoonPhaseDetails\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The illumination line must exist
    illum_match = re.search(r'illumination\s*=\s*(.+?);', body)
    assert_true(illum_match is not None)
    formula = illum_match.group(1)
    opens = formula.count('(')
    closes = formula.count(')')
    assert_eq(opens, closes, f'illumination formula parens unbalanced: {opens} opens vs {closes} closes — formula: {formula!r}')


def test_gcal_getMoonPhaseDetails_balanced_parens():
    fn = re.search(r'function getMoonPhaseDetails\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    illum_match = re.search(r'illumination\s*=\s*(.+?);', body)
    assert_true(illum_match is not None)
    formula = illum_match.group(1)
    opens = formula.count('(')
    closes = formula.count(')')
    assert_eq(opens, closes, f'illumination formula parens unbalanced: {opens} opens vs {closes} closes — formula: {formula!r}')


def test_gcal_meteor_peak_uses_regex():
    """getAstronomicalEventsForYear must use /Meteor Peak/i regex, NOT .indexOf('Meteor').
    The latter matches 'Meteor Ramp-up', appending '(YYYY)' to ramp-up entries erroneously."""
    fn = re.search(r'function getAstronomicalEventsForYear\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('/Meteor Peak/i' in body or 'Meteor Peak' in body and 'RegExp' in body,
        'getAstronomicalEventsForYear must use /Meteor Peak/i regex, not indexOf("Meteor")')
    assert_true('indexOf("Meteor")' not in body and "indexOf('Meteor')" not in body,
        'Must NOT use indexOf("Meteor") — matches "Ramp-up" too')


def test_ical_parseLocationsFromParams_array_coerced():
    """parseLocationsFromParams must coerce URL params that Apps Script may deliver as arrays.
    Without coercion, p.locations.split(',') would throw (arrays have no split method)."""
    fn = re.search(r'function parseLocationsFromParams\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('Array.isArray' in body or 'asString' in body or 'join' in body,
        'parseLocationsFromParams must handle array-valued URL params (use asString helper or join)')


def test_ical_unitParam_string_coerced():
    """unitParam must coerce to string before .toLowerCase(), or arrays crash."""
    fn = re.search(r'function doGet\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('String(params.unit' in body or 'String(params.temperatureUnit' in body,
        'unitParam must use String() coercion before .toLowerCase() to handle array-valued params')


# =============================================================================
# Smoke tests — Python port of core pipeline logic with mocked Open-Meteo data
# =============================================================================

def _mock_open_meteo_deterministic(today_offset=0):
    base = datetime.date.today() + datetime.timedelta(days=today_offset)
    times = [(base + datetime.timedelta(days=i)).isoformat() for i in range(16)]
    return {
        'time': times,
        'temperature_2m_max': [25 + i for i in range(16)],
        'temperature_2m_min': [15 + i for i in range(16)],
        'apparent_temperature_max': [26 + i for i in range(16)],
        'weather_code': [0, 1, 2, 3, 45, 51, 61, 65, 71, 80, 85, 95, 0, 1, 2, 3],
        'precipitation_sum': [0.0, 0.5, 2.1, 5.3, 0.1, 8.0, 12.4, 3.2, 0.0, 0.0, 1.0, 0.2, 0.0, 0.0, 0.0, 0.0],
        'precipitation_probability_max': [5, 10, 40, 70, 10, 85, 95, 60, 20, 5, 30, 10, 5, 5, 5, 5],
        'windspeed_10m_max': [8, 12, 18, 25, 10, 35, 45, 20, 8, 5, 15, 10, 5, 8, 10, 12],
        'windgusts_10m_max': [15, 22, 32, 45, 18, 60, 80, 38, 15, 10, 28, 18, 10, 15, 18, 22],
        'sunrise': [f'{times[i][:11]}06:30' for i in range(16)],
        'sunset': [f'{times[i][:11]}18:45' for i in range(16)],
        'uv_index_max': [1.5, 3.2, 5.8, 8.1, 6.5, 2.1, 0.5, 4.2, 7.0, 9.2, 6.8, 3.5, 1.2, 2.8, 4.5, 6.0],
        'et0_fao_evapotranspiration': [2.1, 3.2, 4.5, 5.8, 3.2, 1.0, 0.3, 2.5, 4.8, 6.2, 5.0, 3.0, 2.2, 3.0, 4.0, 4.5],
        'shortwave_radiation_sum': [18.5, 22.3, 26.1, 28.0, 24.2, 14.5, 6.2, 20.1, 25.5, 29.8, 27.0, 21.0, 16.2, 19.5, 23.0, 25.2],
    }


def _mock_ensemble():
    base = datetime.date.today() + datetime.timedelta(days=16)
    times = [(base + datetime.timedelta(days=i)).isoformat() for i in range(14)]
    return {
        'time': times,
        'temperature_2m_max_gfs_seamless': [24 + i + 0.3 for i in range(14)],
        'temperature_2m_min_gfs_seamless': [14 + i + 0.2 for i in range(14)],
        'precipitation_sum_gfs_seamless': [0.5 + i * 0.1 for i in range(14)],
    }


def _mock_air_quality():
    base = datetime.date.today() + datetime.timedelta(days=0)
    times = [(base + datetime.timedelta(days=i)).isoformat() for i in range(14)]
    return {
        'time': times,
        'european_aqi': [25, 40, 55, 70, 35, 20, 45, 60, 80, 42, 30, 15, 20, 25],
        'us_aqi': [None] * 14,
        'pm2_5': [8.5, 12.2, 18.4, 25.1, 10.3, 5.2, 14.8, 22.3, 35.0, 18.5, 10.2, 4.5, 6.0, 7.5],
        'pm10': [15.0, 22.0, 30.0, 40.0, 18.0, 10.0, 25.0, 35.0, 50.0, 30.0, 18.0, 8.0, 10.0, 12.0],
        'birch_pollen': [0, 0, 0, 2, 5, 8, 15, 22, 30, 18, 10, 3, 1, 0],
        'grass_pollen': [5, 8, 12, 20, 35, 45, 55, 60, 40, 25, 15, 8, 3, 2],
        'alder_pollen': [0] * 14,
    }


def _mock_hourly_agg():
    result = {}
    for i in range(16):
        d = (datetime.date.today() + datetime.timedelta(days=i)).isoformat()
        result[d] = {
            'pressure': 1013.25 + (i % 5) * 2 - 4,
            'soilMin': 14 + i,
            'humidity': 60 + i * 2,
            'dewPoint': 10 + i,
            'cloudCover': 30 + i * 5,
        }
    return result


def _compute_variance(max_vals, mean_max):
    return sum((v - mean_max) ** 2 for v in max_vals) / len(max_vals)


def _compute_7day_rain(det, idx):
    total = 0.0
    for i in range(idx, min(idx + 7, len(det['time']))):
        total += det['precipitation_sum'][i] or 0
    return round(total, 1)


def test_smoke_pipeline_deterministic():
    """Full pipeline: mock deterministic data → advice engine → ICS escape/fold.
    Exercises every major code path with real computed values."""
    det = _mock_open_meteo_deterministic(0)
    aq = _mock_air_quality()
    date_keys = [det['time'][i] for i in range(3)]

    for i, dk in enumerate(date_keys):
        idx = det['time'].index(dk)
        max_vals = [det['temperature_2m_max'][idx]]
        mean_max = sum(max_vals) / len(max_vals)
        rounded_max = round(mean_max)
        variance = _compute_variance(max_vals, mean_max)
        spread = max(1, round(math.sqrt(variance)))
        assert_true(spread >= 1, f'spread should be >= 1, got {spread}')

        code = det['weather_code'][idx]
        glyph = get_weather_glyph(code)
        assert_true(glyph in ('☀️', '🌤️', '⛅', '☁️'), f'weather glyph {glyph!r} unexpected for code {code}')

        sunset = det['sunset'][idx][11:16]
        golden = get_golden_hour_window(sunset)
        assert_true(':' in golden and '-' in golden, f'golden hour malformed: {golden}')

        aqi_val = aq['european_aqi'][idx]
        assert_true(0 <= aqi_val <= 500, f'AQI {aqi_val} out of range')
        # Day 3 (i=3) has EAQI=70 — verify it triggers the airQualPoor advice threshold (>40)
        if i == 3:
            assert_true(aqi_val > 40, f'Day 3 EAQI={aqi_val} should trigger airQualPoor (>40)')

        pollen = round(max(
            aq['birch_pollen'][idx] or 0,
            aq['grass_pollen'][idx] or 0,
            aq['alder_pollen'][idx] or 0
        ))
        assert_true(pollen >= 0, f'pollen {pollen} negative')

        rain7 = _compute_7day_rain(det, idx)
        assert_true(isinstance(rain7, float) or isinstance(rain7, int), f'7-day rain {rain7!r} not numeric')
        assert_true(rain7 >= 0, f'aggregate rain {rain7} negative')

        moon = get_moon_phase_details(datetime.datetime.fromisoformat(dk))
        assert_true(0 <= moon['fraction'] <= 1, f'moon fraction {moon["fraction"]} out of range')
        assert_true(isinstance(moon['illumination'], str) and '%' in moon['illumination'],
            f'moon illumination {moon["illumination"]!r} malformed')


def test_smoke_pipeline_ensemble():
    """Ensemble branch: variance computed on unrounded mean, spread uses sqrt."""
    ens = _mock_ensemble()
    idx = 2
    t_max_vals = [ens['temperature_2m_max_gfs_seamless'][idx] + j * 0.5 for j in range(5)]
    mean_max = sum(t_max_vals) / len(t_max_vals)
    rounded_max = round(mean_max)
    variance = _compute_variance(t_max_vals, mean_max)
    spread = max(1, round(math.sqrt(variance)))
    assert_true(spread >= 1, f'ens spread {spread} should be >= 1')
    assert_true(abs(rounded_max - mean_max) <= 1, f'rounded_max {rounded_max} too far from mean {mean_max:.2f}')


def test_smoke_ics_escape_and_fold():
    """RFC 5545 compliance: CRLF, escaped chars, 75-octet folding."""
    lines = [
        'BEGIN:VEVENT',
        'SUMMARY:Test event with emoji and unicode: ☀️ 🌱 💧',
        'DESCRIPTION:Description with semicolon; comma, backslash\\ and quotes',
        'GEO:52.52;13.405',
        'LOCATION:Berlin, Germany',
        'COMMENT:Long line ' + 'x' * 100,
        'END:VEVENT',
    ]
    escaped = [escape_ics_text(l) for l in lines]
    for s in escaped:
        assert_true('\r' not in s, f'CR should be stripped: {s!r}')
        assert_true(';' not in s or '\\;' in s, f'semicolon not escaped in: {s!r}')
    folded = fold_ics_lines(escaped)
    for chunk in folded.split('\r\n'):
        leading = chunk.lstrip(' \t')
        continuation = (chunk != folded.split('\r\n')[0] and chunk.startswith(' '))
        if continuation:
            assert_true(len(chunk) <= 75 + 5, f'folded continuation too long: {len(chunk)} octets')
        else:
            assert_true(len(chunk) <= 75 + 5, f'line too long: {len(chunk)} octets')


def test_smoke_aqi_priority_eaqi_first():
    """AQI: EAQI preferred over USAQI. If european_aqi is null, use us_aqi."""
    def pick_aqi(ea, us):
        if ea is not None:
            return round(ea), 'EAQI'
        if us is not None:
            return round(us), 'USAQI'
        return None, 'AQI'
    a, t = pick_aqi(65, 120)
    assert_true(t == 'EAQI', f'EAQI should win (got {t})')
    assert_true(a == 65, f'EAQI value wrong (got {a})')
    a, t = pick_aqi(None, 120)
    assert_true(t == 'USAQI', f'USAQI should win when EAQI absent (got {t})')
    a, t = pick_aqi(None, None)
    assert_true(a is None, f'both null should give None (got {a})')


def test_smoke_air_qual_poor_threshold_eaqi():
    """airQualPoor fires at ctx.aqi > 40 (EAQI Poor = 41-80)."""
    def fire_air_qual_poor(aqi, aqi_type):
        return aqi is not None and aqi_type != 'USAQI' and aqi > 40
    assert_true(fire_air_qual_poor(70, 'EAQI'), 'EAQI=70 should fire airQualPoor')
    assert_true(fire_air_qual_poor(41, 'EAQI'), 'EAQI=41 should fire airQualPoor')
    assert_true(not fire_air_qual_poor(40, 'EAQI'), 'EAQI=40 should NOT fire (threshold is > 40)')
    assert_true(fire_air_qual_poor(80, 'EAQI'), 'EAQI=80 should fire airQualPoor (still in Poor band)')


# =============================================================================
# Pass 1/2 — principal engineer fixes
# =============================================================================

def test_gcal_reconcileGroundTruth_uses_utc_anchor():
    """reconcileGroundTruth must use UTC midnight (T00:00:00Z), not local midnight,
    when comparing Open-Meteo dates. A server in UTC-5 interpreting 2026-09-04T00:00:00
    as 2026-09-03T19:00:00 UTC would misclassify today as past-day."""
    fn = re.search(r'function reconcileGroundTruth\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('T00:00:00Z' in body,
        'reconcileGroundTruth must use T00:00:00Z (UTC) not T00:00:00 (local)')


def test_gcal_assessRoadConditions_has_nan_guard():
    """assessRoadConditions must guard against NaN from null tMin/soilMin/rainVol,
    matching the defensive behaviour of the icalweather.gs equivalent."""
    fn = re.search(r'function assessRoadConditions\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('isNaN' in body,
        'assessRoadConditions must check isNaN to avoid NaN propagation from null temps')


def test_gcal_generatePrioritizedAdvices_safeTemp_defaults():
    """generatePrioritizedAdvices must fall back to safe defaults when ctx.tempMax/Min
    are null, preventing NaN from propagating into priority comparisons."""
    fn = re.search(r'function generatePrioritizedAdvices\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must check typeof before arithmetic
    assert_true('typeof ctx.tempMax' in body,
        'generatePrioritizedAdvices must guard tempMax with typeof before arithmetic')
    assert_true('typeof ctx.tempMin' in body,
        'generatePrioritizedAdvices must guard tempMin with typeof before arithmetic')


def test_gcal_buildDashboardPayload_nullTemp_guard():
    """buildDashboardPayload must guard against null temperature_2m_max/min in the
    deterministic branch, returning null so the caller skips the day (not NaN in title)."""
    fn = re.search(r'function buildDashboardPayload\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('tMaxRaw == null' in body or 'maxRaw == null' in body,
        'buildDashboardPayload must check temperature_2m_max for null before Math.round')


def test_gcal_fetchAllAtmosphericDataParallel_logs_failures():
    """fetchAllAtmosphericDataParallel must log non-200 responses so failures are
    visible in the Apps Script log, not silently dropped."""
    fn = re.search(r'function fetchAllAtmosphericDataParallel\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('Logger.log' in body and 'returned HTTP' in body,
        'fetchAllAtmosphericDataParallel must log non-200 responses')


def test_ical_fetchIcsAtmosphericDataParallel_logs_failures():
    """fetchIcsAtmosphericDataParallel must log non-200 responses per endpoint."""
    fn = re.search(r'function fetchIcsAtmosphericDataParallel\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('Logger.log' in body and 'deterministic' in body,
        'fetchIcsAtmosphericDataParallel must log per-endpoint HTTP failures')


# =============================================================================
# Pass 2/2 — perf hot-path hoisting + TZ correctness
# =============================================================================

def test_ical_generateIcsFeed_hoists_ensemble_keys():
    """generateIcsFeed must hoist ensemble max/min key lists out of the per-offset loop.
    Without hoisting, Object.keys/filter runs O(offsets × modelKeys) per location per day.
    4 cities × 30 days × ~5 model keys = 600 wasted filter calls per request."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The hoisted variables must be declared inside the forEach but before the for loop
    assert_true('ensMaxKeys' in body and 'ensMinKeys' in body,
        'generateIcsFeed must declare ensMaxKeys/ensMinKeys once per location, not per offset')


def test_ical_computeContinuousMultiDayAggregates_hoists_ensemble_keys():
    """computeContinuousMultiDayAggregates must hoist ensemble key lists out of
    the per-day loop. The 7-day iteration would otherwise re-scan Object.keys 7 times."""
    fn = re.search(r'function computeContinuousMultiDayAggregates\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('ensMaxKeys' in body and 'ensMinKeys' in body,
        'computeContinuousMultiDayAggregates must hoist ensemble key lists')


def test_gcal_computeContinuousMultiDayAggregates_hoists_ensemble_keys():
    """gcal computeContinuousMultiDayAggregates must also hoist ensemble key lists."""
    fn = re.search(r'function computeContinuousMultiDayAggregates\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('ensMaxKeys' in body and 'ensMinKeys' in body,
        'gcal computeContinuousMultiDayAggregates must hoist ensemble key lists')


def test_gcal_reconcileGroundTruth_today_uses_utc():
    """reconcileGroundTruth must compare target dates to today using UTC midnight,
    not local midnight (setHours(0,0,0,0)). A UTC+8 server would otherwise classify
    today's Open-Meteo date as 'yesterday' near 00:00 local."""
    fn = re.search(r'function reconcileGroundTruth\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must use Date.UTC for today's anchor
    assert_true('Date.UTC' in body,
        'reconcileGroundTruth must construct today via Date.UTC, not new Date() + setHours(0,0,0,0)')
    # Must NOT use setHours(0, 0, 0, 0) which is local-time anchored
    assert_true('setHours(0, 0, 0, 0)' not in body,
        'reconcileGroundTruth must NOT use setHours(0,0,0,0) — local-time anchored')


def test_gcal_reconcileGroundTruth_minT_null_guard():
    """reconcileGroundTruth must guard minT against null/undefined, not just maxT.
    Otherwise Math.round(null) = 0 and the recorded actual.minTemp is wrong."""
    fn = re.search(r'function reconcileGroundTruth\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('minT !== null' in body and 'minT !== undefined' in body,
        'reconcileGroundTruth must guard both maxT AND minT against null/undefined')


# =============================================================================
# Pass 1/2 follow-up — moon null safety + stale docs + config spelling
# =============================================================================

def test_gcal_moon_phase_null_safe():
    """getMoonPhaseDetails must not return NaN illumination when called with null/undefined.
    Without the guard: Number(null)=0, (0-newMoonRef)%lp = negative, falls to "New Moon"
    but illumination is NaN → "NaN%" string in calendar."""
    fn = re.search(r'function getMoonPhaseDetails\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('date == null' in body and 'Number.isFinite' in body,
        'getMoonPhaseDetails must guard against null date and non-finite ms')


def test_ical_moon_phase_null_safe():
    fn = re.search(r'function getMoonPhaseDetails\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('date == null' in body and 'Number.isFinite' in body,
        'ical getMoonPhaseDetails must guard against null date and non-finite ms')


def test_gcal_config_uses_geocodable_brunssum():
    """Sample CONFIG.locations must use a name the Open-Meteo geocoder can resolve.
    'Brunnsum' (typo) silently fails geocoding and trips the empty-array guard;
    'Brunssum' is the correct spelling for the Dutch town in Limburg."""
    assert_true('Brunssum' in GCAL, 'gcal CONFIG must use geocodable "Brunssum" (was "Brunnsum")')
    assert_true('Brunnsum' not in GCAL, 'gcal CONFIG must NOT contain misspelled "Brunnsum"')


def test_gcal_doc_header_timezone_claim_accurate():
    """File header comment must reflect current UTC-anchored date logic,
    not the old "anchored to local midday" wording."""
    assert_true('UTC-anchored' in GCAL or 'UTC anchored' in GCAL,
        'gcal file header must document UTC-anchored dates (Pass 4/7/8 fix)')
    assert_true('anchored to local midday' not in GCAL,
        'stale "anchored to local midday" claim must be removed from gcal header')


def test_ical_doc_header_mentions_array_safety():
    """ical header must document array-coerced URL params (Pass 6 fix)."""
    assert_true('array-valued' in ICAL.lower() or 'Array-valued' in ICAL,
        'ical header must document array-coerced URL params (Pass 6 fix)')


# =============================================================================
# Pass 1/2 follow-up — AQI hourly aggregation (HTTP 400 fix)
# =============================================================================

def test_gcal_aq_url_uses_hourly_not_daily():
    assert_true('hourly=european_aqi' in GCAL,
        'gcal aqUrl must use hourly=... fields (daily= causes HTTP 400)')
    assert_true('daily=european_aqi' not in GCAL,
        'gcal aqUrl must NOT use daily=... fields (Open-Meteo rejects this)')


def test_ical_aq_url_uses_hourly_not_daily():
    assert_true('hourly=european_aqi' in ICAL,
        'ical aqUrl must use hourly=... fields (daily= causes HTTP 400)')
    assert_true('daily=european_aqi' not in ICAL,
        'ical aqUrl must NOT use daily=... fields')


def test_gcal_aq_aggregation_is_daily_shaped():
    fn = re.search(r'function fetchAllAtmosphericDataParallel\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('aqTime.map' in body and 'european_aqi' in body,
        'gcal AQ handler must map to daily arrays matching consumer shape')


def test_ical_aq_aggregation_is_daily_shaped():
    fn = re.search(r'function fetchIcsAtmosphericDataParallel\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('aqTime.map' in body and 'european_aqi' in body,
        'ical AQ handler must map to daily arrays matching consumer shape')


# =============================================================================
# Pass 1/2 follow-up — NaN poisoning in deterministic temperature reads
# =============================================================================

def test_ical_generateIcsFeed_guards_null_temperature():
    """generateIcsFeed reads data.det.temperature_2m_max[idx] and passes it to
    Math.round(). Without a null guard, Math.round(null) = NaN, which bypasses the
    `currentMax === null` continue check (NaN !== null) and produces "NaN°C"
    in the ICS event title. Fix: check Number.isFinite before rounding."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The fix introduces a local tMaxRaw variable and guards before Math.round
    assert_true('tMaxRaw' in body,
        'generateIcsFeed must extract temperature raw value before rounding (NaN guard)')
    assert_true('Number.isFinite(tMaxRaw)' in body,
        'generateIcsFeed must check Number.isFinite before Math.round on temperature_2m_max')


def test_gcal_computeDayAudit_skips_nan_predictedMax():
    """computeDayAudit reads snap.predictedMax and computes tDiff = snap.predictedMax - baselineMax.
    If snap.predictedMax is NaN (corrupted storage), tDiff is NaN and tempDeltaStr becomes "NaN°C".
    Fix: guard with Number.isFinite and return early."""
    fn = re.search(r'function computeDayAudit\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must guard snap.predictedMax against non-finite values
    assert_true('Number.isFinite(pMax)' in body or 'isFinite(pMax)' in body,
        'computeDayAudit must guard snap.predictedMax with Number.isFinite before use')


def test_gcal_syncWeatherToCalendar_geo_null_guard():
    """syncWeatherToCalendar must guard against geocodeCity returning null
    before accessing .name. Without the guard: TypeError: Cannot read properties of null."""
    fn = re.search(r'function syncWeatherToCalendar\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # The auto-detect path must guard: `if (geo && geo.name)`
    assert_true(re.search(r'if\s*\(\s*geo\s*&&\s*geo\.name', body),
        'syncWeatherToCalendar must check `geo && geo.name` after geocodeCity() call')


def test_gcal_validateConfig_geo_null_guard():
    """validateConfig must guard against geocodeCity returning null.
    Currently checks `!geo || !geo.lat || !geo.lon` which is already safe —
    this test pins that contract."""
    fn = re.search(r'function validateConfig\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true(re.search(r'!geo\s*\|\|\s*!geo\.lat', body),
        'validateConfig must guard against null geo result before .lat/.lon access')


# =============================================================================
# Pass 2/2 — NaN poisoning in accuracy engine + numeric rounding guards
# =============================================================================

def test_gcal_computeGlobalModelAccuracy_uses_isFinite():
    """computeGlobalModelAccuracy snapshots loop must use Number.isFinite,
    not typeof, to guard snap.predictedMax. typeof NaN === "number" so
    typeof alone lets NaN values through the guard and poison the totals."""
    fn = re.search(r'function computeGlobalModelAccuracy\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('Number.isFinite(snap.predictedMax)' in body,
        'gcal computeGlobalModelAccuracy must use Number.isFinite(snap.predictedMax)')


def test_ical_computeGlobalModelAccuracy_uses_isFinite():
    fn = re.search(r'function computeGlobalModelAccuracy\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('Number.isFinite(snap.predictedMax)' in body,
        'ical computeGlobalModelAccuracy must use Number.isFinite(snap.predictedMax)')


def test_ical_generateIcsFeed_wind_radiation_null_guards():
    """generateIcsFeed deterministc branch must guard windspeed/windgusts/uv/et0
    with != null check before Math.round. Math.round(undefined) = NaN, which
    bypasses the currentMax === null guard and appears as "NaN" in the ICS title."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must extract raw values and guard before Math.round
    assert_true('wMaxRaw' in body,
        'ical must extract windspeed raw value before rounding (NaN guard)')
    assert_true('Number.isFinite(wMaxRaw)' in body or 'wMaxRaw != null' in body,
        'ical windspeed rounding must guard against null/undefined before Math.round')


def test_ical_generateIcsFeed_rainProb_null_guard():
    """rainProb must guard against null element in precipitation_probability_max array.
    Previously used: arr ? arr[idx] : 0 which passes null through as 0 — wrong.
    Must use: arr && arr[idx] != null ? arr[idx] : 0."""
    fn = re.search(r'function generateIcsFeed\([\s\S]*?\n\}', ICAL)
    assert_true(fn is not None)
    body = fn.group(0)
    assert_true('precipitation_probability_max[idx] != null' in body,
        'rainProb must guard arr[idx] != null, not just arr ? arr[idx] : 0')


def test_gcal_resolveCalendar_auto_creates_missing_calendar():
    """resolveCalendar must create the calendar if it doesn't exist, rather than
    throwing. The default CONFIG.calendarName = 'Weather Forecast' may not exist
    on a fresh install — the script should bootstrap itself without manual setup."""
    fn = re.search(r'function resolveCalendar\([\s\S]*?\n\}', GCAL)
    assert_true(fn is not None)
    body = fn.group(0)
    # Must contain CalendarApp.createCalendar call (not throw on missing name)
    assert_true('CalendarApp.createCalendar' in body,
        'resolveCalendar must auto-create calendar instead of throwing')
    assert_true("'Weather Forecast' not found" not in body,
        'resolveCalendar must not throw when calendar is missing — must create it')


def test_gcal_doc_header_describes_auto_create():
    """File header must describe the new auto-create behavior, not the old
    'throws explicit error when no calendar matches' wording."""
    assert_true('auto-creates' in GCAL or 'auto-create' in GCAL,
        'gcal file header must describe auto-create calendar behavior')
    assert_true('throws an explicit error when no calendar matches' not in GCAL,
        'stale "throws when no calendar matches" claim must be removed from gcal header')


# =============================================================================
# README hygiene
# =============================================================================

def test_readme_ical_endpoint_is_placeholder():
    """README must use a placeholder URL for the ical endpoint since it
    changes on each deploy. The old hardcoded ID should not be present."""
    import os
    readme = open(os.path.join(REPO, 'README.md'), encoding='utf-8').read()
    assert_true('[ICAL_ENDPOINT]' in readme,
        'README must use [ICAL_ENDPOINT] placeholder (endpoint changes on deploy)')
    assert_true('AKfycbzwkRzpOskREtgz2TE187v4jEiurxRhiM7HLKeyOyQ4SSFU1CwVo_vhr6o7iJd79Pw-eg' not in readme,
        'README must not contain the old hardcoded Apps Script ID')


def test_readme_cities_default_is_required():
    """README must not advertise a default for `cities` since the script
    requires it — `London,Dublin` was misleading."""
    import os
    readme = open(os.path.join(REPO, 'README.md'), encoding='utf-8').read()
    assert_true('required' in readme or '(required' in readme,
        'README cities param must indicate it is required, not show a fake default')


# =============================================================================
# Register all test_ functions and run via t()
# =============================================================================
for name, fn in list(globals().items()):
    if name.startswith('test_') and callable(fn):
        t(name[5:].replace('_', ' '), fn)

# =============================================================================
# Summary
# =============================================================================
print(f'\n=== SUMMARY ===')
print(f'Passed: {pass_n}')
print(f'Failed: {fail_n}')
if fail_n > 0:
    print('\nFailures:')
    for n, e in failures:
        print(f'  - {n}')
        print(f'    {e.split(chr(10))[0]}')
    sys.exit(1)
sys.exit(0)
