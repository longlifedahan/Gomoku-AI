/*
 * AI 决策诊断工具：粘贴棋盘局面，分析 AI 各分层判断。
 * 用法：
 *   node js/diagnose_ai.js "5,7:W 6,7:W 7,7:W"
 *   坐标格式：x,y:W(白/对手) 或 x,y:B(黑/AI)，用空格分隔。
 * 输出：对方活三威胁、各分层候选、getMove 结果及理由。
 */
'use strict';
var AI = require('./ai.js');
var N = 17;
var B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
function e() { return new Array(N * N).fill(E); }
function i(x, y) { return y * N + x; }

var input = process.argv[2] || '';
var b = e();
if (!input.trim()) {
  console.log('用法：node js/diagnose_ai.js "x,y:W x,y:B ..."');
  process.exit(0);
}
input.trim().split(/\s+/).forEach(function (tok) {
  var m = tok.match(/^(\d+),(\d+):([WB])$/);
  if (!m) { console.error('无法解析: ' + tok); return; }
  b[i(+m[1], +m[2])] = m[3] === 'B' ? B : W;
});

function pts(arr) {
  return arr.map(function (p) { return '[' + (p % N) + ',' + ((p / N) | 0) + ']'; }).join(' ') || '无';
}
function nearWin() {
  // 对方(白)一步即连五的必堵点
  return AI.findWinPoints(b, N, W);
}

console.log('=== 局面分析（黑=AI 走棋） ===');
// 对方活三威胁
var T = [], n = N * N;
for (var q = 0; q < n; q++) {
  if (b[q] !== E) continue;
  var t = AI.threatAt(b, N, q, W);
  if (t.tier === 6) T.push(q);
}
console.log('白活三威胁点(白下后活四): ' + pts(T));
console.log('白可一步连五点: ' + pts(nearWin()));
console.log('L6 blockLiveThree 防守点: ' + pts(AI.blockLiveThree(b, N, B, W)));
console.log('L4 己方四三四四: ' + pts(AI.findOwn43_44(b, N, B)));
console.log('L5 己方活四: ' + pts(AI.findOwnLiveFour(b, N, B)));
console.log('L8 己方三三: ' + pts(AI.findOwn33(b, N, B)));

var mv = AI.getMove(b, N, B, 500);
console.log('AI getMove → [' + mv[0] + ',' + mv[1] + ']');
var def = AI.blockLiveThree(b, N, B, W);
var isDef = def.some(function (p) { return p === i(mv[0], mv[1]); });
var mvIdx = i(mv[0], mv[1]);
var isNear = T.some(function (p) {
  var tx = p % N, ty = (p / N) | 0;
  return Math.abs(mv[0] - tx) + Math.abs(mv[1] - ty) <= 1;
});
var tSelf = AI.threatAt(b, N, mvIdx, B);
if (tSelf.tier === 7 || tSelf.is43 || tSelf.is44 || tSelf.tier === 6) {
  console.log('AI 落点 → 己方必胜进攻（规格 L4/L5 优先于防活三）');
} else if (isDef || isNear) {
  console.log('AI 落点 → 堵了对方活三');
} else if (T.length) {
  console.log('⚠ AI 落点 → 既未堵活三、也非必胜进攻（需检查）');
} else {
  console.log('AI 落点 → 对方无活三威胁，正常选择');
}
