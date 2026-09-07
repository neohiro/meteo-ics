"""log_aggregator.py — Parse structured JSON logs from .gs execution output.

Reads log files (one line per log entry) emitted by _log_gcal/_log_ical and
computes SLOs: fetch success rate, circuit open rate, cache hit ratio,
e2e test pass rate.

Usage:
  python tests/log_aggregator.py tests/fixtures/sample_logs.txt
  python tests/log_aggregator.py --slos tests/fixtures/sample_logs.txt

Output: human-readable summary of SLOs.
Exit: 0 if SLOs met, 1 if breached, 2 if no logs.
"""
import argparse
import json
import sys
from collections import defaultdict


def parse_logs(path):
    """Parse a log file into a list of structured records.

    Skips lines that are not valid JSON or missing 'event' field.
    """
    records = []
    with open(path, 'r', encoding='utf-8') as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                print(f'WARN: line {lineno}: invalid JSON: {e}', file=sys.stderr)
                continue
            if 'event' not in rec:
                continue
            records.append(rec)
    return records


def compute_slos(records):
    """Compute SLOs from a list of structured log records."""
    slos = {
        'total_events': len(records),
        'sources': defaultdict(int),
        'events_by_type': defaultdict(int),
        'fetch': {
            'total': 0,
            'success': 0,
            'error': 0,
            'cached': 0,
            'errors': [],
        },
        'circuit': {
            'opened': 0,
            'closed': 0,
            'half_open': 0,
            'transitions': [],
        },
        'cache': {
            'hits': 0,
            'misses': 0,
            'hit_ratio': 0.0,
        },
        'e2e_tests': {
            'total': 0,
            'passed': 0,
            'failed': 0,
            'pass_rate': 0.0,
            'durations_ms': [],
        },
        'errors': [],
    }

    for rec in records:
        slos['sources'][rec.get('source', 'unknown')] += 1
        event = rec.get('event', '')
        slos['events_by_type'][event] += 1

        if event == 'fetch':
            slos['fetch']['total'] += 1
            code = rec.get('code', 0)
            if rec.get('status') == 'error':
                slos['fetch']['error'] += 1
                slos['fetch']['errors'].append({
                    'ts': rec.get('ts'),
                    'service': rec.get('service'),
                    'code': code,
                    'error': rec.get('error', 'unknown')
                })
            elif code and 200 <= code < 400:
                slos['fetch']['success'] += 1
            else:
                slos['fetch']['error'] += 1
            if rec.get('cached'):
                slos['fetch']['cached'] += 1

        elif event == 'cache':
            if rec.get('hit'):
                slos['cache']['hits'] += 1
            else:
                slos['cache']['misses'] += 1

        elif event == 'circuit':
            transition = rec.get('transition', '')
            if transition in ('closed_to_open', 'OPEN'):
                slos['circuit']['opened'] += 1
                slos['circuit']['transitions'].append({
                    'ts': rec.get('ts'),
                    'name': rec.get('name'),
                    'from': 'closed',
                    'to': 'open'
                })
            elif transition in ('open_to_half_open', 'HALF_OPEN'):
                slos['circuit']['half_open'] += 1
            elif transition in ('half_open_to_closed', 'closed'):
                slos['circuit']['closed'] += 1

        elif event == 'e2e_test':
            slos['e2e_tests']['total'] += 1
            if rec.get('status') == 'error':
                slos['e2e_tests']['failed'] += 1
            else:
                p = rec.get('passed', 0)
                f = rec.get('failed', 0)
                if f == 0 and p > 0:
                    slos['e2e_tests']['passed'] += 1
                else:
                    slos['e2e_tests']['failed'] += 1
            if 'durationMs' in rec:
                slos['e2e_tests']['durations_ms'].append(rec['durationMs'])

        if 'error' in rec and event != 'e2e_test':
            slos['errors'].append({
                'ts': rec.get('ts'),
                'event': event,
                'error': str(rec.get('error', ''))[:200]
            })

    total_cache = slos['cache']['hits'] + slos['cache']['misses']
    if total_cache > 0:
        slos['cache']['hit_ratio'] = round(slos['cache']['hits'] / total_cache, 4)

    total_e2e = slos['e2e_tests']['total']
    if total_e2e > 0:
        slos['e2e_tests']['pass_rate'] = round(slos['e2e_tests']['passed'] / total_e2e, 4)

    return slos


def format_report(slos):
    """Format SLO report for human display."""
    lines = []
    lines.append('=== METEOR-ICS SLO REPORT ===')
    lines.append(f"Total events: {slos['total_events']}")

    if slos['sources']:
        lines.append('\nSources:')
        for src, n in sorted(slos['sources'].items(), key=lambda x: -x[1]):
            lines.append(f'  {src:20s} {n:6d}')

    if slos['events_by_type']:
        lines.append('\nEvent types:')
        for ev, n in sorted(slos['events_by_type'].items(), key=lambda x: -x[1]):
            lines.append(f'  {ev:20s} {n:6d}')

    f = slos['fetch']
    if f['total'] > 0:
        success_rate = f['success'] / f['total']
        lines.append('\nFetch SLOs:')
        lines.append(f"  Total fetches:    {f['total']:6d}")
        lines.append(f"  Success:          {f['success']:6d} ({success_rate*100:.2f}%)")
        lines.append(f"  Errors:           {f['error']:6d} ({f['error']/f['total']*100:.2f}%)")
        lines.append(f"  Cached:           {f['cached']:6d}")
        if f['errors']:
            lines.append('  Recent errors:')
            for e in f['errors'][:5]:
                lines.append(f"    {e['ts']} {e['service']} HTTP {e['code']}: {e['error'][:60]}")

    c = slos['cache']
    total_cache = c['hits'] + c['misses']
    if total_cache > 0:
        lines.append('\nCache SLOs:')
        lines.append(f"  Hits:             {c['hits']:6d}")
        lines.append(f"  Misses:           {c['misses']:6d}")
        lines.append(f"  Hit ratio:        {c['hit_ratio']*100:.2f}%")

    cb = slos['circuit']
    if cb['transitions']:
        lines.append('\nCircuit Breaker:')
        lines.append(f"  Open transitions: {cb['opened']:6d}")
        lines.append(f"  Half-open:        {cb['half_open']:6d}")
        lines.append(f"  Closed:           {cb['closed']:6d}")

    e = slos['e2e_tests']
    if e['total'] > 0:
        lines.append('\nE2E Tests:')
        lines.append(f"  Total:            {e['total']:6d}")
        lines.append(f"  Passed:           {e['passed']:6d} ({e['pass_rate']*100:.2f}%)")
        lines.append(f"  Failed:           {e['failed']:6d}")
        if e['durations_ms']:
            avg = sum(e['durations_ms']) / len(e['durations_ms'])
            mx = max(e['durations_ms'])
            lines.append(f"  Avg duration:     {avg:.0f}ms")
            lines.append(f"  Max duration:     {mx}ms")

    if slos['errors']:
        lines.append(f"\nUnclassified errors: {len(slos['errors'])}")

    return '\n'.join(lines)


def evaluate_slos(slos, thresholds=None):
    """Evaluate SLOs against thresholds. Returns list of breaches.

    Default thresholds:
      - fetch success rate >= 95%
      - e2e test pass rate = 100%
      - circuit opened = 0 (in production)
    """
    if thresholds is None:
        thresholds = {
            'fetch_success_rate': 0.95,
            'e2e_pass_rate': 1.0,
            'max_circuit_opens': 0,
        }

    breaches = []
    f = slos['fetch']
    if f['total'] > 0:
        rate = f['success'] / f['total']
        if rate < thresholds['fetch_success_rate']:
            breaches.append(
                f"Fetch success rate {rate*100:.2f}% < {thresholds['fetch_success_rate']*100:.0f}%")

    e = slos['e2e_tests']
    if e['total'] > 0:
        if e['pass_rate'] < thresholds['e2e_pass_rate']:
            breaches.append(
                f"E2E pass rate {e['pass_rate']*100:.2f}% < {thresholds['e2e_pass_rate']*100:.0f}%")

    cb = slos['circuit']
    if cb['opened'] > thresholds['max_circuit_opens']:
        breaches.append(
            f"Circuit opened {cb['opened']} times > {thresholds['max_circuit_opens']}")

    return breaches


def main():
    parser = argparse.ArgumentParser(
        description='Parse structured logs from .gs and compute SLOs.')
    parser.add_argument('logfile', help='Path to log file (one JSON record per line)')
    parser.add_argument('--slos', action='store_true',
        help='Evaluate SLOs and exit non-zero on breach')
    parser.add_argument('--json', action='store_true', help='Output JSON instead of text')
    args = parser.parse_args()

    try:
        records = parse_logs(args.logfile)
    except FileNotFoundError:
        print(f'ERROR: log file not found: {args.logfile}', file=sys.stderr)
        sys.exit(2)

    if not records:
        print('No structured log records found.', file=sys.stderr)
        sys.exit(2)

    slos = compute_slos(records)

    if args.json:
        slos['sources'] = dict(slos['sources'])
        slos['events_by_type'] = dict(slos['events_by_type'])
        print(json.dumps(slos, indent=2, default=str))
        return 0

    print(format_report(slos))

    if args.slos:
        breaches = evaluate_slos(slos)
        if breaches:
            print('\n=== SLO BREACHES ===')
            for b in breaches:
                print(f'  ! {b}')
            return 1
        print('\nAll SLOs met.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
