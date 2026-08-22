/*
 * 功能测试：导出含落子序列 / 历史导入恢复棋谱 / 人工对战 + 导入残局。
 * 用法：node js/test_features.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

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
    getContext: function () { return ctx2d; },
    width: 0, height: 0
  };
  return el;
}
var ctx2d = {
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
  stroke: function () {}, fill: function () {}, arc: function () {}, fillText: function () {},
  createRadialGradient: function () { return { addColorStop: function () {} }; },
  fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: ''
};
var els = {};
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function (sel) { return makeEl(); },
  querySelectorAll: function (sel) { return []; },
  createElement: function () { return makeEl(); },
  head: { appendChild: function () {} }, body: { appendChild: function () {} }
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

var fails = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); fails++; }
  else console.log('PASS: ' + msg);
}
// 模拟点击棋盘某坐标（像素）
function tap(cx, cy) {
  var boardEl = els['board'];
  var fn = boardEl._listeners['pointerdown'];
  fn({ clientX: cx, clientY: cy, preventDefault: function () {} });
}

// 加载 ai.js
var aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf-8');
var fn = new Function('window', aiSrc + '\n;return window.GomokuAI;');
var GomokuAI = fn(global.window);

// 加载 game.js
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, GomokuAI);

// 捕获剪贴板
var copiedText = null;
Object.defineProperty(global, 'navigator', {
  value: { clipboard: { writeText: function (t) { copiedText = t; return Promise.resolve(); } } },
  configurable: true, writable: true
});

// ===== 1. 人工对战开局 =====
document.getElementById('btn-pvp').onclick();
assert(els['game-status'].textContent === '轮到你（黑棋）', '人工对战开局：轮到你（黑棋），实际=' + els['game-status'].textContent);
assert(els['btn-import'].hidden === false, '人工对战显示「导入残局」按钮');

// ===== 2. 人工对战落子（黑白轮流）=====
var cell = 288 / 17;   // boardCss=288
tap(8 * cell + cell / 2, 8 * cell + cell / 2);   // 黑 (8,8)
assert(els['game-moves'].textContent === '步数 1', '黑落子后步数 1，实际=' + els['game-moves'].textContent);
assert(els['game-status'].textContent === '轮到你（白棋）', '黑落子后轮到白棋，实际=' + els['game-status'].textContent);
tap(9 * cell + cell / 2, 8 * cell + cell / 2);   // 白 (9,8)
assert(els['game-moves'].textContent === '步数 2', '白落子后步数 2，实际=' + els['game-moves'].textContent);
assert(els['game-status'].textContent === '轮到你（黑棋）', '白落子后轮到黑棋，实际=' + els['game-status'].textContent);

// ===== 3. 导出含落子序列 =====
document.getElementById('btn-export').onclick();
var exp = JSON.parse(copiedText);
assert(exp && exp.v === 1 && exp.size === 17, '导出为新格式（v=1, size=17）');
assert(Array.isArray(exp.moves) && exp.moves.length === 2, '导出含落子序列 moves（2 手），实际=' + (exp.moves && exp.moves.length));
assert(Array.isArray(exp.board) && exp.board.length === 17, '导出含棋盘 board（17 行）');
assert(exp.moves[0][0] === 8 && exp.moves[0][1] === 8 && exp.moves[0][2] === 1, '第1手为黑(8,8)，实际=' + JSON.stringify(exp.moves[0]));
assert(exp.moves[1][2] === 2, '第2手为白，实际=' + JSON.stringify(exp.moves[1]));
assert(exp.board[8][8] === 1 && exp.board[8][9] === 2, '棋盘 board 与落子一致');

// ===== 4. 历史棋谱：从导出信息恢复棋谱图 =====
document.getElementById('btn-import-history').onclick();
assert(els['history-modal'].hidden === true, '点导入后历史弹窗已关闭');
assert(els['import-modal'].hidden === false, '导入弹窗已打开');
els['import-text'].value = JSON.stringify(exp);
document.getElementById('btn-import-ok').onclick();
assert(els['import-modal'].hidden === true, '导入弹窗已关闭');
assert(els['replay-modal'].hidden === false, '回放弹窗已打开');
assert(els['replay-info'].textContent.indexOf('2 手') >= 0, '回放信息显示 2 手，实际=' + els['replay-info'].textContent);

// ===== 5. 人工对战导入残局 =====
// 先返回人工对战对局页（importPosition 内部会 showGame）
els['import-modal'].hidden = true;
document.getElementById('btn-import').onclick();
assert(els['import-modal'].hidden === false, '对局页导入弹窗打开');
els['import-text'].value = JSON.stringify(exp);
document.getElementById('btn-import-ok').onclick();
// 恢复后：2 手已下，轮到黑（偶数）→ 但第1手黑、第2手白，接下来第3手黑
assert(els['game-status'].textContent === '轮到你（黑棋）', '导入残局后轮到黑棋，实际=' + els['game-status'].textContent);
assert(els['game-moves'].textContent === '步数 2', '导入残局后步数 2，实际=' + els['game-moves'].textContent);
// 继续落子应正常
tap(10 * cell + cell / 2, 8 * cell + cell / 2);   // 黑 (10,8)
assert(els['game-moves'].textContent === '步数 3', '导入后继续落子步数 3，实际=' + els['game-moves'].textContent);

// ===== 6. 旧格式（二维棋盘）导入兜底 =====
var oldArr = exp.board;   // 17×17 二维数组
document.getElementById('btn-import-history').onclick();
els['import-text'].value = JSON.stringify(oldArr);
document.getElementById('btn-import-ok').onclick();
assert(els['replay-modal'].hidden === false, '旧格式导入也打开回放');
assert(els['replay-info'].textContent.indexOf('手') >= 0, '旧格式导入显示手数（盘面扫描生成）');

if (fails) { console.error('--- 功能测试失败 ' + fails + ' 项 ---'); process.exit(1); }
console.log('--- 功能测试全部通过 ---');
