/*
 * 历史棋谱导出测试：导出格式与对局一致 {v,size,moves,board}，可被人工对战"导入残局"解析。
 * 用法：node js/history_export_test.js
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
var els = {}, createdDivs = [];
global.document = {
  getElementById: function (id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector: function(){ return makeEl(); }, querySelectorAll: function(){ return []; },
  createElement: function (tag) { var el = makeEl(); if (tag === 'div') createdDivs.push(el); return el; },
  head: { appendChild: function(){} }, body: { appendChild: function(){} }
};
var copied = null;
Object.defineProperty(global, 'navigator', {
  value: { clipboard: { writeText: function (t) { copied = t; return Promise.resolve(); } } },
  configurable: true, writable: true
});
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

// 预置历史棋谱（黑3连 + 白2应对，共5手）
global.localStorage.setItem('gomoku.history', JSON.stringify([
  { ts: 1, winner: 1, hand: 5, moves: [
    { idx: 8 * 17 + 8, color: 1 }, { idx: 9 * 17 + 8, color: 2 },
    { idx: 8 * 17 + 9, color: 1 }, { idx: 9 * 17 + 9, color: 2 },
    { idx: 8 * 17 + 10, color: 1 }
  ]}
]));

var aiSrc = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf-8');
var GomokuAI = new Function('window', aiSrc + '\n;return window.GomokuAI;')(global.window);
var gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf-8');
new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'GomokuAI', gameSrc)(
  global.window, global.document, global.localStorage, global.requestAnimationFrame, global.performance, GomokuAI);

// 打开历史棋谱 → 点击第一个历史项 → 回放 → 导出
document.getElementById('btn-history').onclick();
setTimeout(function () {
  // 点击历史项（renderHistoryList 创建的 div）
  var item = createdDivs[0];
  assert(!!item && typeof item._listeners['click'] === 'function', '历史棋谱项已渲染且可点击');
  item._listeners['click']();
  assert(els['replay-modal'].hidden === false, '回放弹窗已打开');
  // 导出棋谱
  document.getElementById('btn-export-replay').onclick();
  setTimeout(function () {
    assert(!!copied, '导出信息已复制到剪贴板');
    var obj = JSON.parse(copied);
    assert(obj.v === 1 && obj.size === 17, '导出含 v=1、size=17');
    assert(Array.isArray(obj.moves) && obj.moves.length === 5, '导出 moves 含 5 手，实际=' + (obj.moves && obj.moves.length));
    assert(obj.moves[0][0] === 8 && obj.moves[0][1] === 8 && obj.moves[0][2] === 1, '第1手为黑(8,8)，实际=' + JSON.stringify(obj.moves[0]));
    assert(Array.isArray(obj.board) && obj.board.length === 17 && obj.board[0].length === 17, '导出 board 为 17×17');
    assert(obj.board[8][8] === 1 && obj.board[9][8] === 2, 'board 与落子一致');
    // 与人工对战导入残局兼容：board 与 moves 可解析（含 move 数组）
    assert(Array.isArray(obj.moves[4]) && obj.moves[4][2] === 1, '第5手为黑');
    if (fails) { console.error('--- 历史导出测试失败 ' + fails + ' 项 ---'); process.exit(1); }
    console.log('--- 历史导出测试全部通过 ---');
    process.exit(0);
  }, 50);
}, 100);
