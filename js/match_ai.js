/* 临时：当前分支(vct) vs master 对弈，各自执黑/执白 N 局。
 * 用法：node js/match_ai.js <每方局数> [预算ms]  → 总对局 = 每方局数*2（交替执先）
 */
'use strict';
var AI_M = require('./ai.js');              // 决策树版（当前，含 L0-L14b）
var AI_V = require('./ai_pure_tmp.js');     // 纯深搜版（跳过决策树，只深搜）
var N = 17, B = 1, W = 2, E = 0;
var perSide = parseInt(process.argv[2] || '5', 10);   // 每方执先局数
var budget = parseInt(process.argv[3] || '2000', 10);
var games = perSide * 2;   // 当前执黑 perSide + 当前执白 perSide
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
function play(blackAI, whiteAI) {
  var b = new Array(N * N).fill(E);
  var turn = B;
  for (var mv = 0; mv < N * N; mv++) {
    var ai = turn === B ? blackAI : whiteAI;
    var m = ai.getMove(b, N, turn, budget);
    if (!m || m.length !== 2 || m[0] < 0 || m[0] >= N || m[1] < 0 || m[1] >= N || b[idx(m[0], m[1])] !== E) return -1;
    b[idx(m[0], m[1])] = turn;
    if (isWin(b, m[0], m[1], turn)) return turn;
    turn = turn === B ? W : B;
  }
  return 0;
}
var vBlackWin = 0, vWhiteWin = 0, mBlackWin = 0, mWhiteWin = 0, draw = 0, illegal = 0, t0 = Date.now();
for (var i = 0; i < games; i++) {
  // 前 perSide 局当前执黑，后 perSide 局当前执白
  var vBlack = i < perSide;
  var r = vBlack ? play(AI_V, AI_M) : play(AI_M, AI_V);
  if (r === -1) { illegal++; console.error('局' + i + ' 非法落子'); continue; }
  if (r === 0) draw++;
  else if (r === B) { if (vBlack) vBlackWin++; else mBlackWin++; }
  else if (r === W) { if (vBlack) mWhiteWin++; else vWhiteWin++; }
}
var vWin = vBlackWin + vWhiteWin, mWin = mBlackWin + mWhiteWin;
console.log('对弈' + games + '局（预算' + budget + 'ms）：当前分支执黑' + vBlackWin + '胜/执白' + vWhiteWin + '胜（共' + vWin + '）  master执黑' + mBlackWin + '胜/执白' + mWhiteWin + '胜（共' + mWin + '）  平=' + draw +
  (illegal ? '，非法=' + illegal : '') + '，耗时' + Math.round((Date.now() - t0) / 1000) + 's');
