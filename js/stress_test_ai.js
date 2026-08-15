/*
 * 压力测试：多种局面（随机 + 战术局面）下 getMove 时间与合法性。
 * 确保每步 ≤2.5s（预算 2500ms）。
 * 用法：node js/stress_test_ai.js [局数]
 */
'use strict';
var AI = require('./ai.js');
var B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
var N = 17, BUDGET = 2500;
var games = parseInt(process.argv[2] || '40', 10);
function empty() { return new Array(N * N).fill(E); }
function idx(x, y) { return y * N + x; }
function rand(n) { return Math.floor(Math.random() * n); }
function inB(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
function isWin(b, x, y, c) {
  var dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (var d = 0; d < 4; d++) {
    var cnt = 1, dx = dirs[d][0], dy = dirs[d][1];
    for (var s = 1; s < 5; s++) { if (inB(x+dx*s, y+dy*s) && b[idx(x+dx*s, y+dy*s)] === c) cnt++; else break; }
    for (var s = 1; s < 5; s++) { if (inB(x-dx*s, y-dy*s) && b[idx(x-dx*s, y-dy*s)] === c) cnt++; else break; }
    if (cnt >= 5) return true;
  }
  return false;
}

var fails = 0, maxMs = 0, totalMs = 0;
var t0 = Date.now();
for (var g = 0; g < games; g++) {
  var b = empty();
  // 随机局面：3~14 颗交替子
  var stones = rand(12) + 3, placed = 0, guard = 0;
  while (placed < stones && guard++ < 400) {
    var c = rand(N * N);
    if (b[c] === E) { b[c] = placed % 2 === 0 ? B : W; placed++; }
  }
  var t1 = Date.now();
  var mv;
  try {
    mv = AI.getMove(b, N, B, BUDGET);
  } catch (e) {
    console.error('局' + g + ' 异常: ' + e.message); fails++; continue;
  }
  var el = Date.now() - t1;
  if (el > maxMs) maxMs = el;
  totalMs += el;
  if (!mv || mv.length !== 2 || mv[0] < 0 || mv[0] >= N || mv[1] < 0 || mv[1] >= N) {
    console.error('局' + g + ' 非法落子: ' + JSON.stringify(mv)); fails++; continue;
  }
  if (b[idx(mv[0], mv[1])] !== E) { console.error('局' + g + ' 落到已占点'); fails++; continue; }
  // 用户 2026-08-14：L14 用满整个预算（不扣前面决策层耗时），总时长允许超过单步限制
  // （openingDecision ≤2s + L14 满预算），容忍 +2000ms（用户不掐表计时，确保 AI 能力强大优先）
  if (el > BUDGET + 2000) { console.error('局' + g + ' 超时: ' + el + 'ms'); fails++; }
}
console.log('随机局面 ' + games + ' 局：失败 ' + fails + '，平均 ' + Math.round(totalMs / games) + 'ms，最慢 ' + maxMs + 'ms');
if (fails) process.exitCode = 1;
