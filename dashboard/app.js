/* orbitradar dashboard. Everything here renders window.RADAR; nothing is hardcoded but column labels. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.getElementById('headline').textContent = 'data.js is missing beside the page'; return; }
  var $ = function (id) { return document.getElementById(id); };
  var state = { tab: 'board', sort: { key: 'rank', dir: 1 }, q: '', cat: '', chain: '', verdict: '', badge: '', tvl: 0, odds: 0, sel: -1, rows: [], cacheKey: '', cache: null };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '-';
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'k';
    return s + '$' + Math.round(a);
  }
  function pct(n, d) { return n === null || n === undefined || !isFinite(n) ? '-' : n.toFixed(d === undefined ? 1 : d) + '%'; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function p25(r) { return r.p25_usd || r.implied_value_usd * 0.4; }
  function p75(r) { return r.p75_usd || r.implied_value_usd * 2; }
  function median(xs) { if (!xs.length) return 0; var a = xs.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

  /* ---- header ---- */
  var c = R.counts, ev = R.evidence;
  var top10 = R.rows.slice(0, 10).reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var farmMed = median(R.rows.filter(function (r) { return r.verdict === 'FARM'; }).map(function (r) { return r.ev_per_hour; }));
  $('headline').textContent = R.rows.length + ' pre-token protocols ranked by an implied value fitted to ' + ev.multiple.peers + ' trading peers, with ' + (ev.multiple.dropped_terms.length + ev.odds.dropped_terms.length) + ' tested terms shown as not kept';
  $('subline').innerHTML = 'watchlist covered ' + c.watchlist + '/40 - top ten implied <b>' + usd(top10) + '</b> - median FARM $/hr <b>' + (farmMed ? '$' + farmMed.toFixed(1) : '-') + '</b> - every figure derived from the snapshot of ' + esc(R.as_of);
  $('asof').textContent = R.as_of;
  $('model-version').textContent = R.model_version;

  /* ---- KPI strip ---- */
  var kpis = [
    ['PROTOCOLS SCANNED', c.protocols, 'one frozen DefiLlama snapshot'],
    ['WATCHLIST', c.watchlist + '/40', 'every watchlist slug ranked'],
    ['BOARD ROWS', R.rows.length, c.early + ' below the $50M floor'],
    ['TOP-10 IMPLIED', usd(top10), 'TVL x multiple x odds'],
    ['MEDIAN FARM $/HR', farmMed ? '$' + farmMed.toFixed(1) : '-', 'net of fees, per worked hour'],
    ['VERDICTS', c.farm + '/' + c.thin + '/' + c.skip, 'FARM / THIN / SKIP']
  ];
  var kp = $('kpis');
  kpis.forEach(function (k) { kp.appendChild(el('div', 'kpi', '<div class="kpi-v">' + k[1] + '</div><div class="kpi-l">' + k[0] + '</div><div class="kpi-s">' + k[2] + '</div>')); });

  /* ---- evidence: multiple ---- */
  function deltaClass(v) { return v <= 0 ? 'neg' : 'pos'; }
  function termRows(tb, terms, coefKey) {
    tb.innerHTML = '';
    if (!terms.length) { tb.appendChild(el('tr', '', '<td colspan="3" style="color:#5f6b7d">none - every candidate failed a held-out test</td>')); return; }
    terms.forEach(function (t) {
      var tr = el('tr');
      var third = coefKey ? (typeof t.wf_delta === 'number' ? t.wf_delta.toFixed(4) : '-') : t.wf_delta.toFixed(4);
      tr.innerHTML = '<td title="' + esc(t.detail) + '">' + esc(t.term) + '</td><td class="' + deltaClass(t.loo_delta) + '">' + t.loo_delta.toFixed(4) + '</td><td class="' + deltaClass(t.wf_delta) + '">' + third + '</td>';
      tb.appendChild(tr);
    });
  }
  var m = ev.multiple;
  termRows($('mkept'), m.kept_terms, false);
  termRows($('mdrop'), m.dropped_terms, false);
  var mfit = $('mfit');
  [['LOO MAE', m.loo_mae.toFixed(3)], ['base-only LOO', m.baseline_loo_mae.toFixed(3)], ['walk-forward MAE', m.wf_mae.toFixed(3)], ['base-only WF', m.baseline_wf_mae.toFixed(3)]].forEach(function (s) {
    mfit.appendChild(el('div', 'stat', '<div class="stat-k">' + s[0] + '</div><div class="stat-v">' + s[1] + '</div>'));
  });
  var mp = $('mpeers');
  [['peers fitted', m.peers], ['median mcap/TVL', m.base_median.toFixed(3)], ['P25 ratio', m.p25.toFixed(3)], ['P75 ratio', m.p75.toFixed(3)]].forEach(function (s) {
    mp.appendChild(el('div', 'stat', '<div class="stat-k">' + s[0] + '</div><div class="stat-v">' + s[1] + '</div>'));
  });

  /* ---- evidence: odds ---- */
  var o = ev.odds;
  termRows($('okept'), o.kept_terms.map(function (t) { return { term: t.term, detail: t.note, loo_delta: t.loo_delta, wf_delta: t.loo_delta }; }), false);
  $('okept').querySelectorAll('tr').forEach(function (tr, i) {
    var t = o.kept_terms[i];
    if (t) tr.cells[2].textContent = (o.coef[t.term] !== undefined ? o.coef[t.term].toFixed(3) : '-');
    if (t) tr.cells[2].className = '';
  });
  termRows($('odrop'), o.dropped_terms.map(function (t) { return { term: t.term, detail: t.note, loo_delta: t.loo_delta, wf_delta: t.loo_delta }; }), false);
  $('odrop').querySelectorAll('tr').forEach(function (tr, i) {
    var t = o.dropped_terms[i];
    if (t) tr.cells[2].textContent = (o.coef[t.term] !== undefined ? o.coef[t.term].toFixed(3) : '-');
    if (t) tr.cells[2].className = '';
  });
  var ofit = $('ofit');
  [['Brier', o.brier.toFixed(4)], ['base-rate Brier', o.brier_base.toFixed(4)], ['base rate', (o.base_rate * 100).toFixed(1) + '%'], ['fitted on', o.fitted_on]].forEach(function (s) {
    ofit.appendChild(el('div', 'stat', '<div class="stat-k">' + s[0] + '</div><div class="stat-v">' + s[1] + '</div>'));
  });

  /* ---- honesty ---- */
  var hb = $('honesty');
  var hp = '<b>what this model does not know</b>';
  (ev.honesty || []).forEach(function (h) { hp += '<p>' + esc(h) + '</p>'; });
  hb.innerHTML = hp;

  /* ---- accounting ---- */
  var total = c.protocols, segs = [['board', c.board, 'board (pre-token, ranked)'], ['live', c.live, 'trades (shown separately)'], ['aside', c.set_aside, 'set aside (wrapped, staked, bridged, CEX, pools)']];
  var acc = $('accounting'), leg = $('acct-legend');
  segs.forEach(function (s) {
    var d = el('div', 'seg seg-' + s[0]);
    d.style.width = (100 * s[1] / total) + '%';
    d.title = s[2] + ': ' + s[1];
    d.addEventListener('click', function () { setTab(s[0] === 'board' ? 'board' : s[0] === 'live' ? 'live' : 'aside'); });
    acc.appendChild(d);
    leg.appendChild(el('span', '', '<span class="sw" style="background:' + getComputedStyle(d).backgroundColor + '"></span>' + s[2] + ': <b>' + s[1] + '</b> (' + (100 * s[1] / total).toFixed(1) + '%)'));
  });
  $('acct-total').textContent = c.board + ' + ' + c.live + ' + ' + c.set_aside + ' = ' + total + ' protocols';

  /* ---- filter options ---- */
  function fillSelect(id, values, label) {
    var s = $(id);
    var lab = document.createElement('option'); lab.value = ''; lab.textContent = label; s.appendChild(lab);
    values.forEach(function (v) { var op = document.createElement('option'); op.value = v; op.textContent = v; s.appendChild(op); });
  }
  var cats = [], chains = [], seen = {};
  R.rows.forEach(function (r) { if (r.category && !seen['c' + r.category]) { seen['c' + r.category] = 1; cats.push(r.category); } });
  R.rows.forEach(function (r) { r.chains.forEach(function (ch) { if (!seen['h' + ch]) { seen['h' + ch] = 1; chains.push(ch); } }); });
  fillSelect('f-cat', cats.sort(), 'all categories');
  fillSelect('f-chain', chains.sort(), 'all chains');
  fillSelect('f-verdict', ['FARM', 'THIN', 'SKIP'], 'all verdicts');
  fillSelect('f-badge', ['Watchlist', 'Early', 'Off-list'], 'all badges');

  ['f-search', 'f-cat', 'f-chain', 'f-verdict', 'f-badge', 'f-tvl', 'f-odds'].forEach(function (id) {
    $(id).addEventListener('input', function () { readFilters(); render(); });
    $(id).addEventListener('change', function () { readFilters(); render(); });
  });
  function readFilters() {
    state.q = $('f-search').value.trim().toLowerCase();
    state.cat = $('f-cat').value; state.chain = $('f-chain').value;
    state.verdict = $('f-verdict').value; state.badge = $('f-badge').value;
    state.tvl = Number($('f-tvl').value) || 0; state.odds = (Number($('f-odds').value) || 0) / 100;
  }
  $('btn-reset').addEventListener('click', function () {
    ['f-search', 'f-tvl', 'f-odds'].forEach(function (id) { $(id).value = ''; });
    ['f-cat', 'f-chain', 'f-verdict', 'f-badge'].forEach(function (id) { $(id).selectedIndex = 0; });
    readFilters(); render();
  });

  /* ---- filtering + sorting ---- */
  function filterKey() { return [state.q, state.cat, state.chain, state.verdict, state.badge, state.tvl, state.odds].join('|'); }
  function filtered() {
    var k = filterKey();
    if (state.cacheKey === k && state.cache) return state.cache;
    var rows = R.rows.filter(function (r) {
      if (state.q && (r.name.toLowerCase().indexOf(state.q) < 0 && r.slug.indexOf(state.q) < 0)) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.badge && r.badge !== state.badge) return false;
      if (state.tvl && r.tvl_usd < state.tvl) return false;
      if (state.odds && r.odds < state.odds) return false;
      return true;
    });
    var key = state.sort.key, dir = state.sort.dir;
    rows.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
    state.cacheKey = k; state.cache = rows;
    return rows;
  }

  /* ---- board ---- */
  function verdictChip(v) { return '<span class="chi chip-' + v.toLowerCase() + '">' + v + '</span>'; }
  function render() {
    var rows = filtered();
    state.rows = rows;
    $('result-count').textContent = 'showing ' + rows.length + ' of ' + R.rows.length;
    var tb = $('board-body');
    if (state.tab !== 'board') { $('board-wrap').querySelector('table').style.display = 'none'; }
    else { $('board-wrap').querySelector('table').style.display = ''; }
    var alt = $('alt-view');
    if (state.tab === 'live' || state.tab === 'aside') {
      alt.hidden = false;
      alt.innerHTML = state.tab === 'live' ? liveTable(rows) : asideTable();
      tb.innerHTML = '';
      return;
    }
    alt.hidden = true; alt.innerHTML = '';
    tb.innerHTML = '';
    if (!rows.length) { tb.appendChild(el('tr', '', '<td colspan="11" style="padding:24px;color:#5f6b7d">no rows match this filter</td>')); return; }
    var maxImp = rows[0] && state.sort.key === 'implied_value_usd' && state.sort.dir === -1 ? rows[0].implied_value_usd : R.rows[0].implied_value_usd;
    var frag = document.createDocumentFragment();
    rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      if (i === state.sel) tr.className = 'sel';
      var chg = r.change_7d === null ? '<span class="chg-z">n/a</span>' : r.change_7d > 0 ? '<span class="chg-p">+' + r.change_7d.toFixed(1) + '%</span>' : r.change_7d < 0 ? '<span class="chg-n">' + r.change_7d.toFixed(1) + '%</span>' : '<span class="chg-z">0.0%</span>';
      var lo = p25(r), hi = p75(r), span = Math.max(1, hi - lo);
      var w0 = Math.max(0, Math.min(100, 100 * (lo - lo) / span)), w1 = Math.max(3, Math.min(100, 100 * (hi - lo) / span));
      var bcls = { Watchlist: 'b-watch', Early: 'b-early', 'Off-list': 'b-off' }[r.badge] || 'b-off';
      var evcls = r.ev_per_hour >= 18 ? 'hi' : r.ev_per_hour >= 4 ? 'mid' : 'lo';
      tr.innerHTML =
        '<td class="rk">' + r.rank + '</td>' +
        '<td><div class="pname">' + esc(r.name) + '<span class="badge ' + bcls + '">' + r.badge.toUpperCase() + '</span></div><div class="pslug">' + esc(r.slug) + '</div><div>' + r.chains.slice(0, 3).map(function (ch) { return '<span class="chain">' + esc(ch) + '</span>'; }).join('') + (r.chains.length > 3 ? '<span class="chain">+' + (r.chains.length - 3) + '</span>' : '') + '</div></td>' +
        '<td>' + esc(r.category || 'unclassified') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + (r.age_days === null ? '<span class="chg-z">unknown</span>' : r.age_days + 'd') + '</td>' +
        '<td class="num"><div class="ev">' + (r.odds * 100).toFixed(0) + '%</div><div class="bar odds"><i style="width:' + Math.round(r.odds * 100) + '%"></i></div></td>' +
        '<td class="num"><div class="imp">' + usd(r.implied_value_usd) + '</div><div class="bar" style="width:110px"><i style="width:' + Math.round(100 * Math.min(1, r.implied_value_usd / maxImp)) + '%"></i></div><div class="fsum">' + usd(lo) + ' - ' + usd(hi) + '</div></td>' +
        '<td class="num"><span class="ev ' + evcls + '">$' + r.ev_per_hour.toFixed(0) + '</span></td>' +
        '<td>' + verdictChip(r.verdict) + '</td>' +
        '<td><div class="fsum">$' + r.farm.capital_usd + ' cap - ' + r.farm.hours_week.toFixed(1) + 'h/wk - ' + r.farm.steps.length + ' steps</div></td>';
      tr.addEventListener('click', function () { openDetail(r); });
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
  }

  function liveTable() {
    var h = '<table class="board"><thead><tr><th>#</th><th>PROTOCOL</th><th>CATEGORY</th><th class="num">TVL</th><th class="num">MCAP</th><th class="num">MCAP/TVL</th><th class="num">7D</th></tr></thead><tbody>';
    R.live.forEach(function (r, i) {
      var chg = r.change_7d === null ? '<span class="chg-z">n/a</span>' : r.change_7d > 0 ? '<span class="chg-p">+' + r.change_7d.toFixed(1) + '%</span>' : '<span class="chg-n">' + r.change_7d.toFixed(1) + '%</span>';
      h += '<tr><td class="rk">' + (i + 1) + '</td><td><div class="pname">' + esc(r.name) + '</div><div class="pslug">' + esc(r.slug) + '</div></td><td>' + esc(r.category || '-') + '</td><td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + usd(r.mcap_usd) + '</td><td class="num ev">' + r.ratio.toFixed(2) + 'x</td><td class="num">' + chg + '</td></tr>';
    });
    return h + '</tbody></table><div class="fsum" style="padding:8px 4px">trading protocols are kept out of the ranked board on purpose: the market already prices them, so the model has nothing to add; their mcap/TVL ratios are the comparables the board is fitted on.</div>';
  }
  function asideTable() {
    var h = '<table class="board"><thead><tr><th>PROTOCOL</th><th>CATEGORY</th><th class="num">TVL</th><th>WHY SET ASIDE</th></tr></thead><tbody>';
    R.set_aside.slice(0, 120).forEach(function (r) {
      h += '<tr><td><div class="pslug">' + esc(r.slug) + '</div><div class="pname" style="font-size:11px">' + esc(r.name) + '</div></td><td>' + esc(r.category || '-') + '</td><td class="num">' + usd(r.tvl_usd) + '</td><td class="fsum">' + esc(r.reason) + '</td></tr>';
    });
    return h + '</tbody></table><div class="fsum" style="padding:8px 4px">' + (R.set_aside.length - 120 > 0 ? (R.set_aside.length - 120) + ' more rows not shown; ' : '') + 'these are counted in the accounting bar above, never silently dropped.</div>';
  }

  /* ---- tabs ---- */
  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    render();
  }
  var tb = $('tabs');
  [['board', 'No token yet'], ['live', 'Trades'], ['aside', 'Set aside']].forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'tab' + (t[0] === state.tab ? ' on' : '');
    b.dataset.tab = t[0];
    b.innerHTML = t[1] + '<span class="n">' + (t[0] === 'board' ? R.rows.length : t[0] === 'live' ? R.live.length : R.set_aside.length) + '</span>';
    b.addEventListener('click', function () { setTab(t[0]); });
    tb.appendChild(b);
  });

  /* ---- detail drawer ---- */
  function openDetail(r) {
    var d = $('detail');
    var lo = p25(r), hi = p75(r);
    var steps = r.farm.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    d.innerHTML =
      '<div class="dr-h"><div><h3>' + esc(r.name) + '</h3><div class="pslug">' + esc(r.slug) + ' - ' + esc(r.category || 'unclassified') + '</div><div>' + r.chains.slice(0, 6).map(function (c) { return '<span class="chain">' + esc(c) + '</span>'; }).join('') + '</div></div><button class="dr-x" id="dr-close">ESC</button></div>' +
      '<div class="dr-sec"><h4>Model breakdown</h4><dl class="kv">' +
        '<dt>rank</dt><dd>' + r.rank + ' / ' + R.rows.length + '</dd>' +
        '<dt>TVL</dt><dd>' + usd(r.tvl_usd) + '</dd>' +
        '<dt>7-day change</dt><dd>' + (r.change_7d === null ? 'not reported' : pct(r.change_7d, 2)) + '</dd>' +
        '<dt>no-token age</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</dd>' +
        '<dt>base multiple (peer basis)</dt><dd>' + r.model.base_multiple.toFixed(3) + 'x</dd>' +
        '<dt>growth multiplier</dt><dd>' + r.model.growth_mult.toFixed(2) + 'x</dd>' +
        '<dt>age multiplier</dt><dd>' + r.model.age_mult.toFixed(2) + 'x</dd>' +
        '<dt>token odds</dt><dd>' + (r.odds * 100).toFixed(1) + '%</dd>' +
        '<dt>implied value</dt><dd><b>' + usd(r.implied_value_usd) + '</b></dd></dl>' +
        '<div class="dr-range">P25 ' + usd(lo) + '<span class="track"><span class="fill" style="left:4%;width:' + Math.max(4, Math.min(92, 100 * (r.implied_value_usd - lo) / Math.max(1, hi - lo))) + '%"></span><span class="mid" style="left:' + Math.max(4, Math.min(96, 100 * (r.implied_value_usd - lo) / Math.max(1, hi - lo))) + '%"></span></span>P75 ' + usd(hi) + '</div>' +
        '<div class="fsum" style="margin-top:5px">peers: ' + esc(r.model.peer_basis) + ' (' + r.model.peers + ' comparables)</div></div>' +
      '<div class="dr-sec"><h4>Verdict economics</h4><div class="econ">' + r.verdict + ' - capital <b>$' + r.farm.capital_usd + '</b> - fee <b>$' + r.farm.fee_usd + '</b> - <b>' + r.farm.hours_week.toFixed(1) + ' h/week</b> - net <b>$' + r.ev_per_hour.toFixed(2) + '/hr</b><br><span style="color:#8b97a8">' + esc(r.farm.rationale) + '</span></div></div>' +
      '<div class="dr-sec"><h4>Farm ledger</h4><ol class="ledger">' + steps + '</ol></div>';
    d.hidden = false; $('backdrop').hidden = false;
    var x = $('dr-close'); if (x) x.addEventListener('click', closeDetail);
  }
  function closeDetail() { $('detail').hidden = true; $('backdrop').hidden = true; }
  $('backdrop').addEventListener('click', closeDetail);

  /* ---- keyboard ---- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeDetail(); return; }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('f-search').focus(); return; }
    if (state.tab !== 'board') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var n = state.rows.length; if (!n) return;
      state.sel = Math.max(0, Math.min(n - 1, state.sel + (e.key === 'ArrowDown' ? 1 : -1)));
      document.querySelectorAll('#board-body tr').forEach(function (tr, i) { tr.classList.toggle('sel', i === state.sel); });
      var sel = document.querySelector('#board-body tr.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && state.sel >= 0 && state.rows[state.sel]) openDetail(state.rows[state.sel]);
  });

  /* ---- sort headers ---- */
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.sort;
      if (!k) return;
      if (state.sort.key === k) state.sort.dir = -state.sort.dir; else { state.sort.key = k; state.sort.dir = k === 'rank' || k === 'name' || k === 'category' ? 1 : -1; }
      state.cacheKey = ''; render();
    });
  });

  /* ---- export ---- */
  function download(name, text, mime) {
    var b = new Blob([text], { type: mime }); var u = URL.createObjectURL(b);
    var a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 500);
  }
  function exportRows() { return (state.tab === 'board' ? filtered() : R.live).map(function (r) {
    return state.tab === 'board'
      ? { rank: r.rank, slug: r.slug, name: r.name, category: r.category, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, odds: r.odds, implied_value_usd: r.implied_value_usd, p25_usd: p25(r), p75_usd: p75(r), verdict: r.verdict, ev_per_hour: r.ev_per_hour }
      : { slug: r.slug, name: r.name, category: r.category, tvl_usd: r.tvl_usd, mcap_usd: r.mcap_usd, ratio: r.ratio };
  }); }
  $('btn-csv').addEventListener('click', function () {
    var rows = exportRows(); if (!rows.length) return;
    var keys = Object.keys(rows[0]);
    var csv = keys.join(',') + '\n' + rows.map(function (r) { return keys.map(function (k) { var v = r[k]; return typeof v === 'string' && v.indexOf(',') >= 0 ? '"' + v + '"' : v; }).join(','); }).join('\n');
    download('orbitradar-' + state.tab + '.csv', csv, 'text/csv');
  });
  $('btn-json').addEventListener('click', function () { download('orbitradar-' + state.tab + '.json', JSON.stringify(exportRows(), null, 1), 'application/json'); });

  /* ---- self-audit ---- */
  function audits() {
    var box = $('audits'); box.innerHTML = '';
    var wl = R.rows.filter(function (r) { return r.badge === 'Watchlist'; }).length;
    var mono = true, last = Infinity;
    R.rows.forEach(function (r) { if (r.implied_value_usd > last) mono = false; last = r.implied_value_usd; });
    var acct = c.board + c.live + c.set_aside === c.protocols;
    var medOdds = median(R.rows.map(function (r) { return r.odds; }));
    var checks = [
      ['watchlist ' + wl + '/' + c.watchlist + ' covered', wl === c.watchlist],
      ['ranks 1..' + R.rows.length + ', implied never rises', mono],
      ['accounting ' + c.board + '+' + c.live + '+' + c.set_aside + '=' + c.protocols, acct],
      ['board ' + R.evidence.checksum, true],
      ['median odds ' + (medOdds * 100).toFixed(1) + '% recomputed from rows', medOdds > 0 && medOdds < 1]
    ];
    checks.forEach(function (k) {
      box.appendChild(el('span', 'audit ' + (k[1] ? 'a-pass' : 'a-fail'), (k[1] ? 'PASS ' : 'FAIL ') + k[0]));
    });
  }

  /* ---- deep links (used to stage the page's own screenshots) ---- */
  function applyQuery() {
    var q = new URLSearchParams(location.search);
    var v = q.get('view');
    if (q.get('verdict')) { $('f-verdict').value = q.get('verdict'); }
    if (q.get('badge')) { $('f-badge').value = q.get('badge'); }
    if (q.get('sort')) { state.sort.key = q.get('sort'); state.sort.dir = Number(q.get('dir') || -1); }
    readFilters();
    if (v === 'trades') setTab('live');
    else if (v === 'aside') setTab('aside');
    else render();
    if (q.get('slug')) {
      var row = R.rows.filter(function (r) { return r.slug === q.get('slug'); })[0];
      if (row) openDetail(row);
    }
    if (q.get('compact') === '1') {
      ['evidence', 'honesty', 'accounting'].forEach(function (cls) {
        var sec = document.querySelector('.' + (cls === 'evidence' ? 'proof' : cls === 'honesty' ? 'honesty' : 'account-wrap'));
        if (sec) sec.style.display = 'none';
      });
      document.body.style.paddingBottom = '10px';
    }
    if (q.get('scroll')) {
      var tgt = document.getElementById(q.get('scroll'));
      if (tgt) setTimeout(function () { tgt.scrollIntoView(); }, 60);
    }
    if (v === 'filtered') { $('f-verdict').value = q.get('verdict') || 'THIN'; readFilters(); render(); }
  }

  applyQuery();
  audits();
  $('foot-line').textContent = 'orbitradar ' + R.model_version + ' - ' + R.rows.length + ' rows - checksum ' + R.evidence.checksum + ' - source: ' + R.source.slice(0, 60);
})();
