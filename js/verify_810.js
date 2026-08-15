/*
 * 复现用户对局：黑第21手起，AI 黑下，白走用户给定序列（跳过已被占的点），
 * 观察改进后 AI 黑能否摆脱被动防守、防住白的连续做杀。
 * 用法：node js/verify_810.js <预算ms>
 */
'use strict';
var AI = require('./ai.js');
var N = 15, B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
var board = [
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,2,1,1,1,0,0,0,0,0,0],
[0,0,0,0,0,0,1,2,0,1,0,0,0,0,0],[0,0,0,0,0,1,2,1,2,2,0,0,0,0,0],
[0,0,0,0,2,0,0,2,1,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,1,1,0,0,0,0,0],
[0,0,0,0,0,0,0,0,1,2,2,2,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
];
function flat() {
  var f = new Array(N * N).fill(E);
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++)
    if (board[y][x]) f[y * N + x] = board[y][x];
  f[10 * N + 8] = E; // 移除黑第21手落子点，回到 AI 决策前局面
  return f;
}
function win(f, c) {
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
    if (f[y * N + x] !== c) continue;
    var d = [[1,0],[0,1],[1,1],[1,-1]];
    for (var k = 0; k < 4; k++) {
      var n = 1;
      for (var s = 1; s < 5; s++) {
        var nx = x + d[k][0] * s, ny = y + d[k][1] * s;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N || f[ny * N + nx] !== c) break;
        n++;
      }
      if (n >= 5) return true;
    }
  }
  return false;
}
function run(budget) {
  var f = flat();
  var log = [], moveNo = 21;
  // 白序列：用户原始应对序列（若某点已被黑占则跳过，白改走下一目标点）
  var seq = [[12,10],[10,8],[10,9],[10,11],[10,12],[8,7],[12,10]];
  for (var turn = 0; turn < 40; turn++) {
    // 黑 AI 落子
    var t = {};
    var mv = AI.getMove(f, N, B, budget, t);
    if (!mv) break;
    f[mv[1] * N + mv[0]] = B;
    log.push('黑' + moveNo + '手落(' + mv[0] + ',' + mv[1] + ') [L' + t.layer + '] ' + (t.elapsed | 0) + 'ms');
    if (win(f, B)) { log.push('>>> 黑胜（五连）'); break; }
    moveNo++;
    // 白落子：取序列中第一个未被占的点
    var wp = null;
    while (seq.length) {
      var p = seq.shift();
      if (f[p[1] * N + p[0]] === E) { wp = p; break; }
    }
    if (!wp) break;
    f[wp[1] * N + wp[0]] = W;
    log.push('白' + moveNo + '手落(' + wp[0] + ',' + wp[1] + ')');
    if (win(f, W)) { log.push('>>> 白胜（五连）'); break; }
    moveNo++;
  }
  return log.join('\n');
}
console.log(run(parseInt(process.argv[2] || '2500', 10)));
