/*
 * 端到端日志测试：模拟 AI 先手走 2 步，捕获 console.log 验证格式：
 *   [AI] 第X手 → 触发[L?] 耗时Xms 落子[x,y]
 * 用法：node js/e2e_log_test.js
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
    getContext: function () { return ctx2d; }, width: 0, height: 0
  };
}
var ctx2d = {
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, stroke: function () {},
  fill: function () {}, arc: function () {}, fillText: function () {},
  createRadialGradient: function () { return { addColorStop: function () {} }; },
  font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 1
};
var els = {};
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function () { return makeEl(); }, querySelectorAll: function () { return []; },
  createElement: function () { return makeEl(); }, head: { appendChild: function () {} }, body: { appendChild: function () {} }
};
global.window = { addEventListener: function () {}, devicePixelRatio: 1, toy: { getRankList: function(){return Promise.resolve([]);}, getMyRank: function(){return Promise.resolve({});}, submitScore: function(){return Promise.resolve();} } };
global.localStorage = { _d: {}, getItem: function (k) { return this._d[k] != null ? this._d[k] : null; }, setItem: function (k, v) { this._d[k] = String(v); }, removeItem: function (k) { delete this._d[k]; } };
global.requestAnimationFrame = function (fn) { if (fn) fn(); };
global.performance = { now: function () { return Date.now(); } };

// 捕获 console.log
var logs = [];
var origLog = console.log;
console.log = function () { logs.push(Array.prototype.slice.call(arguments).join(' ')); };

// mock setTimeout：立即执行但限制 AI 落子次数
var aiMoves = 0;
var MAX_AI = 2;
global.setTimeout = function (fn) {
  if (aiMoves >= MAX_AI) return 0;
  aiMoves++;
  fn();
  return aiMoves;
};

// 加载 ai.js
var aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf-8');
var fn = new Function('window', aiSrc + '\n;return window.GomokuAI;');
var GomokuAI = fn(global.window);

// 加载 game.js
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, GomokuAI);

// 开始对局（默认执白后手 → AI 执黑先手）
document.getElementById('btn-start').onclick();

console.log = origLog;

// 验证日志
var aiLogs = logs.filter(function (l) { return l.indexOf('[AI] 第') === 0; });
console.log('=== 捕获的 AI 日志 ===');
aiLogs.forEach(function (l) { console.log(l); });
var ok = aiLogs.length >= 1 && /^\[AI\] 第\d+手 → 触发\[L\d+\] 耗时\d+ms 落子\[\d+,\d+\]$/.test(aiLogs[0]);
console.log(ok ? 'PASS: AI 日志格式正确' : 'FAIL: AI 日志格式异常: ' + (aiLogs[0] || '无日志'));
process.exit(ok ? 0 : 1);
