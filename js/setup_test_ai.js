/*
 * 设置逻辑测试：验证 进攻性选项(k) 与 搜索时间(budget) 正确传入 AI。
 * 通过 mock GomokuAI 捕获 setK/getMove 调用参数。
 * 用法：node js/setup_test_ai.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

function makeEl() {
  return {
    textContent: '', innerHTML: '', value: '', checked: false, hidden: true,
    disabled: false, style: {}, _l: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    addEventListener: function (e, f) { this._l[e] = f; },
    appendChild: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return makeEl(); }, querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { left: 0, top: 0 }; },
    getContext: function () { return { setTransform: function(){}, clearRect: function(){}, fillRect: function(){}, beginPath: function(){}, moveTo: function(){}, lineTo: function(){}, stroke: function(){}, fill: function(){}, arc: function(){}, fillText: function(){}, createRadialGradient: function(){ return { addColorStop: function(){} }; }, font:'', textAlign:'', textBaseline:'', fillStyle:'', strokeStyle:'', lineWidth:1 }; },
    width: 0, height: 0
  };
}
var els = {};
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function () { return makeEl(); }, querySelectorAll: function () { return []; },
  createElement: function () { return makeEl(); }, head: { appendChild: function () {} }, body: { appendChild: function () {} }
};
global.window = { addEventListener: function () {}, devicePixelRatio: 1, toy: { getRankList: function(){return Promise.resolve([]);}, getMyRank: function(){return Promise.resolve({});}, submitScore: function(){return Promise.resolve();} } };
global.localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] != null ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};
global.requestAnimationFrame = function (fn) { if (fn) fn(); };
global.performance = { now: function () { return Date.now(); } };
// mock setTimeout 立即执行（限制 AI 落子次数，避免递归）
var aiMoves = 0;
global.setTimeout = function (fn) { if (aiMoves < 2) { aiMoves++; fn(); } };

var fails = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); fails++; }
  else console.log('PASS: ' + msg);
}

// mock AI：捕获 setK 和 getMove 调用
var calls = [];
var mockAI = {
  setAggression: function (b, w) { calls.push(['setAggression', b, w]); },
  getMove: function (board, size, color, budget) {
    calls.push(['getMove', color, budget]);
    // 返回一个合法落子（尽量中立的点）
    var c = 8 * size + 8;
    for (var i = 0; i < size * size; i++) { if (board[i] === 0) { c = i; break; } }
    return [c % size, (c / size) | 0];
  }
};

// 预置设置（历史用户：无 version 字段，搜索时间=3）
// → 设置版本迁移应把搜索时间刷新为新默认 3.5s
global.localStorage.setItem('gomoku.settings', JSON.stringify({ first: 'white', customK: 1.0, searchTime: 3 }));
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, mockAI);

// 触发开始游戏（AI 执黑先手，因 first=white → AI 黑）
aiMoves = 0;
  document.getElementById('btn-start').onclick();
calls.forEach(function (c) { console.log('  调用: ' + JSON.stringify(c)); });

// 历史用户迁移：无 version → 搜索时间刷新为新默认 3.5s
var hasBudget35 = calls.some(function (c) { return c[0] === 'getMove' && c[2] === 3500; });
assert(hasBudget35, '历史用户搜索时间刷新为新默认 3.5s → getMove budget=3500ms');

// 当前用户（version=4）：搜索时间=3 保留不刷新
global.localStorage.setItem('gomoku.settings', JSON.stringify({ first: 'white', customK: 1.0, searchTime: 3, version: 4 }));
calls = [];
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, mockAI);
aiMoves = 0;
  document.getElementById('btn-start').onclick();
var hasBudget3 = calls.some(function (c) { return c[0] === 'getMove' && c[2] === 3000; });
assert(hasBudget3, '当前用户搜索时间保留 3s → getMove budget=3000ms');

// 重新加载：搜索时间=2.5（当前用户 version=4，不刷新）
global.localStorage.setItem('gomoku.settings', JSON.stringify({ first: 'white', customK: 0.8, searchTime: 2.5, version: 4 }));
calls = [];
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, mockAI);
aiMoves = 0;
  document.getElementById('btn-start').onclick();
var hasBudget25 = calls.some(function (c) { return c[0] === 'getMove' && c[2] === 2500; });
assert(hasBudget25, '搜索时间 2.5s → getMove budget=2500ms');

if (fails) process.exit(1);
console.log('--- 设置逻辑测试完成 ---');
