# TiinyDev
Collection of dev projects for Tiiny Pocket Lab.

## Tiiny Logs

[Tiiny Logs](tiiny_logs.html) is a standalone browser interface for inspecting recorded model runs and their logs. It requires a Tiiny service that exposes the model-logs API and a bearer token with access to those endpoints.

1. Open `tiiny_logs.html` in a browser that can reach your device.
2. Expand **Service connection**, enter the device's service address (for example, `http://192.168.2.231`) and bearer token, then select **Connect**. A trailing `/v1` or `/api/v1` is removed automatically.
3. The default view loads entries from the recorded sessions returned by the device. A loading banner shows when the session list or entries are still arriving.
4. Choose a recorded run to inspect its entries, or use **All sessions** to clear the filters and restore the cached default view.

### Searching and browsing

- **Search device history:** set **From date**, **To date**, **Model**, and **Log level**, then select **Search logs**. The request goes to the device across all sessions; it is not limited to entries already in the browser. Dates use your local timezone, and the To date includes the entire day. Blank dates mean no date restriction.
- **Load additional results:** a date search loads the first matching page. Use **Load older history** to follow additional pages, or **Stop loading history** to stop after the pending page. The session-list button loads more runs when the API provides a next page; otherwise it becomes **Refresh runs**.
- **Browse loaded results:** the six linked columns narrow entries by month, day, hour, model, and log level. Select an entry to open its details. **Reset selection** clears these local selections; **Clear query** clears the device-search filters.
- **Explore the pies:** model activity counts recorded runs per model, using run creation time for period filters. The log-level pie counts loaded entries within the selected period and model. Click slices or legend items to filter entries; click again or use **All models** / **All levels** to clear the corresponding selection. These counts represent runs or log entries, not generation requests, runtime, or hardware utilisation.
- **Inspect and export:** switch between **Table** and **Full text**, enable **Live** for new entries, or export matching logs as CSV or NDJSON. **Raw NDJSON** downloads the selected session's original log stream.

The browser holds at most 100,000 entries and labels incomplete results. Narrow the date range when this limit is reached. Server-side exports paginate independently of that display limit. The viewer can only retrieve history still exposed by the device's API; an empty older period does not establish whether logs were archived, deleted, or never recorded.

The bearer token is kept in browser session storage; connection and filter preferences use local storage. **Copy diagnostics** omits the token and log message bodies but includes the device address, query filters, and pagination details. **Last device log request** shows the requested URL and returned date range.

### Diagnosing API access

Use the read-only terminal probe to compare recent logs, a requested date range, and a narrow range around a known entry:

```sh
python3 scripts/probe_logs.py --base-url http://192.168.2.231 --from-date 2026-11-06 --to-date 2026-11-12
```

Replace the address and dates as needed. The probe prompts for the bearer token without echoing it and prints response counts, date ranges, and pagination status rather than log contents. Without date arguments, it checks the seven complete UTC days ending yesterday. A `401` indicates an authentication problem; successful empty results mean the API returned no entries for that query.

Run the local regression checks with:

```sh
node tests/tiiny_logs_dashboard.cjs
python3 tests/probe_logs_test.py
```

## Tiiny Video

[Tiiny Video](Video/tiiny_video.html) is a standalone browser interface for generating clips on a Tiiny Pocket Lab with MiniMax H3 Turbo.

1. Open the HTML file in a browser that can reach your Tiiny. Open **API settings** beside the title and enter your API key. The default API base URL is `http://openai.api.tiiny/v1`.
2. Enter a prompt and choose a size, duration, and step count. You can also click or drag a PNG, JPEG, or WebP into the reference image area to guide the opening frame.
3. Select **Generate video**. When the clip is ready, play it in the preview or select **Download MP4**.

| Aspect | Standard | Large |
| --- | --- | --- |
| Landscape | 832 × 480 | 1344 × 768 |
| Portrait | 480 × 832 | 768 × 1344 |

> **Allow time for generation.** A recorded standard-size run took about eight minutes. Progress can stay at the same percentage for a while, and the page's time estimate is approximate. Keep the page open and avoid refreshing while it monitors the job. Larger sizes can take considerably longer and may fail even though the model supports them. Start with a short clip at a standard size, or fall back to the standard size if a large job fails.
