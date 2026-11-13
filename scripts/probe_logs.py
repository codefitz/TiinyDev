#!/usr/bin/env python3
"""Read-only Tiiny log API probe. Prompts for a token without echoing it."""
import argparse
import datetime as dt
import getpass
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def summarize(data, start=None, end=None):
    items = data.get('items', [])
    times = []
    for item in items:
        try:
            value = dt.datetime.fromisoformat(str(item.get('ts', '')).replace('Z', '+00:00'))
            if value.tzinfo:
                times.append(value)
        except ValueError:
            pass
    return {
        'response_keys': list(data), 'returned_items': len(items),
        'has_next_page': data.get('next_cursor') is not None,
        'oldest': min(times).isoformat() if times else None,
        'newest': max(times).isoformat() if times else None,
        'entries_outside_requested_dates': sum(t < start or t > end for t in times) if start and end else None,
    }


def api_timestamp(value):
    """Match JavaScript Date.toISOString(): UTC, milliseconds, Z suffix."""
    return value.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def known_entry_probes(item):
    timestamp = dt.datetime.fromisoformat(item['ts'].replace('Z', '+00:00'))
    # Pad sub-millisecond timestamps safely when matching the browser's precision.
    start = timestamp.replace(microsecond=(timestamp.microsecond // 1000) * 1000) - dt.timedelta(milliseconds=1)
    end = start + dt.timedelta(milliseconds=3)
    return [
        ('known-entry control (browser timestamp format)', {
            'limit': 100, 'start_ts': api_timestamp(start), 'end_ts': api_timestamp(end)
        }, item.get('id')),
        ('known-entry control (+00:00 timestamp format)', {
            'limit': 100, 'start_ts': start.isoformat(), 'end_ts': end.isoformat()
        }, item.get('id')),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://192.168.2.231')
    yesterday = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
    parser.add_argument('--from-date', default=(yesterday - dt.timedelta(days=6)).isoformat())
    parser.add_argument('--to-date', default=yesterday.isoformat())
    args = parser.parse_args()
    root = urllib.parse.urlsplit(args.base_url)
    if root.scheme not in ('http', 'https') or not root.hostname or root.username or root.password or root.query or root.fragment:
        parser.error('Use an HTTP(S) service URL without credentials, query or fragment.')
    try:
        start = dt.datetime.combine(dt.date.fromisoformat(args.from_date), dt.time.min, dt.timezone.utc)
        end = dt.datetime.combine(dt.date.fromisoformat(args.to_date), dt.time(23, 59, 59, 999000), dt.timezone.utc)
    except ValueError:
        parser.error('Dates must use YYYY-MM-DD.')
    if start > end:
        parser.error('From date must precede To date.')
    token = os.environ.get('TIINY_API_KEY') or getpass.getpass('Tiiny bearer token (hidden): ')
    if not token:
        parser.error('A token is required.')
    token = token.removeprefix('Bearer ').strip()
    probes = [
        ('sessions', '/api/v1/model-logs/sessions', {'service_history': 'all', 'limit': 500}, None),
        ('latest logs', '/api/v1/model-logs/timeline', {'limit': 100}, None),
        ('requested dates (UTC)', '/api/v1/model-logs/timeline', {'limit': 100, 'start_ts': api_timestamp(start), 'end_ts': api_timestamp(end)}, None),
    ]
    for label, path, query, expected_id in probes:
        url = args.base_url.rstrip('/') + path + '?' + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        result = {'probe': label, 'url': url}
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
                lower = dt.datetime.fromisoformat(query['start_ts'].replace('Z', '+00:00')) if 'start_ts' in query else None
                upper = dt.datetime.fromisoformat(query['end_ts'].replace('Z', '+00:00')) if 'end_ts' in query else None
                result.update(status=response.status, **summarize(data, lower, upper))
                if expected_id is not None:
                    result['known_entry_found'] = any(item.get('id') == expected_id for item in data.get('items', []))
                if label == 'latest logs':
                    known = next((item for item in data.get('items', []) if item.get('ts') and item.get('id') is not None), None)
                    if known:
                        probes.extend((name, path, params, entry_id) for name, params, entry_id in known_entry_probes(known))
        except urllib.error.HTTPError as error:
            result.update(status=error.code, reason=error.reason)
        except (OSError, ValueError, TypeError) as error:
            result.update(error=type(error).__name__)
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
