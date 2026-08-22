/*
 * 冒烟测试：新 AI（按规格 v5.3）棋型分类 + 分层决策 + getMove 行为。
 * 用法：node js/smoke_test_ai.js
 */
'use strict';
var AI = require('./ai.js');
var B = AI.BLACK, W = AI.WHITE, E = AI.EMPTY;
var N = 17;
function empty() { return new Array(N * N).fill(E); }
function idx(x, y) { return y * N + x; }
function place(b, x, y, c) { b[idx(x, y)] = c; }
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('PASS: ' + msg);
}

// ---------- 1) 棋型分类 ----------
// 连五
{
  var b = empty();
  for (var i = 0; i < 4; i++) place(b, 5 + i, 7, B);
  var t = AI.threatAt(b, N, idx(9, 7), B);
  assert(t.value === AI.V.FIVE, '成五威胁值应=1000000，实际=' + t.value);
}
// 活四（连续4两端空）
{
  var b = empty();
  for (var i = 0; i < 3; i++) place(b, 5 + i, 7, B);
  var t = AI.threatAt(b, N, idx(8, 7), B);
  assert(t.tier === 7 && t.value === AI.V.LIVE4, '活四威胁值应=100000(tier6)，实际=' + t.value + '/' + t.tier);
}
// 冲四（连续3+一端堵）
{
  var b = empty();
  place(b, 4, 7, W); for (var i = 0; i < 3; i++) place(b, 5 + i, 7, B);
  var t = AI.threatAt(b, N, idx(8, 7), B);
  assert(t.tier === 6 && t.value >= AI.V.RUSH4, '冲四威胁值应=1000(tier5)，实际=' + t.value + '/' + t.tier);
}
// 活三（连续2两端空外侧空）
{
  var b = empty();
  place(b, 6, 7, B); place(b, 7, 7, B);
  var t = AI.threatAt(b, N, idx(8, 7), B);
  assert(t.tier === 4 && t.value >= AI.V.LIVE3, '活三威胁值应=200(tier4)，实际=' + t.value + '/' + t.tier);
}
// 眠三（连续2一端堵）
{
  var b = empty();
  place(b, 5, 7, W); place(b, 6, 7, B); place(b, 7, 7, B);
  var t = AI.threatAt(b, N, idx(8, 7), B);
  assert(t.tier === 3 && t.value >= AI.V.SLEEP3, '眠三威胁值应=50(tier3)，实际=' + t.value + '/' + t.tier);
}
// 活二：二子两端空，下端点形成活三
{
  var b = empty();
  place(b, 6, 7, B); place(b, 7, 7, B);
  var t = AI.threatAt(b, N, idx(8, 7), B);
  assert(t.tier === 4 && t.value >= AI.V.LIVE3, '二子两端空下端点应成活三(200)，实际=' + t.value + '/' + t.tier);
}
// 眠二：二子一端堵，下端点成眠三
{
  var b = empty();
  place(b, 5, 7, W); place(b, 6, 7, B); place(b, 7, 7, B);
  var t = AI.threatAt(b, N, idx(8, 7), B);
  assert(t.tier === 3 && t.value >= AI.V.SLEEP3, '二子一端堵下端点应成眠三(50)，实际=' + t.value + '/' + t.tier);
}
// 三三（双活三）
{
  var b = empty();
  // 横：(6,7)(7,7) + 下(8,7)成横活三；竖：(7,5)(7,6) + 下(7,7)? 不行(7,7)是横落点
  // 让 (7,7) 落点同时成横竖活三：横已有(6,7)(8,7)? 用跳活三
  place(b, 6, 7, B); place(b, 8, 7, B);          // 横跳活三原料 OO_O
  place(b, 7, 5, B); place(b, 7, 6, B);          // 竖 OO
  var t = AI.threatAt(b, N, idx(7, 7), B);        // 下(7,7)：横 OO_O→填缺口，竖 OO→OOO
  console.log('三三测试 下(7,7): value=' + t.value + ' is33=' + t.is33 + ' tier=' + t.tier);
  assert(t.is33, '双活三应判为三三，实际 value=' + t.value);
}
// 四三
{
  var b = empty();
  place(b, 4, 7, W); place(b, 5, 7, B); place(b, 6, 7, B); place(b, 7, 7, B); // 横冲三 OO_O?
  // 冲三：一端堵。横 (5,7)(6,7)(7,7) + 左(4,7)W → 下(8,7)成冲四
  // 竖活三原料：(7,5)(7,6) → 下(7,7)? (7,7)已黑
  var b2 = empty();
  place(b2, 5, 7, W); place(b2, 6, 7, B); place(b2, 7, 7, B); place(b2, 8, 7, B); // 横 OO_O(左堵)
  place(b2, 10, 5, B); place(b2, 10, 6, B);                                      // 竖活二原料
  var t = AI.threatAt(b2, N, idx(10, 7), B);      // 下(10,7)：横 OO_O→?
  console.log('四三测试 下(10,7): value=' + t.value + ' is43=' + t.is43);
}

// ---------- 2) 分层决策 ----------
// L1：己方一步成五（两端都是成五点）
{
  var b = empty();
  for (var i = 0; i < 4; i++) place(b, 5 + i, 7, B);
  var mv = AI.getMove(b, N, B, 100);
  var ok = (mv[0] === 4 && mv[1] === 7) || (mv[0] === 9 && mv[1] === 7);
  assert(ok, 'L1成五：应下(4,7)/(9,7)成五，实际=' + JSON.stringify(mv));
}
// L2：对方活四 → 堵一端
{
  var b = empty();
  for (var i = 0; i < 4; i++) place(b, 5 + i, 7, W);
  var mv = AI.getMove(b, N, B, 100);
  var isEnd = (mv[0] === 4 && mv[1] === 7) || (mv[0] === 9 && mv[1] === 7);
  assert(isEnd, 'L2防活四：应堵(4,7)/(9,7)，实际=' + JSON.stringify(mv));
}
// L3：对方冲四 → 堵唯一空端
{
  var b = empty();
  place(b, 4, 7, B); for (var i = 0; i < 4; i++) place(b, 5 + i, 7, W); // 白四连一端黑堵
  var mv = AI.getMove(b, N, B, 100);
  assert(mv[0] === 9 && mv[1] === 7, 'L3防冲四：应堵(9,7)，实际=' + JSON.stringify(mv));
}
// L6：对方活三 → 堵活三端
{
  var b = empty();
  place(b, 6, 7, W); place(b, 7, 7, W); place(b, 8, 7, W); // 白活三
  var mv = AI.getMove(b, N, B, 100);
  var isEnd = (mv[0] === 5 && mv[1] === 7) || (mv[0] === 9 && mv[1] === 7);
  assert(isEnd, 'L6防活三：应堵(5,7)/(9,7)，实际=' + JSON.stringify(mv));
}
// 开局：AI 先手下中心
{
  var b = empty();
  var mv = AI.getMove(b, N, B, 100);
  assert(mv[0] === 8 && mv[1] === 8, '开局应下中心(8,8)，实际=' + JSON.stringify(mv));
}

// ---------- 3) L4 己方四三 ----------
{
  var b = empty();
  place(b, 7, 7, B); place(b, 8, 7, B);           // 横二连
  place(b, 9, 4, B); place(b, 9, 5, B); place(b, 9, 6, B); // 竖三连(x=9)
  var t = AI.threatAt(b, N, idx(9, 7), B);         // 下(9,7)：横活三 + 竖活四 = 四三
  var mv = AI.getMove(b, N, B, 100);
  assert(t.is43, '下(9,7)应为四三，实际 is43=' + t.is43 + ' value=' + t.value);
  assert(mv[0] === 9 && mv[1] === 7, 'L4四三：应下(9,7)，实际=' + JSON.stringify(mv));
}

// ---------- 4) L8 己方三三 ----------
{
  var b = empty();
  place(b, 6, 7, B); place(b, 8, 7, B);           // 横跳活三原料 OO_O
  place(b, 7, 5, B); place(b, 7, 6, B);           // 竖 OO
  var mv = AI.getMove(b, N, B, 100);
  assert(mv[0] === 7 && mv[1] === 7, 'L8三三：应下(7,7)成双活三，实际=' + JSON.stringify(mv));
}

// ---------- 5) L9 对方潜在三三：能冲四的堵点优先 ----------
{
  var b = empty();
  // 白活三横 (5,7)(6,7)(7,7)，下 (8,7) 或 (4,7) 成白活四
  place(b, 5, 7, W); place(b, 6, 7, W); place(b, 7, 7, W);
  // 白另一个活三潜力：竖 (8,4)(8,5)(8,6)，下 (8,3)? 需与 (8,7) 冲突
  // 让白下 q 成双活三：q=(8,8)? 竖 (8,6)(8,7)? (8,7)空...
  // 简化验证：构造白活三 + AI 有冲四堵点
  place(b, 8, 4, W); place(b, 8, 5, W); place(b, 8, 6, W); // 白竖三连
  place(b, 4, 4, B); place(b, 4, 5, B); place(b, 4, 6, B); // 黑竖三连（AI 可下(4,7)成冲四）
  var mv = AI.getMove(b, N, B, 100);
  console.log('L9三三防守 getMove → ' + JSON.stringify(mv));
  assert(mv[0] === 8 && mv[1] === 7 || mv[0] === 8 && mv[1] === 3 || mv[0] === 4 && mv[1] === 7,
    'L9：应堵白活三端或走冲四堵点，实际=' + JSON.stringify(mv));
}

// ---------- 5b) 敌方双活三：攻防一体堵点（既能堵活三又能成四）优先 ----------
{
  var b = empty();
  // 白两个独立活三：横(5,7)(6,7)(7,7) + 竖(9,3)(9,4)(9,5)
  place(b, 5, 7, W); place(b, 6, 7, W); place(b, 7, 7, W);
  place(b, 9, 3, W); place(b, 9, 4, W); place(b, 9, 5, W);
  // 黑竖三连(4,4)(4,5)(4,6)：AI 下(4,7) 既堵白横活三又成黑竖四连
  place(b, 4, 4, B); place(b, 4, 5, B); place(b, 4, 6, B);
  var mv = AI.getMove(b, N, B, 300);
  var ok = mv[0] === 4 && mv[1] === 7;
  console.log('敌方双活三局面 AI(黑)选择 → ' + JSON.stringify(mv));
  assert(ok, '敌方三三时，应选攻防一体堵点(4,7)（堵活三+成四），实际=' + JSON.stringify(mv));
}

// ---------- 5c) 潜在四三：应直接堵"形成四三的点"，而非跳一格堵"三" ----------
{
  var b = empty();
  // 白横三连(5,7)(6,7)(7,7) + 白竖二连(8,5)(8,6) → 点(8,7) 下白成四三(横活四+竖活三)
  place(b, 5, 7, W); place(b, 6, 7, W); place(b, 7, 7, W);
  place(b, 8, 5, W); place(b, 8, 6, W);
  var t = AI.threatAt(b, N, idx(8, 7), W);
  assert(t.is43, '白下(8,7)应为四三威胁，实际 is43=' + t.is43 + ' value=' + t.value);
  var mv = AI.getMove(b, N, B, 300);
  var ok = mv[0] === 8 && mv[1] === 7;
  console.log('潜在四三局面 AI(黑)选择 → ' + JSON.stringify(mv));
  assert(ok, '应直接堵四三点(8,7)，而非跳一格堵"三"的位置，实际=' + JSON.stringify(mv));
}

// ---------- 5d) 跳活三降级：白下(5,6)的斜"跳活三"因跳子后(8,3)黑堵 → 眠三，故(5,6)非四三；
//  白下(5,3)是活四威胁（竖(5,2)(5,3)(5,4)(5,5)两端空），AI 应堵(5,3)（L6 防一步必胜） ----------
{
  var b = empty();
  [[8,3],[4,4],[9,4],[7,5],[6,6],[7,6],[9,6],[5,7],[6,7],[7,7],[4,8],[5,8],[8,8],[8,9]].forEach(function (p) { place(b, p[0], p[1], B); });
  [[5,2],[5,4],[6,4],[7,4],[8,4],[5,5],[8,5],[8,6],[4,7],[8,7],[7,8],[9,8],[3,9],[9,9]].forEach(function (p) { place(b, p[0], p[1], W); });
  var t = AI.threatAt(b, N, idx(5, 6), W);
  assert(!t.is43, '白下(5,6)跳活三因跳子后(8,3)黑堵应降级为眠三（非四三），实际 is43=' + t.is43 + ' value=' + t.value);
  var t3 = AI.threatAt(b, N, idx(5, 3), W);
  assert(t3.tier === 7, '白下(5,3)应是活四威胁(tier6)，实际 tier=' + t3.tier);
  var mv = AI.getMove(b, N, B, 300);
  // 往后看：白(5,1)是"冲四+做杀"威胁（冲四且后续能成三三），AI 堵(5,1) 后剩余威胁(1000)比堵(5,3)(10000)更小
  var ok = (mv[0] === 5 && mv[1] === 3) || (mv[0] === 5 && mv[1] === 1);
  console.log('跳活三降级场景 AI(黑)选择 → ' + JSON.stringify(mv));
  assert(ok, 'AI 应堵白一步必胜威胁(5,3)活四 或 (5,1)冲四+做杀（L6），实际=' + JSON.stringify(mv));
}

// ---------- 6) 时间控制 ----------
{
  var b = empty();
  place(b, 7, 7, B); place(b, 8, 8, W); place(b, 9, 9, B); place(b, 7, 8, W);
  var t0 = Date.now();
  var mv = AI.getMove(b, N, B, 2500);
  var el = Date.now() - t0;
  console.log('getMove(预算2500ms) 耗时 ' + el + 'ms → ' + JSON.stringify(mv));
  assert(el < 2600, 'AI 单步应 ≤2.5s，实际 ' + el + 'ms');
  assert(mv && mv.length === 2, '应返回合法落子');
}

console.log('--- 冒烟测试结束 ---');
