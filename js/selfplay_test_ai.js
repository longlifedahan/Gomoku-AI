/*
 * 自对弈测试：AI vs AI，验证能正常成五、无死循环、无非法落子。
 * 用法：node js/selfplay_test_ai.js [局数] [每步预算ms]
 */
'use strict';
var AI = require('./ai.js');
var B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
var N = 17;
var games = parseInt(process.argv[2] || '8', 10);
var budget = parseInt(process.argv[3] || '300', 10);
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
var wins = { black: 0, white: 0, draw: 0 };
var t0 = Date.now();
for (var g = 0; g < games; g++) {
  var b = empty();
  var turn = B, winner = 0, illegal = false;
  for (var mv = 0; mv < N * N; mv++) {
    var m = AI.getMove(b, N, turn, budget);
    if (!m) break;
    var x = m[0], y = m[1];
    if (x < 0 || x >= N || y < 0 || y >= N || b[idx(x, y)] !== E) { illegal = true; break; }
    b[idx(x, y)] = turn;
    if (isWin(b, x, y, turn)) { winner = turn; break; }
    turn = turn === B ? W : B;
  }
  if (illegal) { console.error('局' + g + ' 非法落子'); }
  else if (winner === B) wins.black++;
  else if (winner === W) wins.white++;
  else wins.draw++;
}
console.log('自对弈 ' + games + ' 局（预算' + budget + 'ms）：黑胜 ' + wins.black + '，白胜 ' + wins.white + '，平 ' + wins.draw + '，总耗时 ' + (Date.now() - t0) + 'ms');
if (wins.black + wins.white === 0) { console.error('无获胜对局，疑似异常'); process.exitCode = 1; }
