/*
 * 全局排行榜测试：新编码展示 / 老数据过滤 / "我"固定底部。
 * 用法：node js/lb_test.js
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
    addEventListener: function (ev, fn) { this._listeners[ev] = fn; },
    appendChild: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return makeEl(); }, querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 300, height: 300 }; },
    clientWidth: 300, clientHeight: 300,
    getContext: function () { return ctx2d; }, width: 0, height: 0
  };
  return el;
}
var ctx2d = { setTransform: function(){}, clearRect: function(){}, fillRect: function(){}, beginPath: function(){},
  moveTo: function(){}, lineTo: function(){}, stroke: function(){}, fill: function(){}, arc: function(){}, fillText: function(){},
  createRadialGradient: function(){ return { addColorStop: function(){} }; },
  fillStyle:'', strokeStyle:'', lineWidth:1, font:'', textAlign:'', textBaseline:'' };
var els = {};
function makeTab(board) {
  var el = makeEl();
  el.getAttribute = function (a) { return a === 'data-board' ? String(board) : null; };
  return el;
}
function makePeriodTab(p) {
  var el = makeEl();
  el.getAttribute = function (a) { return a === 'data-period' ? p : null; };
  return el;
}
var boardTabs = null, periodTabs = null;
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function (sel) { return makeEl(); },
  querySelectorAll: function (sel) {
    if (sel.indexOf('lb-period-tabs') >= 0) {
      if (!periodTabs) periodTabs = [makePeriodTab('day'), makePeriodTab('week'), makePeriodTab('month'), makePeriodTab('all')];
      return periodTabs;
    }
    if (sel.indexOf('#lb-tabs') >= 0) {
      if (!boardTabs) boardTabs = [makeTab(1), makeTab(2), makeTab(3)];
      return boardTabs;
    }
    return [];
  },
  createElement: function () { return makeEl(); },
  head: { appendChild: function () {} }, body: { appendChild: function () {} }
};
// 捕获 submitScore 调用
var submitted = [];
global.window = {
  addEventListener: function(){}, devicePixelRatio: 1,
  toy: {
    getRankList: function (opt) {
      // 返回混合：老数据(score<100w) + 新数据(score>=100w)
      return Promise.resolve([
        { rank: 1, nickname: '黑胜王者', score: 1000018, avatar: '' },
        { rank: 2, nickname: '老数据', score: 500, avatar: '' },
        { rank: 3, nickname: '白胜高手', score: 1000007, avatar: '' },
        { rank: 4, nickname: '老数据2', score: 591350, avatar: '' },
        { rank: 5, nickname: '步数达人', score: 1000982, avatar: '' }
      ]);
    },
    getMyRank: function () {
      return Promise.resolve({ rank: 3, score: 1000007, ranked: true });
    },
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
global.Math.random = function () { return 0.5; };

var fails = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); fails++; }
  else console.log('PASS: ' + msg);
}

var aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf-8');
var fn = new Function('window', aiSrc + '\n;return window.GomokuAI;');
var GomokuAI = fn(global.window);
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, GomokuAI);

// 触发全局排行榜（默认榜1 执黑胜）
document.getElementById('btn-global-lb').onclick();
setTimeout(function () {
  var scroll = document.getElementById('lb-scroll').innerHTML;
  var mine = document.getElementById('lb-mine').innerHTML;
  // 1. 榜1 新数据展示（score>=100w）+ 老数据过滤
  assert(scroll.indexOf('黑胜王者') >= 0, '榜1 新数据「黑胜王者」展示');
  assert(scroll.indexOf('老数据') < 0, '老数据（score<100w）被过滤不展示');
  assert(scroll.indexOf('18 次') >= 0, '榜1 执黑胜还原为次数（18 次）');
  // 2. "我"固定底部（竖线分隔，新编码展示）
  assert(mine.indexOf('我') >= 0 && mine.indexOf('7 次') >= 0, '「我」固定底部显示执白胜 7 次');
  // 3. 点击榜3 tab：执白胜最少步数还原为步数
  var tab3 = document.querySelectorAll('#lb-tabs .tab')[2];
  tab3._listeners['click'].call(tab3);
  setTimeout(function () {
    var s3 = document.getElementById('lb-scroll').innerHTML;
    assert(s3.indexOf('18 手') >= 0, '榜3 执白胜最少步数还原为步数（18 手）');
    if (fails) { console.error('--- 排行榜测试失败 ' + fails + ' 项 ---'); process.exit(1); }
    console.log('--- 排行榜测试全部通过 ---');
    process.exit(0);
  }, 100);
}, 100);
