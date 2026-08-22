/*
 * 复现用户棋局：AI 执白第14手应下 (10,7) 防御而非 (9,8) 贪攻。
 * 用法：node js/repro_1010.js <预算ms>
 */
'use strict';
var AI = require('./ai.js');
var N = 17, B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
// 用户第14手落子后棋盘（14子：黑7白7）。AI 决策前移除 (9,8) 白子 → 13子（黑7白6）
var raw = [
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,1,2,0,1,0,0,0,0,0,0],[0,0,0,0,0,0,0,2,0,1,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,2,1,2,1,0,0,0,0,0,0],[0,0,0,0,0,0,1,2,2,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
];
function flat() {
  var f = new Array(N * N).fill(E);
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++)
    if (raw[y][x]) f[y * N + x] = raw[y][x];
  f[8 * N + 9] = E; // 移除第14手已落的 (9,8) 白子 → 决策前局面
  return f;
}
var f = flat();
// 各候选点的评估
function i(x, y) { return y * N + x; }
console.log('=== 候选点分析 ===');
[[10,7],[9,8],[6,5],[10,9],[9,6],[8,10]].forEach(function (p) {
  var tMe = AI.threatAt(f, N, i(p[0], p[1]), W);
  var tOp = AI.threatAt(f, N, i(p[0], p[1]), B, 'def');
  var pt = AI.potentialThreat(f, N, i(p[0], p[1]), B);
  console.log(' 白落(' + p[0] + ',' + p[1] + ') 白tier=' + tMe.tier + ' 白val=' + tMe.value +
    ' 黑tier=' + tOp.tier + ' 黑val=' + tOp.value + ' 黑pt=' + pt);
});
// genMoves 顶层排序（applyDefense=true）
var moves = null;
try { moves = AI.genMoves ? null : null; } catch (e) {}
console.log('=== getMove 决策 ===');
var t = {};
var t0 = Date.now();
var mv = AI.getMove(f, N, W, parseInt(process.argv[2] || '3500', 10), t);
console.log('AI(白)第14手 → (' + mv[0] + ',' + mv[1] + ') layer=L' + t.layer + ' 耗时' + (Date.now() - t0) + 'ms depth=' + t.depth);
