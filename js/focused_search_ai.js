/*
 * 聚焦参数验证：在候选最佳区间附近细扫，用更多局数对抗随机扰动噪声。
 * 用法：node js/focused_search_ai.js [budgetMs] [gamesPerK]
 */
'use strict';
var AI = require('./ai.js');
var B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
var N = 17;
var budget = parseInt(process.argv[2] || '200', 10);
var games = parseInt(process.argv[3] || '50', 10);

function empty() { return new Array(N * N).fill(E); }
function idx(x, y) { return y * N + x; }
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
function play(kB, kW, budget) {
  AI.setK(kB, kW);
  var b = empty(), turn = B, winner = 0;
  for (var mv = 0; mv < N * N; mv++) {
    var m = AI.getMove(b, N, turn, budget);
    if (!m) break;
    b[idx(m[0], m[1])] = turn;
    if (isWin(b, m[0], m[1], turn)) { winner = turn; break; }
    turn = turn === B ? W : B;
  }
  return winner;
}
function pct(n) { return (100 * n / games).toFixed(0) + '%'; }

console.log('=== 黑方聚焦（候选k执黑 vs 基准白k=1） 每k ' + games + ' 局 预算' + budget + 'ms ===');
var t0 = Date.now(), bestB = null, bestBw = -1;
[0.70, 0.75, 0.80, 0.85, 0.90].forEach(function (k) {
  var bw = 0;
  for (var g = 0; g < games; g++) if (play(k, 1, budget) === B) bw++;
  console.log('  k=' + k.toFixed(2) + ' → 黑胜率 ' + pct(bw) + ' (' + bw + '/' + games + ')');
  if (bw > bestBw) { bestBw = bw; bestB = k; }
});
console.log('★ 黑方最佳 k = ' + bestB.toFixed(2));

console.log('=== 白方聚焦（基准黑k=1 vs 候选k执白） 每k ' + games + ' 局 ===');
var bestW = null, bestWw = -1;
[1.20, 1.30, 1.40, 1.45, 1.50].forEach(function (k) {
  var ww = 0;
  for (var g = 0; g < games; g++) if (play(1, k, budget) === W) ww++;
  console.log('  k=' + k.toFixed(2) + ' → 白胜率 ' + pct(ww) + ' (' + ww + '/' + games + ')');
  if (ww > bestWw) { bestWw = ww; bestW = k; }
});
console.log('★ 白方最佳 k = ' + bestW.toFixed(2));
console.log('总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
console.log('最终建议 setK(' + bestB.toFixed(2) + ', ' + bestW.toFixed(2) + ')');
AI.setK(1, 1);
