// Run with: node tests/tiiny_logs_dashboard.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../tiiny_logs.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const extractFunction = name => script.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const context = vm.createContext({pad2: value => String(value).padStart(2, '0')});
vm.runInContext(extractFunction('entrySelectionData'), context);
const group = context.entrySelectionData;
const entries = [
 {id: 1, ts: new Date(2026, 0, 31, 23, 59).toISOString(), model_id: 'a', level: 'info'},
 {id: 2, ts: new Date(2026, 1, 1).toISOString(), model_id: 'a', level: 'warning'},
 {id: 3, ts: new Date(2026, 1, 1).toISOString(), model_id: 'b', level: 'error'},
 {id: 4, ts: 'invalid', level: 'debug'}
];
const all = group(entries, {});
assert.equal(all.matching.length, 4);
assert.equal(all.months.size, 3);
assert.equal(all.models.size, 3);
assert.equal(group(entries, {month: '2026-02'}).matching.length, 2);
const day = group(entries, {month: '2026-02', day: '2026-02-01'});
assert.equal(day.models.get('id:a'), 1);
assert.equal(day.models.get('id:b'), 1);
assert.equal(group(entries, {month: '2026-02', day: '2026-02-01', model: 'id:a'}).matching[0].level, 'warning');
assert.equal(group(entries, {month: 'unknown', model: 'unknown'}).matching[0].id, 4);
assert.equal(group([], {}).matching.length, 0);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length);
for (const id of ['monthSelection', 'daySelection', 'hourSelection', 'modelSelection', 'levelSelection', 'entrySelection']) assert.ok(ids.includes(id));
console.log('PASS: cascading month/day/model selections, all severity levels, unknown values, empty data, HTML IDs and syntax');

// A saved chart drill-down must not hide entries when selecting another session.
(async () => {
  const controls = Object.fromEntries(['keyword', 'source', 'level', 'event', 'startTs', 'endTs', 'quickRange', 'order', 'modelFilter', 'timelineSessionFilter'].map(name => [name, {value: name === 'order' ? 'desc' : 'stale-filter'}]));
  let requested;
  const context = vm.createContext({
    els: controls, state: {sessions: {selectedId: null}},
    resetDashboardNavigation() {}, markEntryFiltersDirty() {}, setMode() {}, renderSessions() {},
    showPrimaryError(error) { throw error; },
    async startEntryQuery() {
      requested = {session: context.state.sessions.selectedId, filters: Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]))};
    }
  });
  const extract = name => script.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
  vm.runInContext(extract('clearEntryFilters') + '\n' + extract('selectSession'), context);
  await context.selectSession('another-run');
  assert.equal(requested.session, 'another-run');
  for (const name of ['keyword', 'source', 'level', 'event', 'startTs', 'endTs', 'quickRange']) assert.equal(requested.filters[name], '');
  assert.equal(requested.filters.order, 'desc');
  console.log('PASS: session selection clears persisted drill-down filters before querying');
})().catch(error => { console.error(error); process.exitCode = 1; });


const hourly = [
  {id: 10, ts: new Date(2026, 1, 1, 9, 15).toISOString(), model_id: 'a', level: 'info'},
  {id: 11, ts: new Date(2026, 1, 1, 9, 45).toISOString(), model_id: 'a', level: 'error'},
  {id: 12, ts: new Date(2026, 1, 1, 10, 15).toISOString(), model_id: 'a', level: 'warning'}
];
const hourScope = {month: '2026-02', day: '2026-02-01', hour: '09', model: 'id:a'};
assert.equal(group(hourly, hourScope).matching.length, 2);
assert.equal(group(hourly, hourScope).levels.get('info'), 1);
assert.equal(group(hourly, {...hourScope, level: 'error'}).matching[0].id, 11);
assert.equal(group(hourly, {...hourScope, level: 'info'}).matching[0].id, 10);
assert.equal(group(hourly, {...hourScope, hour: '10'}).matching[0].id, 12);
assert.equal(group(entries, {hour: 'unknown'}).matching[0].id, 4);
console.log('PASS: local hour and log level cascade, all-level default, unknown timestamps');

(async () => {
  const calls = [];
  const context = vm.createContext({
    state: {mode: 'sessions', sessions: {selectedId: 'old-run'}, connection: {connected: true}},
    stopLive() {}, clearFilters() {calls.push('clear');}, renderSessions() {},
    setMode(mode) {context.state.mode = mode;},
    async loadOlderHistory() {calls.push('older history');},
    restoreDefaultEntries() {return false;},
    async loadRecordedRunEntries() {
      assert.equal(context.state.sessions.selectedId, null);
      assert.equal(context.state.mode, 'timeline');
      calls.push('query');
    }
  });
  vm.runInContext(script.match(/async function showAllSessions\([^]*?\n\}/)[0], context);
  await context.showAllSessions();
  assert.deepEqual(calls, ['clear', 'query']);
  vm.runInContext(extractFunction('currentEntryPath'), context);
  context.buildTimelineParams = () => 'limit=1000';
  assert.equal(context.currentEntryPath({}), '/api/v1/model-logs/timeline?limit=1000');
  console.log('PASS: All sessions clears selection and filters, then queries the global log timeline');
})().catch(error => {console.error(error); process.exitCode = 1;});

(async () => {
  let calls = 0;
  const context = vm.createContext({
    state: {historyRun: null, entries: {items: [{ts: '2026-11-13T00:00:00Z'}], nextCursor: 'october', exhausted: false, capped: false, loading: false}},
    renderDashboard() {}, showPrimaryError(error) {throw error;},
    async loadEntryPage() {
      calls++;
      context.state.entries.items.push({ts: calls === 1 ? '2026-10-01T00:00:00Z' : '2026-06-01T00:00:00Z'});
      context.state.entries.nextCursor = calls === 1 ? 'june' : null;
      context.state.entries.exhausted = calls === 2;
    }
  });
  vm.runInContext(extractFunction('loadedDateRange') + '\n' + script.match(/async function loadOlderHistory\([^]*?\n\}/)[0], context);
  await context.loadOlderHistory();
  assert.equal(calls, 2);
  assert.equal(context.loadedDateRange(context.state.entries.items).oldest, '2026-06-01T00:00:00.000Z');
  assert.equal(context.state.historyRun, null);
  assert.equal(context.loadedDateRange([{ts: 'invalid'}]), null);
  context.state.entries.capped = true;
  await context.loadOlderHistory();
  assert.equal(calls, 2);
  console.log('PASS: history follows cursors across months, stops at API end/browser cap, and reports date coverage');
})().catch(error => {console.error(error); process.exitCode = 1;});

{
  const context = vm.createContext({URLSearchParams,
    appendParam(params, name, value) {if (value !== undefined && value !== null && value !== '') params.set(name, String(value));},
    state: {sessions: {items: [{session_id: 'a'}], exhausted: true, loading: false}, connection: {connected: true}},
    els: {sessionsCount: {}, sessionsFooterText: {}, loadMoreSessionsBtn: {}},
    renderDashboard() {}, visibleSessions() {return context.state.sessions.items;}
  });
  vm.runInContext(extractFunction('buildTimelineParams') + '\n' + extractFunction('renderSessionsMeta'), context);
  const query = context.buildTimelineParams({startTs: '2026-06-01T00:00:00Z', endTs: '2026-07-31T23:59:59Z', modelId: 'model/a', level: 'info'}, 'older');
  assert.equal(query.get('start_ts'), '2026-06-01T00:00:00Z');
  assert.equal(query.get('end_ts'), '2026-07-31T23:59:59Z');
  assert.equal(query.get('model_id'), 'model/a');
  assert.equal(query.get('level'), 'info');
  assert.equal(query.get('cursor'), 'older');
  context.renderSessionsMeta();
  assert.equal(context.els.loadMoreSessionsBtn.textContent, 'Refresh runs');
  assert.equal(context.els.loadMoreSessionsBtn.disabled, false);
  context.state.sessions.exhausted = false;
  context.renderSessionsMeta();
  assert.equal(context.els.loadMoreSessionsBtn.textContent, 'Load more runs');
  context.state.sessions.loading = true;
  context.renderSessionsMeta();
  assert.equal(context.els.loadMoreSessionsBtn.disabled, true);
  console.log('PASS: date/model/level query parameters and session pagination/refresh button states');
}

(async () => {
  const controls = Object.fromEntries(['keyword', 'source', 'event', 'timelineSessionFilter', 'sessionType', 'quickRange'].map(name => [name, {value: 'old restriction'}]));
  Object.assign(controls, {startTs: {value: '2026-06-01T00:00'}, endTs: {value: '2026-07-31T23:59'}, modelFilter: {value: 'model/a'}, level: {value: 'info'}});
  const calls = [];
  const context = vm.createContext({
    els: controls, state: {connection: {connected: true}, sessions: {selectedId: 'november-run'}, entries: {queryKey: ''}},
    readFilters() {return Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control.value]));},
    validateFilters(filters) {return filters;}, stopLive() {}, resetDashboardNavigation() {}, renderSessions() {},
    setMode(mode) {context.state.mode = mode;}, entryQueryKey: JSON.stringify,
    async startEntryQuery() {
      assert.equal(context.state.mode, 'timeline');
      assert.equal(context.state.sessions.selectedId, null);
      const filters = context.readFilters();
      assert.equal(filters.startTs, '2026-06-01T00:00');
      assert.equal(filters.endTs, '2026-07-31T23:59');
      assert.equal(filters.modelFilter, 'model/a');
      assert.equal(filters.level, 'info');
      for (const name of ['keyword', 'source', 'event', 'timelineSessionFilter', 'sessionType']) assert.equal(filters[name], '');
      context.state.entries.queryKey = JSON.stringify(filters);
      calls.push('new API query');
    },
    async loadOlderHistory() {calls.push('remaining API pages');},
    showPrimaryError(error) {throw error;}
  });
  vm.runInContext(script.match(/async function searchHistory\([^]*?\n\}/)[0], context);
  await context.searchHistory();
  assert.deepEqual(calls, ['new API query']);
  console.log('PASS: history search preserves visible parameters, removes stale session restrictions and fetches matching pages');
})().catch(error => {console.error(error); process.exitCode = 1;});

(async () => {
  let sent;
  const context = vm.createContext({
    URL, URLSearchParams, Headers, AbortController, DOMException, setTimeout, clearTimeout,
    RETRY_STATUSES: new Set(), state: {connection: {baseUrl: 'http://device.test', token: ''}},
    async fetch(url) {sent = new URL(url); return {ok: true, status: 200};},
    ApiError: class extends Error {},
    appendParam(params, name, value) {if (value !== undefined && value !== null && value !== '') params.set(name, String(value));}
  });
  for (const name of ['dateInputToUtc', 'normalizeBaseUrl', 'buildTimelineParams']) vm.runInContext(extractFunction(name), context);
  vm.runInContext(script.slice(script.indexOf('async function apiResponse('), script.indexOf('async function apiJson(')), context);
  const from = context.dateInputToUtc('2026-06-01');
  const to = context.dateInputToUtc('2026-07-31', true);
  const expectedFrom = new Date(2026, 5, 1).toISOString();
  const expectedTo = new Date(new Date(2026, 7, 1).getTime() - 1).toISOString();
  assert.equal(from, expectedFrom);
  assert.equal(to, expectedTo);
  assert.throws(() => context.dateInputToUtc('2026-02-30'));
  const params = context.buildTimelineParams({startTs: from, endTs: to, modelId: 'model/a', level: 'info'});
  await context.apiResponse('/api/v1/model-logs/timeline?' + params, {retries: 0});
  assert.equal(sent.pathname, '/api/v1/model-logs/timeline');
  assert.equal(sent.searchParams.get('start_ts'), expectedFrom);
  assert.equal(sent.searchParams.get('end_ts'), expectedTo);
  assert.equal(sent.searchParams.get('model_id'), 'model/a');
  assert.equal(sent.searchParams.get('level'), 'info');
  console.log('PASS: fetch sends date boundaries, model and level to device; inclusive end date and invalid-date checks');
})().catch(error => {console.error(error); process.exitCode = 1;});

{
  const context = vm.createContext({pad2: value => String(value).padStart(2, '0')});
  for (const name of ['entrySelectionData', 'loadedDateRange', 'modelPieData', 'pieSlicePath', 'selectPieModel']) vm.runInContext(extractFunction(name), context);
  const items = [
    {id: 1, ts: new Date(2026, 10, 7, 10).toISOString(), model_id: 'a', level: 'info'},
    {id: 2, ts: new Date(2026, 10, 7, 10).toISOString(), model_id: 'a', level: 'error'},
    {id: 3, ts: new Date(2026, 10, 7, 10).toISOString(), model_id: 'b', level: 'warning'},
    {id: 4, ts: new Date(2026, 9, 7).toISOString(), model_id: 'b', level: 'info'},
    {id: 5, ts: 'invalid', level: 'debug'}
  ];
  const distribution = context.modelPieData(items, {month: '2026-11', model: 'id:a'});
  assert.equal(distribution.total, 3);
  assert.equal(distribution.rows.length, 2); // Selected model does not erase other slices.
  assert.equal(distribution.rows[0][0], 'id:a');
  assert.equal(distribution.rows[0][1], 2);
  assert.equal(context.modelPieData(items, {month: '2026-11', level: 'warning'}).total, 3); // Run counts have no severity.
  assert.equal(context.modelPieData([], {}).total, 0);
  assert.equal(context.modelPieData([items[4]], {}).rows[0][0], 'unknown');
  assert.ok(!context.pieSlicePath(-Math.PI / 2, 2 / 3).includes('NaN'));
  context.state = {dashboard: {model: '', page: 2}};
  context.renderDashboard = () => {};
  context.renderSessions = () => {};
  context.selectPieModel('id:a');
  assert.equal(context.state.dashboard.model, 'id:a');
  assert.equal(context.state.dashboard.page, 0);
  context.selectPieModel('id:a');
  assert.equal(context.state.dashboard.model, '');
  console.log('PASS: pie totals and period/level scope, unknown models, selected-model comparison and click-to-toggle filter');
}

{
  const context = vm.createContext({pad2: value => String(value).padStart(2, '0')});
  for (const name of ['entrySelectionData', 'loadedDateRange', 'modelPieData']) vm.runInContext(extractFunction(name), context);
  const runs = [
    {session_id: 'gemma-run', model_id: 'gemma-4', created_at: new Date(2026, 10, 1).toISOString()},
    {session_id: 'minimax-run', model_id: 'minimax', created_at: new Date(2026, 10, 13).toISOString()}
  ];
  const pie = context.modelPieData(runs, {});
  assert.equal(pie.total, 2);
  assert.equal(pie.rows.length, 2);
  assert.equal(pie.rows.reduce((sum, row) => sum + row[1], 0), 2);
  assert.equal(context.modelPieData(runs, {}, {endTs: new Date(2026, 10, 2).toISOString()}).rows[0][0], 'id:gemma-4');
  console.log('PASS: recorded-run pie includes Gemma and MiniMax independently of loaded log entries');
}

(async () => {
  const context = vm.createContext({pad2: value => String(value).padStart(2, '0')});
  for (const name of ['entrySelectionData', 'dashboardSelectionData']) vm.runInContext(extractFunction(name), context);
  const runs = [{model_id: 'gemma', created_at: new Date(2026, 9, 1).toISOString()}, {model_id: 'minimax', created_at: new Date(2026, 10, 1).toISOString()}];
  const groups = context.dashboardSelectionData([], runs, {});
  assert.equal(groups.months.size, 2);
  assert.equal(groups.models.size, 2);
  assert.equal(groups.matching.length, 0);
  let queries = 0;
  Object.assign(context, {
    state: {mode: 'sessions', historyRun: {}, sessions: {selectedId: 'gemma-run'}, connection: {connected: true}, dashboard: {model: 'id:gemma', page: 2}, filters: {modelId: 'gemma'}},
    els: {modelFilter: {value: 'gemma'}},
    stopLive() {}, clearFilters() {}, renderSessions() {}, renderDashboard() {},
    setMode(mode) {context.state.mode = mode;},
    restoreDefaultEntries() {return true;}, readFilters() {return {};},
    async startEntryQuery() {queries++;}
  });
  vm.runInContext(script.match(/async function showAllSessions\([^]*?\n\}/)[0] + '\n' + script.match(/async function showAllModels\([^]*?\n\}/)[0], context);
  await context.showAllSessions();
  assert.equal(queries, 0);
  context.state.sessions.selectedId = 'gemma-run';
  context.state.mode = 'sessions';
  await context.showAllModels();
  assert.equal(context.state.sessions.selectedId, null);
  assert.equal(context.state.dashboard.model, '');
  assert.equal(context.els.modelFilter.value, '');
  assert.equal(context.state.historyRun, null);
  assert.equal(queries, 0);
  console.log('PASS: selectors populate from sessions without logs; All sessions/All models reuse the default page without fetching');
})().catch(error => {console.error(error); process.exitCode = 1;});

(async () => {
  const order = [], pages = [];
  const context = vm.createContext({URLSearchParams,
    buildEntryParams(filters, cursor) {const params = new URLSearchParams(); if (cursor) params.set('cursor', cursor); return params;},
    async apiJson(path) {
      order.push(path.includes('/gemma-run/') ? 'gemma' : 'minimax');
      const more = path.includes('/minimax-run/') && !path.includes('cursor=');
      return {items: [{id: pages.length + 1, model_id: path.includes('/gemma-run/') ? 'google/gemma-4' : 'minimax'}], next_cursor: more ? 'second' : null};
    }
  });
  vm.runInContext(script.match(/async function fetchRecordedRunEntries\([^]*?\n\}/)[0], context);
  const complete = await context.fetchRecordedRunEntries([{session_id: 'minimax-run'}, {session_id: 'gemma-run'}], {}, new AbortController().signal, items => {pages.push(...items);});
  assert.equal(complete, true);
  assert.deepEqual(order, ['minimax', 'gemma', 'minimax']);
  assert.ok(pages.some(item => item.model_id === 'google/gemma-4'));
  assert.equal(pages.length, 3);
  const stopped = await context.fetchRecordedRunEntries([{session_id: 'gemma-run'}], {}, new AbortController().signal, () => false);
  assert.equal(stopped, false);
  const abort = new AbortController(); abort.abort(new Error('cancelled'));
  await assert.rejects(() => context.fetchRecordedRunEntries([{session_id: 'gemma-run'}], {}, abort.signal, () => {}), /cancelled/);
  console.log('PASS: default entries fetch every recorded run, include Gemma, page fairly, and stop on cap/cancellation');
})().catch(error => {console.error(error); process.exitCode = 1;});

{
 const context = vm.createContext({pad2: value => String(value).padStart(2, '0')});
 for (const name of ['entrySelectionData', 'levelPieData', 'selectPieLevel']) vm.runInContext(extractFunction(name), context);
 const rows = [{model_id:'a',level:'info'}, {model_id:'a',level:'ERROR'}, {model_id:'b',level:'info'}, {model_id:'a'}];
 const data = context.levelPieData(rows, {model:'id:a',level:'error'});
 assert.equal(data.total,3);
 assert.equal(data.rows.length,3);
 assert.equal(data.rows.reduce((sum,row)=>sum+row[1],0),3);
 context.state = {dashboard:{level:'',page:2}}; context.renderDashboard=()=>{};
 context.selectPieLevel('info'); assert.equal(context.state.dashboard.level,'info');
 context.selectPieLevel('info'); assert.equal(context.state.dashboard.level,'');
 assert.equal(context.state.dashboard.page,0);
 console.log('PASS: level pie scopes by model, preserves comparison levels, and toggles filtering');
}

{
 const loading = vm.runInNewContext('(' + extractFunction('dataLoadingText') + ')');
 const current = {sessions:{loading:true}, entries:{loading:false,items:[]},historyRun:null};
 assert.match(loading(current), /Loading recorded sessions/);
 current.sessions.loading=false; current.entries.loading=true;
 current.entries.items=[{id:1}];
 assert.match(loading(current), /1 entries loaded/);
 current.historyRun={}; assert.match(loading(current), /Loading older history/);
 current.historyRun=null; current.entries.loading=false;
 assert.equal(loading(current),'');
 console.log('PASS: loading indicator covers sessions, entries, history and idle states');
}
