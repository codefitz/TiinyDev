"""Run with python3 tests/probe_logs_test.py."""
import datetime as dt
import pathlib
import runpy

probe = runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/probe_logs.py'))
known = {'id': 42, 'ts': '2026-11-13T11:58:48.715119000Z'}
cases = probe['known_entry_probes'](known)
assert len(cases) == 2
for label, params, expected_id in cases:
    start = dt.datetime.fromisoformat(params['start_ts'].replace('Z', '+00:00'))
    end = dt.datetime.fromisoformat(params['end_ts'].replace('Z', '+00:00'))
    timestamp = dt.datetime.fromisoformat(known['ts'].replace('Z', '+00:00'))
    assert start < timestamp < end
    assert expected_id == 42
    result = probe['summarize']({'items': [known]}, start, end)
    assert result['returned_items'] == 1
    assert result['entries_outside_requested_dates'] == 0
assert cases[0][1]['start_ts'].endswith('Z')
assert cases[1][1]['start_ts'].endswith('+00:00')
assert probe['api_timestamp'](dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc)) == '2026-11-06T00:00:00.000Z'
print('PASS: known-entry controls enclose nanosecond timestamps; browser and offset formats agree')
