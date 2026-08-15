/*
 * lineType 系统性审查：构造各种"端外侧被堵/开放"的棋型变体，验证方向棋型判定。
 * 重点：跳子后外侧、连续段外侧是否被正确识别为"堵"（不误判为开放）。
 * 落点统一 (6,7)，水平方向 (+1,0)，黑子向右延伸。
 * 用法：node js/lineType_test_ai.js
 */
'use strict';
var AI = require('./ai.js');
var B = 1, W = 2, E = 0, N = 17;
function empty() { return new Array(N * N).fill(E); }
function i(x, y) { return y * N + x; }
var fails = 0;
function expect(name, b, x, y, dx, dy, color, want) {
  var got = AI.lineType(b, N, x, y, dx, dy, color);
  if (got === want) console.log('PASS: ' + name + ' → ' + got);
  else { console.error('FAIL: ' + name + ' → ' + got + ' (期望 ' + want + ')'); fails++; }
}
// 水平 (dx=1)，落点 (6,7)

// ==== 跳活三 vs 跳眠三（跳子后外侧） ====
// O_OO 落点(6,7)+缺口(7,7)+跳(8,7)(9,7)，跳后(10,7)空 → 活三(LIVE3=4)
{
  var b = empty();
  b[i(8,7)]=B; b[i(9,7)]=B;
  expect('跳活三 O_OO(跳后外侧空)', b, 6,7, 1,0, B, 5);
}
// O_OO 跳后(10,7)白堵 → 眠三(SLEEP3=3)
{
  var b = empty();
  b[i(8,7)]=B; b[i(9,7)]=B; b[i(10,7)]=W;
  expect('跳眠三 O_OO(跳后外侧白堵)', b, 6,7, 1,0, B, 3);
}
// OO_O 落点(6,7)+黑(7,7)连续+缺口(8,7)+跳(9,7)，跳后(10,7)空 → 活三
{
  var b = empty();
  b[i(7,7)]=B; b[i(9,7)]=B;
  expect('跳活三 OO_O(跳后外侧空)', b, 6,7, 1,0, B, 5);
}
{
  var b = empty();
  b[i(7,7)]=B; b[i(9,7)]=B; b[i(10,7)]=W;
  expect('跳眠三 OO_O(跳后外侧白堵)', b, 6,7, 1,0, B, 3);
}

// ==== 连续活三 vs 眠三（3连，端外侧） ====
// OOO 两端空+外侧空 → 活三
{
  var b = empty();
  b[i(7,7)]=B; b[i(8,7)]=B; // 落点(6,7)→OOO，两端(5,7)(9,7)空+外侧(4,7)(10,7)空
  expect('连续活三 _OOO_', b, 6,7, 1,0, B, 4);
}
// X_OOO_ 左端(5,7)空+(4,7)白堵，右端(9,7)空+外侧空 → 填右端成活四 → 活三
{
  var b = empty();
  b[i(4,7)]=W; b[i(7,7)]=B; b[i(8,7)]=B;
  expect('连续活三(左外侧白堵) X_OOO_', b, 6,7, 1,0, B, 4);
}
// X_OOO_X 两端各留1空但外侧都白堵 → 填端只能冲四 → 眠三
{
  var b = empty();
  b[i(4,7)]=W; b[i(7,7)]=B; b[i(8,7)]=B; b[i(10,7)]=W; // 端(5,7)(9,7)空，外侧(4,7)(10,7)白
  expect('两端外侧白堵 X_OOO_X → 眠三', b, 6,7, 1,0, B, 3);
}

// ==== 连续四（两端外侧无关，只紧邻端） ====
// OOOO 两端空 → 活四(LIVE4=6)
{
  var b = empty();
  b[i(7,7)]=B;b[i(8,7)]=B;b[i(9,7)]=B; // 落点(6,7)→OOOO，两端(5,7)(10,7)空
  expect('连续活四 _OOOO_', b, 6,7, 1,0, B, 7);
}
// XOOOO_ 左紧邻(5,7)白 → 冲四(RUSH4=5)
{
  var b = empty();
  b[i(5,7)]=W; b[i(7,7)]=B;b[i(8,7)]=B;b[i(9,7)]=B;
  expect('连续四一端紧邻白堵 XOOOO_ → 冲四', b, 6,7, 1,0, B, 6);
}
// XOOOOX 两端紧邻白 → 死四(NONE=0)
{
  var b = empty();
  b[i(5,7)]=W; b[i(10,7)]=W; b[i(7,7)]=B;b[i(8,7)]=B;b[i(9,7)]=B;
  expect('连续四两端紧邻白堵 XOOOOX → 死四', b, 6,7, 1,0, B, 0);
}

// ==== 连续二活二 vs 眠二（2连，端外侧） ====
// _OO_ 两端空+外侧空 → 活二(LIVE2=2)
{
  var b = empty();
  b[i(7,7)]=B; // 落点(6,7)→OO，两端(5,7)(8,7)空+外侧(4,7)(9,7)空
  expect('活二 _OO_', b, 6,7, 1,0, B, 2);
}
// _ _OO_ X 左端2空+右端(8,7)空但外侧(9,7)白 → 填左端成活三 → 活二
{
  var b = empty();
  b[i(7,7)]=B; b[i(9,7)]=W; // 端(5,7)(8,7)空，左外侧(4,7)空，右外侧(9,7)白
  expect('活二(填左端成活三) __OO_X', b, 6,7, 1,0, B, 2);
}
// X_OO_ 左紧邻(5,7)白，右端(8,7)空 → 填右端成眠三 → 眠二(SLEEP2=1)
{
  var b = empty();
  b[i(5,7)]=W; b[i(7,7)]=B;
  expect('眠二 X_OO_', b, 6,7, 1,0, B, 1);
}
// _OO_X 右端(8,7)空但外侧(9,7)白，左端(5,7)空+外侧(4,7)空 → 填左端(5,7)后3连端(4,7)(8,7)空，填(4,7)成活四 → 活二
{
  var b = empty();
  b[i(7,7)]=B; b[i(9,7)]=W;
  expect('活二(填左端成活三) _OO_X', b, 6,7, 1,0, B, 2);
}

// ==== 双缺口跳棋型（修复：填缺口模拟，不能只看子数 total） ====
// _CC_CC_ 落点(6,7)+两侧各CC隔1空，补任一缺口成4连两端空（活四）→ 活三
{
  var b = empty();
  b[i(3,7)]=B; b[i(4,7)]=B;   // 左 CC
  b[i(8,7)]=B; b[i(9,7)]=B;   // 右 CC（落点(6,7)，缺口(5,7)(7,7)）
  expect('双缺口活三 _CC_CC_', b, 6,7, 1,0, B, 5);
}
// XCC_CCX 两端白堵，补缺口成4连一端堵（冲四）→ 眠三（原实现误判 RUSH4）
{
  var b = empty();
  b[i(2,7)]=W; b[i(3,7)]=B; b[i(4,7)]=B;
  b[i(8,7)]=B; b[i(9,7)]=B; b[i(10,7)]=W;
  expect('双缺口眠三 XCC_CCX', b, 6,7, 1,0, B, 3);
}
// ==== 双缺口成五=活四（2026-08-08 修复：填任一端缺口都能成五连=双冲四=活四） ====
// C_CCC_C 下中心空位：填左缺口(x=5)或右缺口(x=8)都成5连，双独立成五点 → 活四（原误判 RUSH4）
{
  var b = empty();
  b[i(3,7)]=B; b[i(5,7)]=B; b[i(7,7)]=B; b[i(9,7)]=B;   // C_C_C_C，落点(6,7)中心空位
  expect('双缺口成五 C_CCC_C → 活四', b, 6,7, 1,0, B, 7);
}
// 双缺口但填缺口只成4连两端空 → 活三（非活四，回归）
{
  var b = empty();
  b[i(3,7)]=B; b[i(4,7)]=B; b[i(8,7)]=B; b[i(9,7)]=B;   // _CC_CC_（落点6,7）
  expect('双缺口填成4连两端空 → 活三', b, 6,7, 1,0, B, 5);
}
// 单缺口 CC_CC 落缺口 → 直接五连（回归）
{
  var b = empty();
  b[i(3,7)]=B; b[i(4,7)]=B; b[i(6,7)]=B; b[i(7,7)]=B;   // CC_CC（缺口x=5）
  expect('单缺口 CC_CC 落缺口 → 五连', b, 5,7, 1,0, B, 8);
}
// 双方向双缺口活三 → 真三三（原实现两方向都 RUSH4→is44 伪四四）
{
  var b = empty();
  b[i(3,7)]=B; b[i(4,7)]=B; b[i(8,7)]=B; b[i(9,7)]=B;          // 横 _CC_CC_
  b[i(6,3)]=B; b[i(6,4)]=B; b[i(6,8)]=B; b[i(6,9)]=B;          // 竖 _CC_CC_
  var t = AI.threatAt(b, N, i(6,7), B);
  if (!t.is33) { console.error('FAIL: 双缺口双活三应判 is33（修复前伪四四），实际 is33=' + t.is33 + ' is44=' + t.is44 + ' rf=' + t.rf); fails++; }
  else console.log('PASS: 双缺口双活三 is33=true');
}
// 单方向双缺口活三 + 单方向真活三 → 真三三
{
  var b = empty();
  b[i(3,7)]=B; b[i(4,7)]=B; b[i(8,7)]=B; b[i(9,7)]=B;          // 横 _CC_CC_
  b[i(6,4)]=B; b[i(6,5)]=B;                                    // 竖 OO（落点→OOO 两端空）
  var t = AI.threatAt(b, N, i(6,7), B);
  if (!t.is33) { console.error('FAIL: 双缺口活三+连活三应判 is33，实际 is33=' + t.is33 + ' lt=' + t.lt); fails++; }
  else console.log('PASS: 双缺口活三+连活三 is33=true');
}

// ==== 死四（两端堵，该方向威胁=0，不能被误判为冲四） ====
// X OOO _ X：落点填后 4 连两端被敌堵 → 死四（用户反馈：此空位该方向威胁为 0）
{
  var b = empty();
  b[i(2,7)]=W; b[i(3,7)]=B; b[i(4,7)]=B; b[i(5,7)]=B; b[i(7,7)]=W; // X OOO _ X（空位 x=6）
  expect('死四 X_OOO_X 落空位 → 0', b, 6,7, 1,0, B, 0);
}
// 贴边三连 + 落点 → 一端边界一端空/外侧空 → 填一端成活四 → 活三（边界活三正确识别）
{
  var b = empty();
  b[i(8,2)]=B; b[i(8,3)]=B;                                    // 竖 OO（贴顶边），落点(8,1) → OOO
  expect('贴边活三 OOO(顶) → 活三', b, 8,1, 0,1, B, 4);
}

console.log('--- lineType 审查完成，失败 ' + fails + ' ---');
if (fails) process.exitCode = 1;
