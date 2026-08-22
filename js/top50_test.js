/*
 * TOP50 弹窗测试：一级黑/白 × 二级最快时间/最少手数 切换。
 * 用法：node js/top50_test.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

function makeEl() {
  var el = {
    textContent: '', innerHTML: '', value: '', checked: false, hidden: true,
    disabled: false, style: {}, _listeners: {},
    classList: { _c: {}, add: function (c) { this._c[c] = 1; }, remove: function (c) { delete this._c[c]; },
      toggle: function (c, v) { if (v) this._c[c] = 1; else delete this._c[c]; },
      contains: function (c) { return !!this._c[c]; } },
    addEventListener: function (e, f) { this._listeners[e] = f; },
    appendChild: function(){}, setAttribute: function(){}, getAttribute: function(){ return null; },
    querySelector: function(){ return makeEl(); }, querySelectorAll: function(){ return []; },
    getBoundingClientRect: function(){ return { left: 0, top: 0, width: 300, height: 300 }; },
    clientWidth: 300, clientHeight: 300,
    getContext: function(){ return ctx2d; }, width: 0, height: 0
  };
  return el;
}
var ctx2d = { setTransform: function(){}, clearRect: function(){}, fillRect: function(){}, beginPath: function(){},
  moveTo: function(){}, lineTo: function(){}, stroke: function(){}, fill: function(){}, arc: function(){}, fillText: function(){},
  createRadialGradient: function(){ return { addColorStop: function(){} }; },
  fillStyle:'', strokeStyle:'', lineWidth:1, font:'', textAlign:'', textBaseline:'' };
var els = {};
function makeTab(attr, val) {
  var el = makeEl();
  el.getAttribute = function (a) { return a === attr ? val : null; };
  return el;
}
var colorTabs = null, metricTabs = null, boardTabs = null, periodTabs = null;
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function(){ return makeEl(); },
  querySelectorAll: function (sel) {
    if (sel.indexOf('top-color-tabs') >= 0) { if (!colorTabs) colorTabs = [makeTab('data-color','black'), makeTab('data-color','white')]; return colorTabs; }
    if (sel.indexOf('top-metric-tabs') >= 0) { if (!metricTabs) metricTabs = [makeTab('data-metric','time'), makeTab('data-metric','moves')]; return metricTabs; }
    if (sel.indexOf('lb-period-tabs') >= 0) { if (!periodTabs) periodTabs = []; return periodTabs; }
    if (sel.indexOf('#lb-tabs') >= 0) { if (!boardTabs) boardTabs = []; return boardTabs; }
    return [];
  },
  createElement: function(){ return makeEl(); },
  head: { appendChild: function(){} }, body: { appendChild: function(){} }
};
global.window = {
  addEventListener: function(){}, devicePixelRatio: 1,
  toy: { getRankList: function(){ return Promise.resolve([]); }, getMyRank: function(){ return Promise.resolve({}); }, submitScore: function(){ return Promise.resolve(); } }
};
global.localStorage = {
  _d: {}, getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); }, removeItem: function (k) { delete this._d[k]; }
};
global.requestAnimationFrame = function (fn) { if (fn) fn(); };
global.performance = { now: function () { return Date.now(); } };

var fails = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); fails++; } else console.log('PASS: ' + msg); }

// 预置本地战绩（version 4：黑/白 × 时间/手数）
global.localStorage.setItem('gomoku.leaderboard', JSON.stringify({
  version: 4, blackWins: 5, wins100: 3, bestMoves: 12, games: 20, wins: 8,
  blackFastestList: [{ ms: 30000, ts: 1 }, { ms: 45000, ts: 2 }],
  blackMovesList: [{ moves: 15, ts: 1 }, { moves: 20, ts: 2 }],
  whiteFastestList: [{ ms: 25000, ts: 1 }],
  whiteMovesList: [{ moves: 12, ts: 1 }]
}));

var aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf-8');
var GomokuAI = new Function('window', aiSrc + '\n;return window.GomokuAI;')(global.window);
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, GomokuAI);

// 打开 TOP50 弹窗（默认黑棋/最快时间）
document.getElementById('btn-top10').onclick();
setTimeout(function () {
  var list = document.getElementById('top-list').innerHTML;
  assert(list.indexOf('0:30') >= 0, '默认黑棋/最快时间：显示 00:30');
  assert(list.indexOf('15 手') < 0, '默认最快时间：不含手数数据');
  // 点击白棋 tab
  colorTabs[1]._listeners['click'].call(colorTabs[1]);
  var listW = document.getElementById('top-list').innerHTML;
  assert(listW.indexOf('0:25') >= 0, '白棋/最快时间：显示 00:25');
  // 点击最少手数 tab
  metricTabs[1]._listeners['click'].call(metricTabs[1]);
  var listM = document.getElementById('top-list').innerHTML;
  assert(listM.indexOf('12 手') >= 0, '白棋/最少手数：显示 12 手');
  // 切回黑棋
  colorTabs[0]._listeners['click'].call(colorTabs[0]);
  var listBM = document.getElementById('top-list').innerHTML;
  assert(listBM.indexOf('15 手') >= 0, '黑棋/最少手数：显示 15 手');

  if (fails) { console.error('--- TOP50 测试失败 ' + fails + ' 项 ---'); process.exit(1); }
  console.log('--- TOP50 测试全部通过 ---');
  process.exit(0);
}, 100);
