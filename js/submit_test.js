/*
 * 上榜逻辑测试：执黑胜 → 榜1 上报 100w+黑胜次数；执白胜 → 榜2/3 上报。
 * 用法：node js/submit_test.js
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

// mock setTimeout 立即执行（AI 落子），但限制次数避免递归
var aiMoves = 0;
global.setTimeout = function (fn) {
  if (aiMoves < 8) { aiMoves++; fn(); }
};
// mock AI：执白（玩家执黑时 AI 白），返回递增远点 (14, k)，不干扰黑五连
var k = 0;
var mockAI = {
  getMove: function (board, N, color) { k++; return [14, k]; }
};

var fails = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); fails++; } else console.log('PASS: ' + msg); }

// 玩家执黑
global.localStorage.setItem('gomoku.settings', JSON.stringify({ first: 'black', searchTime: 3, sound: false, version: 4 }));
// 清空战绩
global.localStorage.removeItem('gomoku.leaderboard');

var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, mockAI);

// 开始对局（玩家黑，AI 白）
document.getElementById('btn-start').onclick();
// 模拟玩家黑落 5 连 (8,8)(8,9)(8,10)(8,11)(8,12)
var cell = 288 / 17;
function tap(x, y) {
  els['board']._listeners['pointerdown']({ clientX: x * cell + cell / 2, clientY: y * cell + cell / 2, preventDefault: function(){} });
}
tap(8, 8); tap(8, 9); tap(8, 10); tap(8, 11); tap(8, 12);   // 黑五连

setTimeout(function () {
  // 黑胜 → lb.blackWins=1，上报榜1 score=1000001
  var lb = JSON.parse(localStorage.getItem('gomoku.leaderboard'));
  assert(lb && lb.blackWins === 1, '执黑胜 → blackWins=1');
  var hasBlack = submitted.some(function (o) { return o.board === 1 && o.score === 1000001; });
  assert(hasBlack, '榜1 上报 100w+1=1000001（执黑胜次数）');
  // 榜2/3 未上报（无执白胜数据）
  var hasWhite = submitted.some(function (o) { return o.board === 2; });
  assert(!hasWhite, '无执白胜 → 榜2 不上报');

  if (fails) { console.error('--- 上榜测试失败 ' + fails + ' 项 ---'); process.exit(1); }
  console.log('--- 上榜测试全部通过 ---');
  process.exit(0);
}, 200);
