/*
 * 启发式参数搜索：着法排序 我方威胁 - k×敌方威胁。
 * 执黑(k<1 进攻) / 执白(k>1 防守) 各探索一组 k，与基准 k=1 对弈，按胜率选最佳。
 *
 * 用法：node js/param_search_ai.js [black|white|both] [budgetMs] [gamesPerK]
 *   默认：both  100  15
 * 说明：black=搜执黑 k(0.5~0.95)；white=搜执白 k(1.05~1.5)；both=都搜。
 *   每 k 与基准对弈 gamesPerK 局：黑搜索=候选k执黑 vs 基准1执白；白搜索=基准1执黑 vs 候选k执白。
 */
'use strict';
var AI = require('./ai.js');
var B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
var N = 17;
var mode = process.argv[2] || 'both';
var budget = parseInt(process.argv[3] || '100', 10);
var games = parseInt(process.argv[4] || '15', 10);

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

// 一局：黑用 kBlack、白用 kWhite，返回胜者(B/W/0平)
function playGame(kBlack, kWhite, budget) {
  AI.setK(kBlack, kWhite);
  var b = empty();
  var turn = B, winner = 0;
  for (var mv = 0; mv < N * N; mv++) {
    var m = AI.getMove(b, N, turn, budget);
    if (!m) break;
    b[idx(m[0], m[1])] = turn;
    if (isWin(b, m[0], m[1], turn)) { winner = turn; break; }
    turn = turn === B ? W : B;
  }
  return winner;
}

function formatPct(n, d) { return (100 * n / d).toFixed(1) + '%'; }

function searchBlack() {
  console.log('=== 执黑参数搜索（候选k执黑 vs 基准k=1执白） 每k ' + games + ' 局 ===');
  var results = [];
  for (var i = 0; i <= 9; i++) {
    var k = Math.round((0.5 + i * 0.05) * 100) / 100;
    var wins = 0;
    for (var g = 0; g < games; g++) if (playGame(k, 1, budget) === B) wins++;
    results.push({ k: k, wins: wins });
    console.log('  k=' + k.toFixed(2) + ' → 黑胜率 ' + formatPct(wins, games) + ' (' + wins + '/' + games + ')');
  }
  results.sort(function (a, b) { return b.wins - a.wins; });
  console.log('★ 执黑最佳 k = ' + results[0].k.toFixed(2) + '（黑胜率 ' + formatPct(results[0].wins, games) + '）');
  return results[0].k;
}

function searchWhite() {
  console.log('=== 执白参数搜索（基准k=1执黑 vs 候选k执白） 每k ' + games + ' 局 ===');
  var results = [];
  for (var i = 0; i <= 9; i++) {
    var k = Math.round((1.05 + i * 0.05) * 100) / 100;
    var wins = 0;
    for (var g = 0; g < games; g++) if (playGame(1, k, budget) === W) wins++;
    results.push({ k: k, wins: wins });
    console.log('  k=' + k.toFixed(2) + ' → 白胜率 ' + formatPct(wins, games) + ' (' + wins + '/' + games + ')');
  }
  results.sort(function (a, b) { return b.wins - a.wins; });
  console.log('★ 执白最佳 k = ' + results[0].k.toFixed(2) + '（白胜率 ' + formatPct(results[0].wins, games) + '）');
  return results[0].k;
}

var t0 = Date.now();
var bestBlack = null, bestWhite = null;
if (mode === 'black' || mode === 'both') bestBlack = searchBlack();
if (mode === 'white' || mode === 'both') bestWhite = searchWhite();
console.log('总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
console.log('最终建议：setK(' + (bestBlack !== null ? bestBlack.toFixed(2) : '1') + ', ' + (bestWhite !== null ? bestWhite.toFixed(2) : '1') + ')');
AI.setK(1, 1); // 复位基准
