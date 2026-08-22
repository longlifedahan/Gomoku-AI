/*
 * 低搜索时间不上榜测试（2026-08-18 用户）：搜索时间低于设备默认值（Node=电脑默认 3.5s）时，
 * 执黑胜 → 不记本地榜、不上报全局榜，结算提示告知"搜索时间低于默认值"。
 * 用法：node js/submit_lowtime_test.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

function makeEl() {
  var el = {
    textContent: '', innerHTML: '', value: '', checked: false, hidden: true,
    disabled: false, style: {}, _listeners: {},
    classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
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
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function(){ return makeEl(); }, querySelectorAll: function(){ return []; },
  createElement: function(){ return makeEl(); },
  head: { appendChild: function(){} }, body: { appendChild: function(){} }
};
var submitted = [];
global.window = {
  addEventListener: function(){}, devicePixelRatio: 1,
  toy: {
    getRankList: function(){ return Promise.resolve([]); },
    getMyRank: function(){ return Promise.resolve({}); },
    submitScore: function (o) { submitted.push(o); return Promise.resolve(); }
  }
};
global.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};
global.requestAnimationFrame = function (fn) { if (fn) fn(); };
global.performance = { now: function () { return Date.now(); } };

var aiMoves = 0;
global.setTimeout = function (fn) {
  if (aiMoves < 8) { aiMoves++; fn(); }
};
var k = 0;
var mockAI = {
  getMove: function (board, N, color) { k++; return [14, k]; }
};

var fails = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); fails++; } else console.log('PASS: ' + msg); }

// 玩家执黑，但搜索时间 2s 低于电脑默认 3.5s
global.localStorage.setItem('gomoku.settings', JSON.stringify({ first: 'black', searchTime: 2, sound: false, version: 4 }));
global.localStorage.removeItem('gomoku.leaderboard');

var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, mockAI);

document.getElementById('btn-start').onclick();
var cell = 288 / 17;
function tap(x, y) {
  els['board']._listeners['pointerdown']({ clientX: x * cell + cell / 2, clientY: y * cell + cell / 2, preventDefault: function(){} });
}
tap(8, 8); tap(8, 9); tap(8, 10); tap(8, 11); tap(8, 12);   // 黑五连

setTimeout(function () {
  var lbRaw = localStorage.getItem('gomoku.leaderboard');
  var lb = lbRaw ? JSON.parse(lbRaw) : null;
  assert(!lb || lb.blackWins === 0, '搜索时间低于默认(2s<3.5s) → 黑胜不记榜 blackWins=0');
  var hasBlack = submitted.some(function (o) { return o.board === 1; });
  assert(!hasBlack, '搜索时间低于默认 → 榜1 不上报');
  assert(els['overlay-sub'].textContent.indexOf('搜索时间低于默认值') >= 0, '结算提示告知"搜索时间低于默认值"');

  if (fails) { console.error('--- 低搜索时间测试失败 ' + fails + ' 项 ---'); process.exit(1); }
  console.log('--- 低搜索时间测试全部通过 ---');
  process.exit(0);
}, 200);
