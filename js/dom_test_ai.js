/*
 * DOM mock 验证 game.js 能正常初始化（浏览器加载无运行时错误）。
 * 用法：node js/dom_test_ai.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

// ---- 通用 DOM 元素 mock ----
function makeEl() {
  var el = {
    textContent: '', innerHTML: '', value: '', checked: false, hidden: true,
    disabled: false, style: {},
    _listeners: {},
    classList: {
      _c: {}, add: function (c) { this._c[c] = 1; }, remove: function (c) { delete this._c[c]; },
      toggle: function (c, v) { if (v) this._c[c] = 1; else delete this._c[c]; },
      contains: function (c) { return !!this._c[c]; }
    },
    addEventListener: function (ev, fn) { this._listeners[ev] = fn; },
    appendChild: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return makeEl(); },
    querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 300, height: 300 }; },
    clientWidth: 300, clientHeight: 300,
    // canvas
    getContext: function () { return ctx2d; },
    width: 0, height: 0
  };
  return el;
}
var ctx2d = {
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
  stroke: function () {}, fill: function () {}, arc: function () {},
  createRadialGradient: function () { return { addColorStop: function () {} }; },
  fillStyle: '', strokeStyle: '', lineWidth: 1
};
var els = {};
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function (sel) { return makeEl(); },
  querySelectorAll: function (sel) { return []; },
  createElement: function () { return makeEl(); },
  head: { appendChild: function () {} }
};
global.window = {
  addEventListener: function () {}, devicePixelRatio: 1,
  toy: { getRankList: function () { return Promise.resolve([]); }, getMyRank: function () { return Promise.resolve({}); }, submitScore: function () { return Promise.resolve(); } }
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

// 加载 ai.js（浏览器全局注册 GomokuAI）
var aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf-8');
var fn = new Function('window', aiSrc + '\n;return window.GomokuAI;');
var GomokuAI = fn(global.window);
if (!GomokuAI || typeof GomokuAI.getMove !== 'function') { console.error('ai.js 未注册 GomokuAI'); process.exit(1); }
console.log('PASS: ai.js 注册 GomokuAI 成功');

// 加载 game.js（应无运行时错误）
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
try {
  new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
    global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, GomokuAI);
  console.log('PASS: game.js 初始化无运行时错误');
} catch (e) {
  console.error('FAIL: game.js 初始化出错: ' + e.message);
  console.error(e.stack);
  process.exit(1);
}

// 触发导出按钮：应静默复制二维数组到剪贴板 + 打开成功提示弹窗
var copiedText = null;
Object.defineProperty(global, 'navigator', {
  value: { clipboard: { writeText: function (t) { copiedText = t; return Promise.resolve(); } } },
  configurable: true, writable: true
});
try {
  document.getElementById('btn-export').onclick();
  setTimeout(function () {
    try {
      var obj = JSON.parse(copiedText);
      var allZero = Array.isArray(obj.board) && obj.board.every(function (row) { return row.every(function (v) { return v === 0; }); });
      if (obj && obj.v === 1 && Array.isArray(obj.board) && obj.board.length === 17 &&
          Array.isArray(obj.board[0]) && obj.board[0].length === 17 && Array.isArray(obj.moves)) {
        console.log('PASS: 导出为新格式（board 17×17 二维数组 + moves 落子序列）' + (allZero ? '（空棋盘全0）' : ''));
      } else {
        console.error('FAIL: 导出数据格式错误: v=' + obj.v + ' board=' + (obj.board && obj.board.length) + ' moves=' + (obj.moves && obj.moves.length));
        process.exit(1);
      }
      var modalOpen = document.getElementById('export-modal').hidden === false;
      console.log(modalOpen ? 'PASS: 导出成功提示弹窗已打开' : 'FAIL: 导出提示弹窗未打开');
      // 帮助按钮绑定存在
      if (typeof document.getElementById('btn-help').onclick === 'function') {
        console.log('PASS: 帮助按钮已绑定');
      } else {
        console.error('FAIL: 帮助按钮未绑定');
        process.exit(1);
      }
      // 触发帮助：requestHelp 应调用 getMove 并正常渲染（不崩溃）
      try {
        document.getElementById('btn-help').onclick();
        setTimeout(function () {
          console.log('PASS: 帮助功能触发无异常（虚影渲染完成）');
          console.log('--- DOM mock 验证完成 ---');
        }, 120);
      } catch (e2) {
        console.error('FAIL: 帮助功能异常: ' + e2.message);
        process.exit(1);
      }
    } catch (e) {
      console.error('FAIL: 导出功能异常: ' + e.message);
      process.exit(1);
    }
  }, 30);
} catch (e) {
  console.error('FAIL: 导出功能异常: ' + e.message);
  process.exit(1);
}
