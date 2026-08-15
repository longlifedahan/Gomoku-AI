/*
 * 五子棋 AI（按《五子棋AI决策系统规格说明书》v5.3 完整实现）
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 总控：getMove(board, size, color, timeBudgetMs[, trace])      │
 * │   → 严格分层决策树 L1~L13：每层触发即返回（层内用            │
 * │     pickBestBySearch 对候选点深搜选优）；全不触发 → L13 深搜  │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 代码按决策树逻辑分节组织：
 *   一、基础定义        常量 / 威胁值表 V / 棋型等级 / 方向威胁值
 *   二、方向棋型检测     lineType（连续段+跳子缺口模拟）→ 威胁判定地基
 *   三、单点威胁         threatAt（组合杀：四三/四四/三三/双活二）
 *   四、已有威胁/胜负    existingThreat / isWin / hasLiveFour / hasFive
 *   五、候选点与工具     scanRange / focusCells / countStones / centerBonus / dedupe
 *   六、启发式辅助       diagBonus（斜线激励）/ potentialThreat（潜在组合杀）
 *                        / localShapeThreat（局部棋型密度）
 *   七、静态局面评估     evaluateBoard（negamax 叶评估）
 *   八、分层检测         L2~L12 各层检测函数（按决策树执行顺序排列）
 *   九、启发式搜索       genMoves（着法排序）+ negamax（α-β 深搜）+ pickBestBySearch
 *   十、总控             getMove（L1~L13 分层漏斗，决策树主入口）
 *   十一、API 导出
 *
 * 分层决策树执行顺序（trace.layer，从 L0 重新编号）：
 *   L0   己方直接成五          findWinMove
 *   L1   对方活四              findWinPoints + hasLiveFour + findLiveFourEnds
 *   L2   对方冲四              findWinPoints（一步即连五的点）
 *   L3   己方四三/四四         findOwn43_44（伪四三 isFake43 跳过）
 *   L4   己方活四              findOwnLiveFour
 *   L5   己方冲四+做杀          findOwnRush4Kill（冲四 + 半径4潜在四三/四四）
 *   L6   防一步必胜威胁        blockCombined（含"冲四+做杀"向后看，半径4）
 *   L7   防三三攻防一体        findDefendWithRush4
 *   L8   己方三三              findOwn33
 *   L9   己方做杀层            findOwnKillLayer（冲四+半径4三三；活三+半径4四三四四三三）
 *   L10  防潜在三三            blockPotential33（含"活三+做杀"向后看，半径4）
 *   L11  VCF 连续冲四杀        vcfWin
 *   L12  防对方VCF杀           findOppVcfDefense（占对方连续冲四首手）
 *   L13  开局决策层            openingDecision（前7手定式：合并原 L1/L9/L12b）
 *   L14  启发式深搜            genMoves + negamax 迭代加深 1→6（分桶截断仅白棋：第一层cap11、内部cap10；黑棋纯分数）
 *
 * 开局决策层（L13，前7手）：
 *   第1手(黑) 天元
 *   第2手(白) 黑四对角均可下→随机选对角；黑在边界→抢天元
 *   第3手(黑) 白2横/竖→花月（黑3斜）；白2对角→浦月（黑3直）
 *   第4手(白) 防黑双活二 > 防黑活二延伸 > 斜线活二
 *   第5手(黑) 冲活三(不含眠三) > 三活二 > 双活二 > 构建新活二
 *   第6手(白) 防黑冲三(含跳冲三) > 防黑跳活二 > 自己进攻(双活二>冲三>活二)
 *   第7手(黑) 冲活三(不含眠三/不冲四) > 三活二 > 双活二 > 构建新单活二
 *
 * 攻防导向（用户 2026-08-12 定稿）：
 *   执白 = 防守优先（defMul=2.0 重视黑威胁、弱进攻×0.1、堵白正常）
 *   执黑 = 进攻导向（保留进攻价值、堵白降权×0.7 仅"白威胁不占优"且仅 L14 启发层；
 *           攻守转换时黑正常防守围堵，不能丢防守）
 *
 * API：
 *   GomokuAI.getMove(board, size, color, timeBudgetMs[, trace])
 *     - board: 一维数组 idx = y*size+x，0=空 1=AI 2=对手
 *     - timeBudgetMs: 单步时间预算（毫秒），默认 2500
 *     - trace: 可选，回填 { layer, elapsed, depth }
 *   棋盘 N×N（N≥5，项目用 17）。
 */
(function (global) {
  'use strict';

  /* ==================== 一、基础定义 ==================== */

  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];   // 横/竖/两斜（方向扫描）
  var INF = 1000000000;
  var DEFAULT_BUDGET = 2500;

  // 统一威胁值表（2026-08-08 按数量级重设计，强调统一性、避免特例）：
  //   连五(10^6) > 活四/四三/四四(10^5 杀招) > 三三/潜在四三四四(10^5 略低) > 活三(10^4)
  // 链路（用户 2026-08-12）：破坏敌死三 > 己方死三+活二 > 双活二 > 堵死敌死三+活二
  //   > 堵死敌双活二 > 己方死三 > 活二。
  // ⚠ 攻防按"落子动作"区分（允许违反对称性）：进攻=己方构建棋型用进攻端值；
  //   防御=堵死对手已有/潜在威胁用防守端值。
  var V = {
    FIVE: 1000000,   // 连五（10^6）
    LIVE4: 100000,   // 活四（10^5 杀招）
    D43: 80000,      // 四三（杀招略低）
    D44: 80000,      // 四四
    D33: 50000,      // 三三（组合，略低于杀招）
    P_D43: 40000,    // 潜在四三/四四（组合略低）
    P_D44: 40000,
    P_D33: 10000,    // 潜在三三（用户指定，杀棋之一）
    RUSH4: 6000,     // 冲四（略高于活三）
    LIVE3: 3500,     // 活三（连三 OOO）
    LIVE3J: 3000,    // 跳活三（OO_O，填缺口成活四，略低于连三）
    LIVE2: 800,      // 活二·进攻端（己方构建活二）
    LIVE2_DEF: 500,  // 活二·防守端（敌活二威胁，破坏它的价值）
    SLEEP3: 900,     // 死三·进攻端（己方构建死三，性价比高）
    SLEEP3_DEF: 2000, // 死三·防守端（敌死三威胁，破坏现有死三价值最高）
    SLEEP2: 25,      // 死二（10^1）
    NONE: 0
  };
  // 方向棋型等级
  var T_NONE = 0, T_SLEEP2 = 1, T_LIVE2 = 2, T_SLEEP3 = 3, T_LIVE3 = 4,
      T_LIVE3J = 5, T_RUSH4 = 6, T_LIVE4 = 7, T_FIVE = 8;
  // 方向等级 → 威胁值。进攻端（己方落子）用 T_VAL_ATK；评估对手威胁/堵对方用 T_VAL_DEF。
  var T_VAL_ATK = [0, V.SLEEP2, V.LIVE2, V.SLEEP3, V.LIVE3, V.LIVE3J, V.RUSH4, V.LIVE4, V.FIVE];
  var T_VAL_DEF = [0, V.SLEEP2, V.LIVE2_DEF, V.SLEEP3_DEF, V.LIVE3, V.LIVE3J, V.RUSH4, V.LIVE4, V.FIVE];

  // 坐标是否在棋盘内（越界判断）——所有扫描/落子的前置校验
  function inB(x, y, N) { return x >= 0 && x < N && y >= 0 && y < N; }

  /* ==================== 二、方向棋型检测（威胁判定地基） ==================== */

  // 缓存所有线（每行/每列/两条对角线），供 hasLiveFour / findLiveFourEnds 连续段扫描
  var _linesCache = {};
  function getLines(N) {
    if (_linesCache[N]) return _linesCache[N];
    var lines = [], i, j, d, s;
    for (i = 0; i < N; i++) {
      var row = [], col = [];
      for (j = 0; j < N; j++) { row.push(i * N + j); col.push(j * N + i); }
      lines.push(row, col);
    }
    for (d = -(N - 1); d <= N - 1; d++) {
      var l = [];
      for (j = 0; j < N; j++) { var y = j - d; if (y >= 0 && y < N) l.push(y * N + j); }
      if (l.length >= 5) lines.push(l);
    }
    for (s = 0; s <= 2 * N - 2; s++) {
      var l2 = [];
      for (j = 0; j < N; j++) { var y2 = s - j; if (y2 >= 0 && y2 < N) l2.push(y2 * N + j); }
      if (l2.length >= 5) lines.push(l2);
    }
    _linesCache[N] = lines;
    return lines;
  }

  // 方向棋型检测：(x,y) 假设已放 color，返回该方向形成的棋型等级 0..7（T_NONE..T_FIVE）。
  // 全 AI 威胁判定的地基：threatAt、diagBonus、potentialThreat、evaluateBoard 全经由它。
  // 核心逻辑：连续段 + 端外侧空判定基础等级，再用"填一个缺口（跳子）"模拟提升等级。
  // ⚠ 踩坑记录：跳子误判（OO_OO vs XCC_CCX 填缺结果不同）、双缺口成五=活四
  //   （C_CCC_C 双独立成五点）、跳活三需跳子后外侧也空（2026-08-07/08 修复）。
  function lineType(board, N, x, y, dx, dy, color) {
    var fwd = 0, bwd = 0, i, px, py;
    // 正向连续
    for (i = 1; ; i++) {
      px = x + dx * i; py = y + dy * i;
      if (!inB(px, py, N) || board[py * N + px] !== color) break;
      fwd = i;
    }
    // 反向连续
    for (i = 1; ; i++) {
      px = x - dx * i; py = y - dy * i;
      if (!inB(px, py, N) || board[py * N + px] !== color) break;
      bwd = i;
    }
    var cnt = 1 + fwd + bwd;
    // 端位置与端空判定
    var ax = x + dx * (fwd + 1), ay = y + dy * (fwd + 1);
    var bx = x - dx * (bwd + 1), by = y - dy * (bwd + 1);
    var aEmpty = inB(ax, ay, N) && board[ay * N + ax] === EMPTY;
    var bEmpty = inB(bx, by, N) && board[by * N + bx] === EMPTY;
    // 端外侧（决定能否成活四）
    var a2Empty = aEmpty && inB(ax + dx, ay + dy, N) && board[(ay + dy) * N + (ax + dx)] === EMPTY;
    var b2Empty = bEmpty && inB(bx - dx, by - dy, N) && board[(by - dy) * N + (bx - dx)] === EMPTY;
    // 端外侧跳子（同色），并记录跳子段外侧是否空（决定跳活三/跳眠三）
    var fJump = 0, bJump = 0, fOuterEmpty = false, bOuterEmpty = false;
    if (aEmpty) {
      var jx = ax + dx, jy = ay + dy;
      if (inB(jx, jy, N) && board[jy * N + jx] === color) {
        while (inB(jx, jy, N) && board[jy * N + jx] === color) { fJump++; jx += dx; jy += dy; }
        fOuterEmpty = inB(jx, jy, N) && board[jy * N + jx] === EMPTY;
      }
    }
    if (bEmpty) {
      var kx = bx - dx, ky = by - dy;
      if (inB(kx, ky, N) && board[ky * N + kx] === color) {
        while (inB(kx, ky, N) && board[ky * N + kx] === color) { bJump++; kx -= dx; ky -= dy; }
        bOuterEmpty = inB(kx, ky, N) && board[ky * N + kx] === EMPTY;
      }
    }
    // 当前连续段（无缺口）基础等级
    var best = T_NONE;
    if (cnt >= 5) return T_FIVE;
    if (cnt === 4) {
      if (aEmpty && bEmpty) best = T_LIVE4;
      else if (aEmpty || bEmpty) best = T_RUSH4;
      // 死四：无等级
    } else if (cnt === 3) {
      // 活三：两端空且一端外侧也空 → 填该端成活四（else-if 链避免被"两端空外侧堵→眠三"覆盖）
      if (aEmpty && a2Empty && bEmpty) best = T_LIVE3;
      else if (bEmpty && b2Empty && aEmpty) best = T_LIVE3;
      // 眠三：填一端能成冲四（该端外侧空 + 另一端堵），或两端空但外侧均堵
      else if (aEmpty && a2Empty && !bEmpty) best = T_SLEEP3;
      else if (bEmpty && b2Empty && !aEmpty) best = T_SLEEP3;
      else if (aEmpty && bEmpty) best = T_SLEEP3;
    } else if (cnt === 2) {
      if (aEmpty && a2Empty && bEmpty) best = T_LIVE2;
      else if (bEmpty && b2Empty && aEmpty) best = T_LIVE2;
      else if (aEmpty || bEmpty) best = T_SLEEP2;
    } else if (cnt === 1) {
      if (aEmpty || bEmpty) best = T_SLEEP2; // 单子有延伸算极弱
    }

    // 带缺口棋型（跳子）：模拟"填一个缺口"（一手）后的连续段等级。
    // 不能只看子数 total：OO_OO(填缺成五→冲四) 与 _CC_CC_(填缺成活四→活三)、
    // XCC_CCX(填缺成冲四→眠三) 结果不同，原实现一律 RUSH4 会把活三/眠三误判为冲四。
    function grade(len2, fEmpty, bEmpty2) {
      if (len2 >= 5) return T_RUSH4;              // 填1手成五连 → 冲四形
      if (len2 === 4) {
        if (fEmpty && bEmpty2) return T_LIVE3J;   // 填缺口成4连两端空（活四）→ 跳活三
        if (fEmpty || bEmpty2) return T_SLEEP3;   // 填1手成冲四 → 眠三
        return T_NONE;
      }
      if (len2 === 3) {
        if (fEmpty && bEmpty2) return T_LIVE2;
        if (fEmpty || bEmpty2) return T_SLEEP2;
        return T_NONE;
      }
      return T_NONE;
    }
    // 双缺口棋型：若填任一端缺口都能成五连（两端各有独立成五点），即双冲四=活四
    // （对手无法同时防两个点），如 C_CCC_C 下中心空位。原 grade 只判 RUSH4，严重低估。
    if (fJump > 0 && bJump > 0 && (cnt + fJump + 1) >= 5 && (cnt + bJump + 1) >= 5) {
      best = T_LIVE4;
    }
    // 填 fwd 缺口：连续段 = 落点连续段 + 跳子段 + 缺口本身；
    // 另侧若还有跳子则外侧视为空（缺口隔离），否则看连续段原端空状态
    if (fJump > 0) {
      var lenF = cnt + fJump + 1;
      var gF = grade(lenF, fOuterEmpty, (bJump > 0) ? true : bEmpty);
      if (gF > best) best = gF;
    }
    if (bJump > 0) {
      var lenB = cnt + bJump + 1;
      var gB = grade(lenB, (fJump > 0) ? true : aEmpty, bOuterEmpty);
      if (gB > best) best = gB;
    }
    return best;
  }

  /* ==================== 三、单点威胁（含组合杀棋，规格 3.9） ==================== */

  // 返回 { value, tier, lf, rf, lt, l2, is43, is44, is33 }
  // 假设 idx 已放 color，统计四方向 lineType 并按组合杀棋合成：
  //   lf=活四方向数, rf=冲四方向数, lt=活三方向数, l2=活二方向数
  //   is43=四三(四≥1 且活三≥1)  is44=四四(四≥2)  is33=三三(活三≥2 且无四)
  // 优先级：连五 > 单活四 > 四三 > 四四 > 活四 > 三三 > 单方向最高（四方向累加）。
  // perspective='def' 时死三/活二取防守端值（评估对手威胁/堵对方）；默认进攻端。
  function threatAt(board, N, idx, color, perspective) {
    var x = idx % N, y = (idx / N) | 0;
    var lf = 0, rf = 0, lt = 0, l2 = 0, k, maxTier = 0, tiers = [];
    for (k = 0; k < 4; k++) {
      var t = lineType(board, N, x, y, DIRS[k][0], DIRS[k][1], color);
      tiers.push(t);
      if (t > maxTier) maxTier = t;
      if (t === T_LIVE4) lf++;
      else if (t === T_RUSH4) rf++;
      else if (t === T_LIVE3 || t === T_LIVE3J) lt++;
      else if (t === T_LIVE2) l2++;
    }
    if (maxTier === T_FIVE) return { value: V.FIVE, tier: T_FIVE, lf: lf, rf: rf, lt: lt, l2: l2, is43: false, is44: false, is33: false };
    var four = lf + rf;
    var is43 = four >= 1 && lt >= 1;
    var is44 = four >= 2;
    var is33 = lt >= 2 && four === 0;
    // 单活四：活四≥1 且不满足四三/四四（规格优先级：单活四 > 四三 > 四四 > 三三）
    if (lf >= 1 && !is43 && !is44) return { value: V.LIVE4, tier: T_LIVE4, lf: lf, rf: rf, lt: lt, l2: l2, is43: false, is44: false, is33: false };
    if (is43) return { value: V.D43, tier: Math.max(T_LIVE3, T_LIVE3J, T_RUSH4), lf: lf, rf: rf, lt: lt, l2: l2, is43: true, is44: false, is33: false };
    if (is44) return { value: V.D44, tier: Math.max(T_LIVE3, T_LIVE3J, T_RUSH4), lf: lf, rf: rf, lt: lt, l2: l2, is43: false, is44: true, is33: false };
    if (lf >= 1) return { value: V.LIVE4, tier: T_LIVE4, lf: lf, rf: rf, lt: lt, l2: l2, is43: false, is44: false, is33: false };
    if (is33) return { value: V.D33, tier: maxTier, lf: lf, rf: rf, lt: lt, l2: l2, is43: false, is44: false, is33: true };
    // 无组合杀：综合各方向威胁（统一累加，让"活三+活二/双活二"价值自然体现）
    var tvals = perspective === 'def' ? T_VAL_DEF : T_VAL_ATK;
    var vSum = tvals[tiers[0]] + tvals[tiers[1]] + tvals[tiers[2]] + tvals[tiers[3]];
    return { value: vSum, tier: maxTier, lf: lf, rf: rf, lt: lt, l2: l2, is43: false, is44: false, is33: false };
  }

  /* ==================== 四、已有威胁 / 胜负检测 ==================== */

  // 检测某方棋盘上"已有"的活三/死三/活二等威胁总值（防守端值）。
  // 与 threatAt（落点潜力）互补：直接扫描已形成的连续段，用于"破坏对手现有死三/活二"评估
  // （用户 2026-08-12：无进攻机会时着重检测敌方威胁并率先防御）。
  // ⚠ 只统计连续段（不含跳棋型如 OO_O），近似足够；五连由胜负检测处理。
  function existingThreat(board, N, color) {
    var total = 0, y, x, k;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      if (board[y * N + x] !== color) continue;
      for (k = 0; k < 4; k++) {
        var dx = DIRS[k][0], dy = DIRS[k][1];
        // 只从段首开始计数，避免重复统计同一条线
        var px = x - dx, py = y - dy;
        if (inB(px, py, N) && board[py * N + px] === color) continue;
        var cnt = 1, ex = x + dx, ey = y + dy;
        while (inB(ex, ey, N) && board[ey * N + ex] === color) { cnt++; ex += dx; ey += dy; }
        if (cnt >= 5) continue;  // 已五连，胜负检测处理
        var a = inB(px, py, N) ? board[py * N + px] : -1;   // 段首外侧（-1=边界）
        var b = inB(ex, ey, N) ? board[ey * N + ex] : -1;   // 段尾外侧
        var openA = (a === EMPTY), openB = (b === EMPTY);
        if (cnt === 4) {
          if (openA && openB) total += V.LIVE4;
          else if (openA || openB) total += V.RUSH4;
        } else if (cnt === 3) {
          if (openA && openB) total += V.LIVE3;
          else if (openA || openB) total += V.SLEEP3_DEF;   // 死三（一端堵）
        } else if (cnt === 2) {
          if (openA && openB) total += V.LIVE2_DEF;          // 活二（两端空）
          else if (openA || openB) total += V.SLEEP2;
        }
      }
    }
    return total;
  }

  // 胜负检测：假设 idx 已放 color，判定是否成五连。
  // 供 L2（己方成五）、L3/L4（对方一步连五即 findWinPoints）、negamax 剪枝（lastIdx 落子后判负）使用。
  function isWin(board, N, idx, color) {
    var x = idx % N, y = (idx / N) | 0, k, s;
    for (k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1], cnt = 1;
      for (s = 1; s < 5; s++) {
        var nx = x + dx * s, ny = y + dy * s;
        if (!inB(nx, ny, N) || board[ny * N + nx] !== color) break;
        cnt++;
      }
      for (s = 1; s < 5; s++) {
        var nx2 = x - dx * s, ny2 = y - dy * s;
        if (!inB(nx2, ny2, N) || board[ny2 * N + nx2] !== color) break;
        cnt++;
      }
      if (cnt >= 5) return true;
    }
    return false;
  }

  // 棋盘上是否已有某方的活四（连续4两端空）——L3 判定"对方活四必须应对"、evaluateBoard 快判
  function hasLiveFour(board, N, color) {
    var lines = getLines(N), L, i, j;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i]; L = line.length;
      for (j = 0; j + 4 < L; j++) {
        if (board[line[j]] !== color) continue;
        var run = 1, k = j + 1;
        while (k < L && board[line[k]] === color) { run++; k++; }
        if (run === 4 && j > 0 && board[line[j - 1]] === EMPTY && k < L && board[line[k]] === EMPTY) return true;
        if (run >= 5) return true; // 已有五连（更强）
        j = k - 1;
      }
    }
    return false;
  }

  // 是否已有某方五连（evaluateBoard 快速胜负检查用）
  function hasFive(board, N, color) {
    var n = N * N, i, j;
    for (i = 0; i < n; i++) {
      if (board[i] !== color) continue;
      var x = i % N, y = (i / N) | 0, k, s;
      for (k = 0; k < 4; k++) {
        var dx = DIRS[k][0], dy = DIRS[k][1], cnt = 1;
        for (s = 1; s < 5; s++) {
          var nx = x + dx * s, ny = y + dy * s;
          if (!inB(nx, ny, N) || board[ny * N + nx] !== color) break;
          cnt++;
        }
        for (s = 1; s < 5; s++) {
          var nx2 = x - dx * s, ny2 = y - dy * s;
          if (!inB(nx2, ny2, N) || board[ny2 * N + nx2] !== color) break;
          cnt++;
        }
        if (cnt >= 5) return true;
      }
    }
    return false;
  }

  /* ==================== 五、候选点与工具 ==================== */

  // 距离任意棋子曼哈顿距离 ≤ dist 的空位（规格5/7.3）。全空返回中心。
  // 返回 { cands:[...], stones }。stones 用于判断开局阶段（<6/<8/<10）的激励。
  var _rangeMark = new Int32Array(625);
  var _rangeGen = 1;
  function scanRange(board, N, dist) {
    _rangeGen = (_rangeGen + 1) | 0;
    if (_rangeGen === 0) _rangeGen = 1;
    var n = N * N, i, stones = 0, idx;
    var hasStone = false;
    for (i = 0; i < n; i++) if (board[i] !== EMPTY) { hasStone = true; break; }
    if (!hasStone) { var c = (N / 2) | 0; return { cands: [c * N + c], stones: 0 }; }
    var res = [];
    for (i = 0; i < n; i++) {
      if (board[i] === EMPTY) continue;
      stones++;
      var x = i % N, y = (i / N) | 0;
      for (var dy = -dist; dy <= dist; dy++) {
        var ny = y + dy; if (ny < 0 || ny >= N) continue;
        var rem = dist - (dy < 0 ? -dy : dy);
        for (var dx = -rem; dx <= rem; dx++) {
          var nx = x + dx; if (nx < 0 || nx >= N) continue;
          var ni = ny * N + nx;
          if (board[ni] === EMPTY && _rangeMark[ni] !== _rangeGen) {
            _rangeMark[ni] = _rangeGen;
            res.push(ni);
          }
        }
      }
    }
    return { cands: res, stones: stones };
  }

  // 候选点范围（规格7.3 着法生成）：曼哈顿距离≤2 的空位；全空 → 中心点。
  // 所有分层检测与启发式搜索的候选来源。
  function focusCells(board, N) {
    return scanRange(board, N, 2);
  }

  // 棋盘已有子数（开局进攻层判定 <8、evaluateBoard 判定扫描范围）
  function countStones(board, N) {
    var n = N * N, c = 0, i;
    for (i = 0; i < n; i++) if (board[i] !== EMPTY) c++;
    return c;
  }

  // 中心度与连通长度奖励（规格5.微弱偏差）
  // 用户 2026-08-08：中心度是人为主观经验，仅执黑前两手(<4子)/执白前三手(<6子)生效；
  // 连通长度是棋理（连子优势），所有局面保留。
  function centerBonus(board, N, color) {
    var half = N / 2, sum = 0, n = N * N, i;
    var stones = countStones(board, N);
    var early = (color === BLACK) ? (stones < 4) : (stones < 6);
    for (i = 0; i < n; i++) {
      if (board[i] !== color) continue;
      var x = i % N, y = (i / N) | 0;
      var d = Math.max(Math.abs(x - half), Math.abs(y - half));
      if (early) sum += (half - d) * 2; // 中心度奖励（仅极早）
      var k, s;
      for (k = 0; k < 4; k++) {
        var dx = DIRS[k][0], dy = DIRS[k][1], len = 1;
        for (s = 1; ; s++) {
          var nx = x + dx * s, ny = y + dy * s;
          if (inB(nx, ny, N) && board[ny * N + nx] === color) len++; else break;
        }
        for (s = 1; ; s++) {
          var nx2 = x - dx * s, ny2 = y - dy * s;
          if (inB(nx2, ny2, N) && board[ny2 * N + nx2] === color) len++; else break;
        }
        sum += (len - 1) * 2; // 连通长度每延伸1子加2分（棋理，保留）
      }
    }
    return sum;
  }

  // 通用：数组去重（保留≥0 且首次出现），供 findLiveFourEnds 等返回的候选点去重
  function dedupe(arr) {
    var seen = {}, out = [], i;
    for (i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v >= 0 && !seen[v]) { seen[v] = 1; out.push(v); }
    }
    return out;
  }

  /* ==================== 六、启发式评估辅助 ==================== */

  // 斜线激励（仅极早生效，见 getMove L12b 与 genMoves stones<4 分支）：
  // 用户 2026-08-08 要求"前两手必须走对角"——只统计斜线方向真正形成活二及以上（LIVE2+）
  // 的威胁加权；孤立单子的眠二不计，避免"所有候选都加权"导致强制斜线失效。
  function diagBonus(board, N, idx, color) {
    var x = idx % N, y = (idx / N) | 0, s = 0, k;
    for (k = 2; k < 4; k++) {
      var t = lineType(board, N, x, y, DIRS[k][0], DIRS[k][1], color);
      if (t >= T_LIVE2) s += T_VAL_ATK[t];
    }
    return s;
  }

  // 潜在组合杀（规格 3.9 / 威胁值表 P_D43/P_D44/P_D33）：
  // 假设 idx 已放 color，检查其附近 radius 格内是否存在空位 q，使下一步在 q 落 color
  // 能直接形成四三/四四（→P_D43）或三三（→P_D33）。
  // 供 genMoves 着法排序与 evaluateBoard 叶评估检测"落子后的后续杀势"（默认半径2）；
  // L7/L11 及做杀层（L6b/L10b）用半径4——做杀链可在更远距离形成，需扩大检测范围
  // （用户 2026-08-12）。
  // ⚠ 只保留"下一步能形成必胜"的精确判定：活四/四三/四四（→P_D43）、三三（→P_D33）。
  //   曾误判"双活二下一步成双三必胜"加 200 分，被用户否定（双活二≠必胜）后删除。
  function potentialThreat(board, N, idx, color, radius, strict) {
    var r = (typeof radius === 'number' && radius >= 1) ? radius : 2;
    var x = idx % N, y = (idx / N) | 0;
    var x0 = x > r ? x - r : 0, x1 = x + r < N ? x + r : N - 1;
    var y0 = y > r ? y - r : 0, y1 = y + r < N ? y + r : N - 1;
    board[idx] = color; // 临时落子（threatAt 假设落点已放）
    var res = 0, yy, xx, q;
    for (yy = y0; yy <= y1; yy++) {
      for (xx = x0; xx <= x1; xx++) {
        q = yy * N + xx;
        if (board[q] !== EMPTY) continue;
        // 性能优化：q 的 8 邻域无己方子 → 补子为孤立子，不可能形成组合杀，直接跳过
        var qx = xx, qy = yy, hasN = false;
        for (var di = -1; di <= 1 && !hasN; di++) {
          for (var dj = -1; dj <= 1 && !hasN; dj++) {
            if (di === 0 && dj === 0) continue;
            var nxx = qx + dj, nyy = qy + di;
            if (nxx >= 0 && nxx < N && nyy >= 0 && nyy < N && board[nyy * N + nxx] === color) hasN = true;
          }
        }
        if (!hasN) continue;
        // ⚠ strict 模式（用户 2026-08-12）：冲四做杀必须是"原本没有做杀，下了 P 之后出现做杀"
        //   才能判定为潜在做杀——落 P 前 q 若已能成组合杀（四三/四四/三三），说明该做杀原本就存在、
        //   与落 P 无关 → 跳过。仅 L6 冲四+做杀收集用 strict；其余调用保持原语义（原本做杀也算）。
        if (strict) {
          board[idx] = EMPTY;
          var t0 = threatAt(board, N, q, color);
          if (t0.is43 || t0.is44 || t0.is33) { board[idx] = color; continue; }
          board[idx] = color;
        }
        var t = threatAt(board, N, q, color);
        if (t.is43 || t.is44) { res = V.P_D43; yy = y1 + 1; break; }
        if (t.is33 && res < V.P_D33) res = V.P_D33;
      }
    }
    board[idx] = EMPTY;
    return res;
  }

  // 局部棋型威胁密度：统计 idx 附近（曼哈顿≤2）color 方落空点能形成的活二/眠三/眠二/活三/冲四
  // 累加。反映"小区域内大量棋型"的做杀潜力——某点附近对方棋型密集则危险，应优先占/堵
  // （用户 2026-08-12：无论黑白都应考虑小区域棋型累加；执白防御参数更高）。
  function localShapeThreat(board, N, idx, color) {
    var x = idx % N, y = (idx / N) | 0;
    var x0 = x > 2 ? x - 2 : 0, x1 = x + 2 < N ? x + 2 : N - 1;
    var y0 = y > 2 ? y - 2 : 0, y1 = y + 2 < N ? y + 2 : N - 1;
    var total = 0, yy, xx, q;
    for (yy = y0; yy <= y1; yy++) for (xx = x0; xx <= x1; xx++) {
      q = yy * N + xx;
      if (board[q] !== EMPTY) continue;
      var t = threatAt(board, N, q, color, 'def');
      if (t.tier === T_LIVE3 || t.tier === T_LIVE3J) total += V.LIVE3;
      else if (t.tier === T_RUSH4) total += V.RUSH4;
      else if (t.tier === T_LIVE2) total += V.LIVE2_DEF;
      else if (t.tier === T_SLEEP3) total += V.SLEEP3_DEF;
      else if (t.tier === T_SLEEP2) total += V.SLEEP2;
    }
    return total;
  }

  /* ==================== 七、静态局面评估（规格第5节） ==================== */

  // negamax 到达 depth<=0 时的叶评估。快速胜负（连五/活四）→ 威胁累积扫描
  // （每个候选点 threatAt 差 + localShapeThreat 差 + potentialThreat 差）
  // → 敌方已有威胁扣减、己方已有棋型加分 → |分|<500 补中心度+连通长度。
  // 分数从 color 视角（越高越有利）。
  // ⚠ applyLst=true 仅 L13 启发式层（顶层 genMoves 传入）；强制层深搜传 false，
  //   避免局部棋型密度/黑堵白降权干扰强制层多候选选点（第21手回归点）。
  function evaluateBoard(board, N, color, applyLst) {
    var opp = color === BLACK ? WHITE : BLACK;
    // 快速胜负检查
    if (hasFive(board, N, color)) return V.FIVE;
    if (hasFive(board, N, opp)) return -V.FIVE;
    if (hasLiveFour(board, N, color)) return V.LIVE4;
    if (hasLiveFour(board, N, opp)) return -V.LIVE4;
    // 威胁累积扫描：棋子树<10 → 曼哈顿≤3，否则≤2
    var stones = countStones(board, N);
    var range = scanRange(board, N, stones < 10 ? 3 : 2);
    var score = 0, i, cands = range.cands;
    // 攻防导向（用户 2026-08-12）：
    //   白 → defMul=2.0 重视黑威胁（防守优先）
    //   黑 → 堵白评估降权×0.7 仅"白威胁不占优"（黑主动进攻阶段）且 L13 启发层（applyLst）生效；
    //        ⚠ 攻守转换（白威胁占优，oppThreat>黑最高进攻×2）时黑 defMul=1.0 正常防守围堵
    var defMul = color === WHITE ? 2.0 : 1.0;
    if (color === BLACK && applyLst) {
      var mx = 0;
      for (var mi = 0; mi < cands.length; mi++) {
        var vv = threatAt(board, N, cands[mi], color).value;
        if (vv > mx) mx = vv;
      }
      // 用户 2026-08-14：AI 执黑前 9 手（黑落子 ≤5 次）不进行攻守转换——强制进攻（defMul=0.7），
      //   第 9 手后才按"白威胁 > 黑进攻×8"判断是否转防守。
      if (countStones(board, N) <= 9) defMul = 0.7;
      else if (!(existingThreat(board, N, opp) > mx * 8)) defMul = 0.7;
    }
    // 局部棋型密度权重（用户 2026-08-12）：黑白对称考虑，执白防御参数更高。
    // ⚠ 仅 applyLst 时生效；wShape=0 时跳过调用，避免 localShapeThreat 计算开销影响深搜时序。
    var wShape = applyLst ? (color === WHITE ? 0.3 : 0.15) : 0;
    for (i = 0; i < cands.length; i++) {
      var idx = cands[i];
      var tMe = threatAt(board, N, idx, color);
      var tOp = threatAt(board, N, idx, opp, 'def');
      score += tMe.value - tOp.value * defMul;
      // 复合棋型负项（黑白对称，用户 2026-08-14 修正原"仅执白"不对称）：对方落点后
      // 活三 lt + 活二汇聚，能多方向连续做杀，应优先堵这种棋型汇聚点。权重按 defMul 缩放：
      // 执白防御高（×2.0）、执黑进攻阶段轻防守（×0.7）、黑攻守转换时正常（×1.0）。
      // 活二用 live2Value 加权区分连/跳（斜连活二=2 更凶、斜跳=1.25、横竖=1），
      // 替代 tOp.l2 等权计数（歧义点4：跳活二缺口价值低于连续活二）。
      score -= (tOp.lt * 1500 + live2Value(board, N, idx, opp) * 300) * defMul;
      // 局部棋型威胁密度：idx 是空位，对方在该点附近大量活二/眠三/眠二汇聚是潜在多步杀，
      // 占据 idx 即消除该点做杀潜力，故评估中扣减（黑白对称，仅 applyLst 时）。
      if (wShape) score -= localShapeThreat(board, N, idx, opp) * wShape;
      // 潜在组合杀（下一步可成四三/四四/三三）纳入叶评估
      score += potentialThreat(board, N, idx, color) - potentialThreat(board, N, idx, opp) * defMul;
    }
    // 敌方"已有"死三/活二威胁：减去其威胁值（与 tOp 落点潜力互补——已有死三是紧急威胁）
    score -= existingThreat(board, N, opp) * defMul;
    // 己方"已有"棋型威胁正项：修复评估不对称（原只扣敌不加己方），让己方构建活二等
    // 棋型的价值被正确评估（执黑开局进攻导向的基础）。
    score += existingThreat(board, N, color);
    // 微弱偏差修正（|分|<500 时）
    if (Math.abs(score) < 500) {
      score += centerBonus(board, N, color) - centerBonus(board, N, opp);
    }
    return score;
  }

  /* ==================== 八、分层检测（按决策树 L2~L12 执行顺序） ==================== */

  // 【L2】己方直接成五：扫所有候选点，落子即五连则返回（最高优先级，必胜必走）
  function findWinMove(board, N, color) {
    var focus = focusCells(board, N).cands, i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      board[idx] = color;
      var won = isWin(board, N, idx, color);
      board[idx] = EMPTY;
      if (won) return idx;
    }
    return -1;
  }

  // 【L3/L4 辅助】找某方"一步即能连五"的空位点（活四两端 / 冲四空端 / 跳四缺口）。
  // L3（对方活四）与 L4（对方冲四）的候选来源：只要对方在这些点落子即成五，AI 必须应对。
  function findWinPoints(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      board[idx] = color;
      if (isWin(board, N, idx, color)) pts.push(idx);
      board[idx] = EMPTY;
    }
    return pts;
  }

  // 【L3 辅助】找某方活四的两端空位（连续4两端空 → 两端都是"一步成五"的必堵点）
  function findLiveFourEnds(board, N, color) {
    var ends = [], lines = getLines(N), i, j, L;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i]; L = line.length;
      for (j = 0; j + 4 < L; j++) {
        if (board[line[j]] !== color) continue;
        var run = 1, k = j + 1;
        while (k < L && board[line[k]] === color) { run++; k++; }
        if (run === 4 && j > 0 && board[line[j - 1]] === EMPTY && k < L && board[line[k]] === EMPTY) {
          ends.push(line[j - 1], line[k]);
        }
        j = k - 1;
      }
    }
    return dedupe(ends);
  }

  // 【L5 辅助】找连续冲四（四连一端堵）的开放空端；非连续四连（跳冲四）返回 -1。
  function rush4OpenEnd(board, N, idx, color, dx, dy) {
    var x = idx % N, y = (idx / N) | 0;
    var bx = x, by = y;
    while (inB(bx - dx, by - dy, N) && board[(by - dy) * N + (bx - dx)] === color) { bx -= dx; by -= dy; }
    var ex = x, ey = y;
    while (inB(ex + dx, ey + dy, N) && board[(ey + dy) * N + (ex + dx)] === color) { ex += dx; ey += dy; }
    var len = Math.abs(ex - bx) + Math.abs(ey - by) + 1;
    if (len !== 4) return -1;   // 非连续四连
    var bO = inB(bx - dx, by - dy, N) && board[(by - dy) * N + (bx - dx)] === EMPTY;
    var eO = inB(ex + dx, ey + dy, N) && board[(ey + dy) * N + (ex + dx)] === EMPTY;
    if (bO && !eO) return (bx - dx) + (by - dy) * N;   // 空端在段首
    if (eO && !bO) return (ex + dx) + (ey + dy) * N;   // 空端在段尾
    return -1;
  }

  // 冲四方向"跳缺口"空位收集（用户 2026-08-14 方案A）：四连中间的空格（两侧同色夹着）。
  // 白占缺口 → 黑四连被拆断 + 可能形成白反杀。原 isFake43 只检连续冲四空端
  // （rush4OpenEnd 对跳冲四返回 -1），跳缺口完全漏检——"中间空点是白四三杀点"即此缺陷。
  function collectJumpGap(board, N, idx, color, dx, dy, out) {
    var x = idx % N, y = (idx / N) | 0;
    for (var s = -3; s <= 3; s++) {
      var nx = x + dx * s, ny = y + dy * s;
      if (!inB(nx, ny, N) || board[ny * N + nx] !== EMPTY) continue;
      var px = nx - dx, py = ny - dy, qx = nx + dx, qy = ny + dy;
      if (inB(px, py, N) && inB(qx, qy, N) &&
          board[py * N + px] === color && board[qy * N + qx] === color) out.push(ny * N + nx);
    }
  }

  // 活三方向两端空位收集（用户 2026-08-14 方案B）：白占活三一端 → 黑活三被堵 + 可能白威胁。
  function collectLive3Ends(board, N, idx, color, dx, dy, out) {
    var x = idx % N, y = (idx / N) | 0;
    var ax = x + dx, ay = y + dy, bx = x - dx, by = y - dy;
    if (inB(ax, ay, N) && board[ay * N + ax] === EMPTY) out.push(ay * N + ax);
    if (inB(bx, by, N) && board[by * N + bx] === EMPTY) out.push(by * N + bx);
  }

  // 白落 w 是否形成"必胜反杀"：is43/is44/活四（一步必胜），或冲四+对手另有活三（四三反杀）。
  function oppKillAt(board, N, w, opp) {
    var tW = threatAt(board, N, w, opp, 'def');
    if (tW.is43 || tW.is44 || tW.tier === T_LIVE4) return true;
    if (tW.tier === T_RUSH4) {
      var focus = focusCells(board, N).cands, i;
      for (i = 0; i < focus.length; i++) {
        var r = focus[i];
        if (r === w) continue;
        var tt = threatAt(board, N, r, opp, 'def');
        if (tt.tier === T_LIVE3 || tt.tier === T_LIVE3J) return true;
      }
    }
    return false;
  }

  // ⚠ 伪四三检测（2026-08-12 用户 bug + 2026-08-14 方案A/B 扩展）：己方四三的"四"若是冲四
  // （非活四），其结构薄弱点（连续空端 / 跳冲四缺口 / 活三两端）恰可被对手利用形成反杀
  // （is43/is44/活四 / 冲四+另有活三）→ 该四三会被对手反杀（非必胜），应跳过、交给后续防层。
  // ⚠ 原实现只检连续冲四空端 rushEnd 且漏判白四三（tQ.is43 只看 tier）——跳缺口漏检 + 白四三漏判。
  function isFake43(board, N, idx, color) {
    var opp = color === BLACK ? WHITE : BLACK;
    var x = idx % N, y = (idx / N) | 0, k;
    var weak = [], hasLiveFour = false;
    board[idx] = color;
    for (k = 0; k < 4; k++) {
      var lt = lineType(board, N, x, y, DIRS[k][0], DIRS[k][1], color);
      if (lt === T_LIVE4) hasLiveFour = true;          // 四方向含活四 → 真必胜
      else if (lt === T_RUSH4) {
        var q = rush4OpenEnd(board, N, idx, color, DIRS[k][0], DIRS[k][1]);
        if (q >= 0) weak.push(q);                      // 连续冲四空端
        collectJumpGap(board, N, idx, color, DIRS[k][0], DIRS[k][1], weak);  // 跳冲四缺口
      } else if (lt === T_LIVE3 || lt === T_LIVE3J) {
        collectLive3Ends(board, N, idx, color, DIRS[k][0], DIRS[k][1], weak);  // 活三两端
      }
    }
    board[idx] = EMPTY;
    if (hasLiveFour) return false;                     // 活四型四三真必胜
    var seen = {};
    for (k = 0; k < weak.length; k++) {
      var w = weak[k];
      if (seen[w]) continue;
      seen[w] = 1;
      if (oppKillAt(board, N, w, opp)) return true;    // 任一薄弱点被白反杀 → 伪四三
    }
    return false;
  }

  // 【L5】己方四三/四四：落子即形成必胜组合杀（is43/is44），主动进攻的最高优先级之一。
  // ⚠ 伪四三（四=冲四、空端可被对手反杀、对手另有活三）跳过，交给后续防一步必胜层处理。
  function findOwn43_44(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      var t = threatAt(board, N, idx, color);
      if (t.is43 || t.is44) {
        if (t.is43 && isFake43(board, N, idx, color)) continue;
        pts.push(idx);
      }
    }
    return pts;
  }

  // 【L6】己方单活四（非四三/四四的纯活四）——活四必赢，走它
  function findOwnLiveFour(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      var t = threatAt(board, N, idx, color);
      if (t.tier === T_LIVE4 && !t.is43 && !t.is44) pts.push(idx);
    }
    return pts;
  }

  // 【L6b】己方冲四+做杀：落子成冲四，且（半径4内）下一步能形成四三/四四（潜在做杀链）。
  // 冲四迫使对手唯一应手，同时为后续四三/四四铺路——主动进攻层（用户 2026-08-12，L6-L7 间）。
  // ⚠ 2026-08-14 举一反三：冲四弱点（空端/跳缺口）若被白占后形成白反杀（is43/is44/活四）→
  //   白堵冲四端即反杀，黑做杀链失效——此类"假冲四做杀"跳过。
  function findOwnRush4Kill(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      var t = threatAt(board, N, idx, color);
      if (t.tier === T_RUSH4 && potentialThreat(board, N, idx, color, 4, true) >= V.P_D43) {
        if (rush4Countered(board, N, idx, color)) continue;
        pts.push(idx);
      }
    }
    return pts;
  }

  // L6b 辅助（用户 2026-08-14）：黑冲四的薄弱点（连续空端/跳缺口）被白占后形成必胜反杀。
  function rush4Countered(board, N, idx, color) {
    var opp = color === BLACK ? WHITE : BLACK;
    var x = idx % N, y = (idx / N) | 0, k;
    var weak = [];
    board[idx] = color;
    for (k = 0; k < 4; k++) {
      var lt = lineType(board, N, x, y, DIRS[k][0], DIRS[k][1], color);
      if (lt === T_RUSH4) {
        var q = rush4OpenEnd(board, N, idx, color, DIRS[k][0], DIRS[k][1]);
        if (q >= 0) weak.push(q);
        collectJumpGap(board, N, idx, color, DIRS[k][0], DIRS[k][1], weak);
      }
    }
    board[idx] = EMPTY;
    var seen = {};
    for (k = 0; k < weak.length; k++) {
      var w = weak[k];
      if (seen[w]) continue;
      seen[w] = 1;
      if (oppKillAt(board, N, w, opp)) return true;
    }
    return false;
  }

  // 防守层通用辅助：找"对方下某点后形成 pred 级威胁"的所有点 T。
  // 供 L7（blockCombined 用 is43/is44/活四）、L11（blockPotential33 用 is33）收集对方威胁点。
  function findThreatPoints(board, N, color, pred) {
    var focus = focusCells(board, N).cands, T = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      var t = threatAt(board, N, idx, color, 'def');   // color=对方威胁方，防守视角
      if (pred(t)) T.push(idx);
    }
    return T;
  }

  // 防守层通用辅助：在对方威胁点 T 附近枚举 AI 堵点，要求 AI 落子 p 后对方 T 中
  // 所有点都不再构成 pred 级威胁（即一石多鸟地消除全部威胁）。L7/L11 都基于它筛选堵点。
  function filterDefense(board, N, me, opp, T, pred) {
    var pts = [], seen = {};
    var n = N * N, i, idx;
    var near = {};
    for (i = 0; i < T.length; i++) {
      var tx = T[i] % N, ty = (T[i] / N) | 0;
      var x0 = tx > 2 ? tx - 2 : 0, x1 = tx + 2 < N ? tx + 2 : N - 1;
      var y0 = ty > 2 ? ty - 2 : 0, y1 = ty + 2 < N ? ty + 2 : N - 1;
      for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
        var ni = yy * N + xx;
        if (board[ni] === EMPTY) near[ni] = 1;
      }
    }
    for (var key in near) {
      idx = key | 0;
      board[idx] = me;
      var still = false;
      for (i = 0; i < T.length; i++) {
        var qi = T[i];
        // 该威胁点已被我方占据 → 视为已消除
        if (board[qi] !== EMPTY) continue;
        var t = threatAt(board, N, qi, opp, 'def');
        // pred 额外接收威胁点坐标 qi，供"往后看"检测潜在组合杀（potentialThreat）
        if (pred(t, qi)) { still = true; break; }
      }
      board[idx] = EMPTY;
      if (!still) pts.push(idx);
    }
    return pts;
  }

  // 【L7】防对方"一步必胜威胁"（含"冲四+做杀"向后看）：
  //   ① is43/is44/活四 → 对手下此点即一步必胜，AI 必须应对
  //   ② 冲四(RUSH4) + potentialThreat>0 → 对手下此点成冲四且为下一步组合杀铺路，同 L7 级
  // 候选堵点按"AI 落子后对手剩余必胜威胁总和最小"的启发式选，天然优先一石多鸟。
  // ⚠ 攻防一体：己方落子成冲四/活四且紧邻挡死一个活三端才作为攻防一体加分（隔子不算）。
  function blockCombined(board, N, me, opp) {
    var focus = focusCells(board, N).cands, T = [], isLive3End = [], i;
    for (i = 0; i < focus.length; i++) {
      var t = threatAt(board, N, focus[i], opp, 'def');   // 对方威胁，防守视角
      if (t.is43 || t.is44 || t.tier === T_LIVE4) {
        T.push(focus[i]);
        isLive3End.push(t.tier === T_LIVE4);   // 活三成四点 = 活三两端，占住即彻底挡死该侧
      }
      // 往后看：敌人下 P 形成冲四(RUSH4)，且落子后为下一步组合杀铺路
      // （potentialThreat 半径4 >0：下一步能成四三/四四/三三）→ 冲四+做杀，与一步必胜同级
      else if (t.tier === T_RUSH4 && potentialThreat(board, N, focus[i], opp, 4, true) > 0) {
        T.push(focus[i]);
        isLive3End.push(false);
      }
    }
    if (!T.length) return [];
    var near = {}, key, idx;
    for (i = 0; i < T.length; i++) {
      var tx = T[i] % N, ty = (T[i] / N) | 0;
      for (var dy = -2; dy <= 2; dy++) {
        var ny = ty + dy; if (ny < 0 || ny >= N) continue;
        for (var dx = -2; dx <= 2; dx++) {
          var nx = tx + dx; if (nx < 0 || nx >= N) continue;
          var ni = ny * N + nx;
          if (board[ni] === EMPTY) near[ni] = 1;
        }
      }
    }
    var minRem = INF, bestAtk = -1, bestPts = [];
    for (key in near) {
      idx = key | 0;
      board[idx] = me;
      var rem = 0;
      for (i = 0; i < T.length; i++) {
        var qi = T[i];
        if (board[qi] !== EMPTY) continue;   // 已被占 → 该必胜点消除
        var t2 = threatAt(board, N, qi, opp, 'def');
        if (t2.is43 || t2.is44) rem += V.D43;
        else if (t2.tier === T_LIVE4) rem += V.LIVE4;
        else if (t2.tier === T_RUSH4) rem += V.RUSH4;
        else if (t2.tier === T_LIVE3 || t2.tier === T_LIVE3J) rem += V.LIVE3;
        // 往后看：该点落子后为下一步组合杀铺路，剩余威胁按组合杀值（P_D43/P_D33）累加
        var pt = potentialThreat(board, N, qi, opp, 4, true);
        if (pt > 0) rem += pt;
      }
      // 攻防一体：不因"有四"而优先冲——须"己方落子成冲四/活四 + 紧邻挡死一个活三端"
      // （占住活三成四点，彻底挡死该侧；隔子不算）才作为攻防一体加分，否则按纯防守比较
      var meT = threatAt(board, N, idx, me);
      var atkTier = T_NONE;
      if (meT.tier === T_RUSH4 || meT.tier === T_LIVE4) {
        for (var li = 0; li < T.length; li++) {
          if (T[li] === idx && isLive3End[li]) { atkTier = meT.tier; break; }
        }
      }
      board[idx] = EMPTY;
      if (rem < minRem || (rem === minRem && atkTier > bestAtk)) {
        minRem = rem; bestAtk = atkTier; bestPts = [idx];
      } else if (rem === minRem && atkTier === bestAtk) {
        bestPts.push(idx);
      }
    }
    return bestPts;
  }

  // 【L8】防三三攻防一体（L7 无法单点全防时）：敌方已生成三三/多活三时的攻防一体堵点。
  // 用户要求：不是"有四就冲"，而是"冲四时至少彻底挡死一个活三才冲"——
  // 即己方冲四落点必须紧邻堵死某个活三的端点（T=活三两端，占住即彻底挡死该侧；隔子不算）。
  function findDefendWithRush4(board, N, me, opp) {
    var T = findThreatPoints(board, N, opp, function (t) { return t.tier === T_LIVE4; });
    if (!T.length) return -1;
    var best = -1, bestVal = -1, i;
    for (i = 0; i < T.length; i++) {
      var qi = T[i];
      board[qi] = me;
      var tSelf = threatAt(board, N, qi, me);
      if (tSelf.tier === T_RUSH4 || tSelf.tier === T_LIVE4) {
        if (tSelf.value > bestVal) { bestVal = tSelf.value; best = qi; }
      }
      board[qi] = EMPTY;
    }
    return best;
  }

  // 【L9】开局进攻：棋子树<8 时，若己方落子能形成活三/冲四/活四（tier≥LIVE3）就主动走。
  // 解决开局平庸/威慑力低的问题。⚠ 曾用 countShapes/shapeBalance 结构启发被撤销，改此快速层。
  function findOpeningThreat(board, N, color) {
    var focus = focusCells(board, N).cands, best = -1, bestVal = 0, i;
    for (i = 0; i < focus.length; i++) {
      var t = threatAt(board, N, focus[i], color);
      if (t.tier >= T_LIVE3 && t.value > bestVal) { bestVal = t.value; best = focus[i]; }
    }
    return best;
  }

  // 【L10】己方三三（落子形成 is33=双活三）
  function findOwn33(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      var t = threatAt(board, N, idx, color);
      if (t.is33) pts.push(idx);
    }
    return pts;
  }

  // 【L10b】己方做杀层（用户 2026-08-12，L10-L11 间）：
  //   ① 落子成冲四(RUSH4)，且（半径4内）下一步能形成三三（P_D33）——冲四+三三做杀；
  //   ② 落子成活三(LIVE3/LIVE3J)，且（半径4内）下一步能形成四三/四四/三三（P_D33+）——活三+做杀。
  // 较 L6b（冲四+四三/四四）弱一档的做杀链，主动进攻。
  function findOwnKillLayer(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      var t = threatAt(board, N, idx, color);
      if (t.tier === T_RUSH4) {
        if (potentialThreat(board, N, idx, color, 4, true) >= V.P_D33) pts.push(idx);
      } else if (t.tier === T_LIVE3 || t.tier === T_LIVE3J) {
        if (potentialThreat(board, N, idx, color, 4, true) >= V.P_D33) pts.push(idx);
      }
    }
    return pts;
  }

  // 【L11】防对方潜在三三（含"活三+做杀"向后看）：
  //   ① is33 → 对方落点直接形成三三
  //   ② 活三(LIVE3) + potentialThreat>0 → 对方下此点成活三且为下一步组合杀铺路，同 L11 级
  // 用户要求：候选堵点中若存在"自己落子后成冲四/活四"的，优先走该攻防一体点。
  function blockPotential33(board, N, me, opp) {
    var T = findThreatPoints(board, N, opp, function (t) { return t.is33; });
    // 往后看（潜在组合杀）：敌人下 P 形成活三(LIVE3)且落子后为下一步组合杀铺路
    // （potentialThreat>0：下一步能成四三/四四/三三）→ 与 L11 同级潜在威胁。
    var focus = focusCells(board, N).cands, i;
    for (i = 0; i < focus.length; i++) {
      var idx = focus[i];
      if (T.indexOf(idx) >= 0) continue;
      var t = threatAt(board, N, idx, opp, 'def');
      if ((t.tier === T_LIVE3 || t.tier === T_LIVE3J) && potentialThreat(board, N, idx, opp, 4, true) > 0) T.push(idx);
    }
    if (!T.length) return [];
    return filterDefense(board, N, me, opp, T, function (t, qi) {
      if (t.is33) return true;   // 对方落点直接形成三三
      if ((t.tier === T_LIVE3 || t.tier === T_LIVE3J) && potentialThreat(board, N, qi, opp, 4, true) > 0) return true;  // 活三+做杀
      return false;
    });
  }

  // 【L12】VCF 连续冲四强制序列搜索（可搜很深，深度14）。
  // 只扩展"落子后成五/活四/冲四"的点（威胁值高，分支极少），因此可搜很深。
  // ⚠ 理论局限：无禁手下多数"当手杀"已被 L1-L5 处理；VCF 仅在"有当手冲四且通向深杀"时触发。
  var _vcfNodes = 0, _vcfStart = 0, _vcfHard = 250;

  // VCF 辅助：求冲四 p 的唯一堵点（空端）。返回 -1 表示无双点可堵（双冲四等 → 实则必胜）。
  function rushBlock(board, N, p, color) {
    var opp = color === BLACK ? WHITE : BLACK;
    var x = p % N, y = (p / N) | 0;
    var x0 = x > 3 ? x - 3 : 0, x1 = x + 3 < N ? x + 3 : N - 1;
    var y0 = y > 3 ? y - 3 : 0, y1 = y + 3 < N ? y + 3 : N - 1;
    var found = -1;
    for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
      var q = yy * N + xx;
      if (q === p || board[q] !== EMPTY) continue;
      board[q] = opp;
      var t = threatAt(board, N, p, color);
      board[q] = EMPTY;
      if (t.tier < T_RUSH4) {
        if (found >= 0) return -1;   // 多个堵点 → 对方有选择，非强制
        found = q;
      }
    }
    return found;
  }

  // VCF 辅助：递归搜索。每层先手放冲四→对方唯一应→继续，直到对方无法防（无唯一堵）即判胜。
  function vcfSearch(board, N, color, depth, maxDepth) {
    if (++_vcfNodes > 8000 || _now() - _vcfStart > _vcfHard) return -1;
    if (depth > maxDepth) return -1;
    var opp = color === BLACK ? WHITE : BLACK;
    var focus = focusCells(board, N).cands, i;
    for (i = 0; i < focus.length; i++) {
      var p = focus[i];
      board[p] = color;
      var t = threatAt(board, N, p, color);
      // 直接必胜：五连 / 活四（无解）/ 四四（双冲四）
      if (t.tier === T_FIVE || t.tier === T_LIVE4 || t.is44) { board[p] = EMPTY; return p; }
      if (t.tier === T_RUSH4) {
        var b = rushBlock(board, N, p, color);
        if (b < 0) { board[p] = EMPTY; return p; }   // 冲四无唯一堵（双冲四等）→ 对方无法防，必胜
        board[b] = opp;
        var r = vcfSearch(board, N, color, depth + 1, maxDepth);
        board[b] = EMPTY;
        if (r >= 0) { board[p] = EMPTY; return p; }
      }
      board[p] = EMPTY;
    }
    return -1;
  }

  // VCF 层入口：重置节点计数与计时后启动 vcfSearch；返回必胜首手或 -1（无 VCF 杀）。
  function vcfWin(board, N, color, maxDepth) {
    _vcfNodes = 0; _vcfStart = _now();
    return vcfSearch(board, N, color, 0, maxDepth);
  }

  // 防多步杀（用户 2026-08-12）：检测对方是否有连续冲四必胜（VCF 杀）。
  // 返回对方杀棋首手（AI 优先占住，尝试打断对方多步杀）；-1 表示无。
  // ⚠ 时间可控：临时收紧 _vcfHard（200ms），不突破预算；调用后恢复 vcf 状态。
  function findOppVcfDefense(board, N, color) {
    var opp = color === BLACK ? WHITE : BLACK;
    var sn = _vcfNodes, ss = _vcfStart, sh = _vcfHard;
    _vcfHard = 200;
    var p = vcfWin(board, N, opp, 12);
    _vcfNodes = sn; _vcfStart = ss; _vcfHard = sh;
    return p;
  }

  // ⚠ 遗留函数（未在 getMove 主流程调用）：旧版"L6 防活三"。已并入 blockCombined
  // （对方一步必胜威胁统一处理），保留仅供测试参考。
  function blockLiveThree(board, N, me, opp) {
    var T = findThreatPoints(board, N, opp, function (t) { return t.tier === T_LIVE4; });
    if (!T.length) return [];
    return filterDefense(board, N, me, opp, T, function (t) { return t.tier === T_LIVE4; });
  }

  /* ==================== 开局决策层（前7手定式，合并升级 L1/L9/L12b） ==================== */

  // 【通用】某方所有"落 q 后能形成双活二"（threatAt.l2>=2，含【黑+空+黑】跳活二）的点。
  // 这些点是"做杀潜力点"：执白时是防守目标（堵它们防黑双活二），执黑时是进攻目标（占它们构建双活二）。
  function findDoubleLive2Points(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      if (threatAt(board, N, focus[i], color).l2 >= 2) pts.push(focus[i]);
    }
    return pts;
  }

  // 判断 q（已放 color）在方向 (dx,dy) 是否为"跳活二"（q 隔一格同色，中间空，如 `_ q _ O _`）。
  // lineType 对连活二/跳活二都返回 T_LIVE2，此处额外区分跳子（填缺口型）。
  function isJumpLive2(board, N, x, y, dx, dy, color) {
    var f = inB(x + 2 * dx, y + 2 * dy) && board[(y + 2 * dy) * N + (x + 2 * dx)] === color &&
      inB(x + dx, y + dy) && board[(y + dy) * N + (x + dx)] === EMPTY;
    var b = inB(x - 2 * dx, y - 2 * dy) && board[(y - 2 * dy) * N + (x - 2 * dx)] === color &&
      inB(x - dx, y - dy) && board[(y - dy) * N + (x - dx)] === EMPTY;
    return f || b;
  }

  // 双活二候选点的活二价值（用户 2026-08-12）：每个活二方向按 斜连活二=2、斜跳活二=1.25、
  // 横竖活二/跳活二=1 计，双活二价值 = 各活二方向价值之和。价值高者优先构建（斜线活二更灵活）。
  function live2Value(board, N, q, color) {
    var x = q % N, y = (q / N) | 0, val = 0, k;
    board[q] = color;
    for (k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1];
      if (lineType(board, N, x, y, dx, dy, color) === T_LIVE2) {
        if (dx !== 0 && dy !== 0) val += isJumpLive2(board, N, x, y, dx, dy, color) ? 1.25 : 2;
        else val += 1;
      }
    }
    board[q] = EMPTY;
    return val;
  }

  // 双活二选点（用户 2026-08-12）：先按活二价值选最高者；价值并列（多个候选同价值）时才用深搜选。
  function pickBestLive2(board, N, color, opp, cands, budget) {
    var bestVal = -1, best = [], i, v;
    for (i = 0; i < cands.length; i++) {
      v = live2Value(board, N, cands[i], color);
      if (v > bestVal) { bestVal = v; best = [cands[i]]; }
      else if (v === bestVal) best.push(cands[i]);
    }
    if (best.length === 1) return best[0];
    return pickBestBySearch(board, N, color, opp, best, budget);   // 价值并列才深搜
  }

  // 【通用】某方所有"落 q 后能形成活三"（tier===LIVE3/LIVE3J，即延伸已有活二冲三）的点。
  // 执白：堵这些点防黑活二延伸；执黑：占这些点延伸己方活二冲三。
  function findLive3Points(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      var t = threatAt(board, N, focus[i], color);
      if (t.tier === T_LIVE3 || t.tier === T_LIVE3J) pts.push(focus[i]);
    }
    return pts;
  }

  // 【通用】某方所有"落 q 后能形成冲四"（tier===RUSH4，含连续冲三延伸与跳冲三缺口）的点。
  // 执白：堵这些点防黑冲四；执黑：占这些点主动冲四。
  function findRush4Points(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      if (threatAt(board, N, focus[i], color).tier === T_RUSH4) pts.push(focus[i]);
    }
    return pts;
  }

  // 【通用】某方所有"落 q 后能形成斜线活二及以上"（继承原 L12b：前手无防守/进攻需求时优先下斜线）的点。
  function findDiagLive2Points(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      if (diagBonus(board, N, focus[i], color) > 0 && threatAt(board, N, focus[i], color).tier >= T_LIVE2) {
        pts.push(focus[i]);
      }
    }
    return pts;
  }

  // 【通用】某方所有"落 q 后形成三个及以上活二"（threatAt.l2>=3，三活二做杀潜力）的点。
  // 第5/7手黑进攻用：构建大量活二方向的强做杀潜力。
  function findTripleLive2Points(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      if (threatAt(board, N, focus[i], color).l2 >= 3) pts.push(focus[i]);
    }
    return pts;
  }

  // 【通用】某方所有"落 q 后形成活二及以上"（threatAt.tier>=LIVE2，构建新活二）的点。
  // 第5/7手黑进攻兜底用：无活三/三活二/双活二可走时，优先构建新活二发展棋型。
  function findNewLive2Points(board, N, color) {
    var focus = focusCells(board, N).cands, pts = [], i;
    for (i = 0; i < focus.length; i++) {
      if (threatAt(board, N, focus[i], color).tier >= T_LIVE2) pts.push(focus[i]);
    }
    return pts;
  }

  // 【通用】某方所有"跳活二"（同色_同色，两端空）的可堵点（两端空位）。
  // 第6手防黑跳活二用——黑跳活二两端空可延伸，白堵任一端破坏。
  function findJumpLive2Points(board, N, color) {
    var pts = [], n = N * N, i, k;
    for (i = 0; i < n; i++) {
      if (board[i] !== color) continue;
      var x = i % N, y = (i / N) | 0;
      for (k = 0; k < 4; k++) {
        var dx = DIRS[k][0], dy = DIRS[k][1];
        var mx = x + dx, my = y + dy, nx = x + 2 * dx, ny = y + 2 * dy;
        if (inB(nx, ny, N) && board[ny * N + nx] === color && inB(mx, my, N) && board[my * N + mx] === EMPTY) {
          // 跳二 (x,y)_空_(nx,ny)：堵缺口 (mx,my) 使其无法延伸成活三（最有效点），
          // 两端 (x-dx,y-dy) 和 (nx+dx,ny+dy) 仅封边（歧义点5：原实现漏缺口）。
          pts.push(my * N + mx);
          var a1 = x - dx, b1 = y - dy, a2 = nx + dx, b2 = ny + dy;
          if (inB(a1, b1, N) && board[b1 * N + a1] === EMPTY) pts.push(b1 * N + a1);
          if (inB(a2, b2, N) && board[b2 * N + a2] === EMPTY) pts.push(b2 * N + a2);
        }
      }
    }
    return dedupe(pts);
  }

  // 【第3手】花月/浦月开局定式（用户 2026-08-12 纠正概念）：
  //   花月：白2 落天元竖方向（上/下），黑3 落白2 的左侧或右侧（与白2 同行横错开）；
  //         白2 落天元横方向（左/右）时对称——黑3 落白2 的上侧或下侧（与白2 同列竖错开）。
  //   浦月：白2 落天元斜对角，黑3 落白2 的竖方向下面2格（白2 相对天元的对称侧2格）。
  //   其他对称/镜像情景按相同原理构造。
  function huaPuThird(board, N, color, opp, budget) {
    var c = (N / 2) | 0, dIdx = -1, i;
    for (i = 0; i < N * N; i++) if (board[i] === opp) { dIdx = i; break; }
    if (dIdx < 0) return -1;
    var px = dIdx % N, py = (dIdx / N) | 0;   // 白2 坐标
    // ⚠ 用户 2026-08-14 bug：白2 不在天元周围8格（非正常开局）时，硬套花月/浦月公式
    //   会算出远离天元的乱点（如白2=(11,11) → 浦月对称点(11,5)，与黑1脱节）。
    //   改为从天元四个对角格随机选1个下，建立己方斜线棋型。
    if (Math.abs(px - c) > 1 || Math.abs(py - c) > 1) {
      var diag = [(c - 1) * N + (c - 1), (c + 1) * N + (c - 1), (c - 1) * N + (c + 1), (c + 1) * N + (c + 1)];
      var dOk = [];
      for (i = 0; i < 4; i++) if (board[diag[i]] === EMPTY) dOk.push(diag[i]);
      if (dOk.length) return dOk[(Math.random() * dOk.length) | 0];
      return -1;
    }
    var cands = [];
    if (px === c || py === c) {
      // 花月：白2 横/竖 → 黑3 落白2 的垂直侧
      if (px === c) {
        cands.push(py * N + (c - 1));   // 白2 左侧
        cands.push(py * N + (c + 1));   // 白2 右侧
      } else {
        cands.push((c - 1) * N + px);   // 白2 上侧
        cands.push((c + 1) * N + px);   // 白2 下侧
      }
    } else {
      // 浦月：白2 对角 → 黑3 落白2 竖方向2格（白2 相对天元的对称侧）
      cands.push((2 * c - py) * N + px);
    }
    var ok = [];
    for (i = 0; i < cands.length; i++) {
      var idx = cands[i];
      var x = idx % N, y = (idx / N) | 0;
      if (inB(x, y, N) && board[idx] === EMPTY) ok.push(idx);
    }
    if (ok.length === 1) return ok[0];
    if (ok.length > 1) return pickBestBySearch(board, N, color, opp, ok, budget || 200);
    return -1;
  }

  // 【第2手】白：场上唯一黑棋的四对角均可下 → 随机选一个对角；仅1/2个对角可下
  // （说明黑落边界）→ 白抢天元。
  function whiteSecond(board, N, color) {
    var opp = color === BLACK ? WHITE : BLACK, bIdx = -1, i;
    for (i = 0; i < N * N; i++) if (board[i] === opp) { bIdx = i; break; }
    if (bIdx < 0) return -1;
    var bx = bIdx % N, by = (bIdx / N) | 0;
    var diags = [[bx - 1, by - 1], [bx + 1, by - 1], [bx - 1, by + 1], [bx + 1, by + 1]];
    var avail = [];
    for (i = 0; i < 4; i++) {
      var dx = diags[i][0], dy = diags[i][1];
      if (inB(dx, dy, N) && board[dy * N + dx] === EMPTY) avail.push([dx, dy]);
    }
    if (avail.length === 4) {
      var p = avail[(Math.random() * 4) | 0];
      return p[1] * N + p[0];
    } else if (avail.length >= 1 && avail.length <= 2) {
      var c = (N / 2) | 0;
      if (board[c * N + c] === EMPTY) return c * N + c;
    }
    return -1;
  }

  // 【第4手】白防守：① 堵黑所有能形成双活二的点（深搜选）；② 无 → 堵黑活二延伸
  // （黑能形成活三的点）；③ 都无 → 继承 L12b 优先斜线走出己方活二。
  function whiteFourth(board, N, color, budget) {
    var opp = color === BLACK ? WHITE : BLACK;
    var dbl = findDoubleLive2Points(board, N, opp);
    if (dbl.length) return pickBestBySearch(board, N, color, opp, dbl, budget);
    var l3 = findLive3Points(board, N, opp);
    if (l3.length) return pickBestBySearch(board, N, color, opp, l3, budget);
    var dl = findDiagLive2Points(board, N, color);
    if (dl.length) return pickBestBySearch(board, N, color, opp, dl, budget);
    return -1;
  }

  // 【第5手】黑进攻（用户 2026-08-12 修改优先级）：
  //   ① 冲活三（落 q 后形成活三，不含眠三）——深搜选最佳；
  //   ② 无 → 三活二（落 q 后形成 3 个活二）——深搜选最佳；
  //   ③ 无 → 双活二（落 q 后形成 2 个活二）——**按活二价值选**（斜连2/斜跳1.25/横竖1，
  //      价值高优先，价值并列才深搜）；
  //   ④ 无 → 构建新的活二——深搜选最佳；⑤ 都无 → 跳过（交给 L14 兜底）。
  function blackFifth(board, N, color, budget) {
    var opp = color === BLACK ? WHITE : BLACK;
    var l3 = findLive3Points(board, N, color);
    if (l3.length) return pickBestBySearch(board, N, color, opp, l3, budget);
    var tri = findTripleLive2Points(board, N, color);
    if (tri.length) return pickBestBySearch(board, N, color, opp, tri, budget);
    var dbl = findDoubleLive2Points(board, N, color);
    if (dbl.length) return pickBestLive2(board, N, color, opp, dbl, budget);
    var l2 = findNewLive2Points(board, N, color);
    if (l2.length) return pickBestBySearch(board, N, color, opp, l2, budget);
    return -1;
  }

  // 落 q（临时放 color）后是否形成斜向活三（活三方向为斜向 dx!==0 && dy!==0）。
  function hasDiagLive3(board, N, q, color) {
    var x = q % N, y = (q / N) | 0, k;
    board[q] = color;
    var res = false;
    for (k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1];
      if (dx !== 0 && dy !== 0) {
        var t = lineType(board, N, x, y, dx, dy, color);
        if (t === T_LIVE3 || t === T_LIVE3J) { res = true; break; }
      }
    }
    board[q] = EMPTY;
    return res;
  }

  // 落 q（临时放 color）后斜方向活二的数量（用于斜活三选点：优先构造更多斜活二）。
  function countDiagLive2(board, N, q, color) {
    var x = q % N, y = (q / N) | 0, k, n = 0;
    board[q] = color;
    for (k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1];
      if (dx !== 0 && dy !== 0 && lineType(board, N, x, y, dx, dy, color) === T_LIVE2) n++;
    }
    board[q] = EMPTY;
    return n;
  }
  // 斜活三选点（用户 2026-08-14 第7手黑）：斜活三候选中优先"构造更多斜活二"的点位；
  // 多个并列 → 交 pickBestBySearch 深搜选具体点。
  function pickBestDiagLive3(board, N, color, cands, budget, opp) {
    var i, best = [], bestD = -1, d;
    for (i = 0; i < cands.length; i++) {
      d = countDiagLive2(board, N, cands[i], color);
      if (d > bestD) { bestD = d; best = [cands[i]]; }
      else if (d === bestD) best.push(cands[i]);
    }
    if (best.length === 1) return best[0];
    return pickBestBySearch(board, N, color, opp, best, budget);
  }

  // 【第7手】黑进攻（用户 2026-08-14 修改规则）：
  //   ① 有斜活三 → 优先下（优先构造更多斜活二的点位，多个交深搜选）；
  //   ② 无 → 三活二 → 深搜选；③ 无 → 双活二 → 按活二价值直接选（斜连2/斜跳1.25/横竖1，
  //      价值高优先，并列才深搜）；④ 均无（横竖活三、单活二、冲四等其他）→ 跳过该层，交 L14。
  function blackSeventh(board, N, color, budget) {
    var opp = color === BLACK ? WHITE : BLACK;
    var l3 = findLive3Points(board, N, color), diag3 = [], i;
    for (i = 0; i < l3.length; i++) if (hasDiagLive3(board, N, l3[i], color)) diag3.push(l3[i]);
    if (diag3.length) return pickBestDiagLive3(board, N, color, diag3, budget, opp);
    var tri = findTripleLive2Points(board, N, color);
    if (tri.length) return pickBestBySearch(board, N, color, opp, tri, budget);
    var dbl = findDoubleLive2Points(board, N, color);
    if (dbl.length) return pickBestLive2(board, N, color, opp, dbl, budget);
    return -1;
  }

  // 【第6手】白：① 黑有冲三 → 堵黑能形成冲四的点（RUSH4，含跳冲三缺口，深搜选）；
  // ② 无 → 黑有跳活二 → 堵其端点；③ 都无 → 转自己进攻（双活二 > 冲三 > 活二）；④ 都无 → L13 兜底。
  function whiteSixth(board, N, color, budget) {
    var opp = color === BLACK ? WHITE : BLACK;
    // 防御优先：先堵黑即时威胁（冲四 > 跳活二），再转入己方进攻构建
    var r4 = findRush4Points(board, N, opp);
    if (r4.length) return pickBestBySearch(board, N, color, opp, r4, budget);
    var jl = findJumpLive2Points(board, N, opp);
    if (jl.length) return pickBestBySearch(board, N, color, opp, jl, budget);
    // 进攻分支顺序（用户 2026-08-14 修正）：双活二 > 冲三（活三）> 冲二（活二）> L13。
    // ⚠ 移除原冲四档——第6手白仅2子，落1子至多3连，不可能形成冲四，该档永空（死代码）。
    var dbl = findDoubleLive2Points(board, N, color);
    if (dbl.length) return pickBestBySearch(board, N, color, opp, dbl, budget);
    var l3 = findLive3Points(board, N, color);
    if (l3.length) return pickBestBySearch(board, N, color, opp, l3, budget);
    var l2 = findNewLive2Points(board, N, color);
    if (l2.length) return pickBestBySearch(board, N, color, opp, l2, budget);
    return -1;
  }

  // 开局决策层主入口：前7手（执黑4手=1/3/5/7，执白3手=2/4/6）的定式决策。
  // 合并升级原 L1（空盘天元）/ L9（开局进攻）/ L12b（强制斜线）。
  // 位于 getMove L13 前：强制层（L2-L12）先检测，无强制威胁时本层提供开局定式。
  // 返回落点 idx 或 -1（跳过，交给 L13 兜底）。
  function openingDecision(board, N, color, budget) {
    // ⚠ 用户 2026-08-14：开局定式层前7手是固定棋理，无需长思考——深搜预算固定 2s 上限，
    //   不随总预算（searchTime）拉长。内部 huaPuThird/blackFifth/whiteSixth 等共用该 budget。
    budget = Math.min(typeof budget === 'number' && budget > 0 ? budget : 2000, 2000);
    var stones = countStones(board, N);
    if (stones > 6) return -1;
    var opp = color === BLACK ? WHITE : BLACK;
    var c = (N / 2) | 0;
    if (color === BLACK) {
      if (stones === 0) return c * N + c;                              // 第1手 天元（原 L1）
      if (stones === 2) return huaPuThird(board, N, color, opp, budget); // 第3手 花月/浦月
      if (stones === 4) return blackFifth(board, N, color, budget);    // 第5手 活三>三活二>双活二>新活二
      if (stones === 6) return blackSeventh(board, N, color, budget);  // 第7手 活三(不含眠三/不冲四)>三活二>双活二>新单活二
    } else {
      if (stones === 1) return whiteSecond(board, N, color);           // 第2手 对角/天元
      if (stones === 3) return whiteFourth(board, N, color, budget);   // 第4手 防双活二
      if (stones === 5) return whiteSixth(board, N, color, budget);    // 第6手 防冲三
    }
    return -1;
  }

  /* ==================== 九、启发式搜索（规格第7节） ==================== */

  // 深度搜索时间控制（getMove / pickBestBySearch / negamax 共享）
  var _timeout = false, _start = 0, _hardLimit = 0;
  // 迭代加深深度上限（用户 2026-08-14）：原写死 6——深度6完成即停，10s 预算实际只搜 3.3s
  // 提前截断。提高上限让搜索在预算内继续深入（深度6为下限，"时间到"才是截断条件）。
  var MAX_ITER_DEPTH = 12;
  var _now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? function () { return performance.now(); } : function () { return Date.now(); };
  // 深度6搜索剪枝：候选由 genMoves 的分类分组截断（capByBuckets）控制——**仅白棋分桶**：
  // 白第一层 cap11（冲四2活三2活二1）、白内部层 cap10（冲四2活三1活二1）；黑棋纯分数截断10
  // （分离实验证明黑分桶干扰黑进攻、降低黑能力，黑不分桶黑才强）
  var _nodes = 0;

  // 启发式·着法生成与排序（L13 深搜的起点，negamax 每层也调用）：
  // 曼哈顿≤2 空位，排序分 = 己方进攻(atk) + 堵对方(tO×t0w) + 局部棋型密度(lst)
  //   + 潜在组合杀差(×0.1) + 中心度(微弱) + 极早斜线加权(+100000)。
  // ⚠ applyDefense=true 仅顶层（L13 顶层 genMoves）——negamax 内部不传，避免 defendMode/lst
  //   干扰强制层多候选深搜选点（第21手回归点）。applyLst 传 true 仅用于"黑堵白降权"t0w。
  // 分类分组截断（用户 2026-08-12）：候选按棋型分桶（冲四/活三跳三/活二/其他），
  // 每桶先按分数保底保留 keepX 个（保证多样性，避免高分同质点垄断），再按分数补齐到 cap。
  // "其他"桶不保底（完全按分数参与补齐，避免塞入眠二/无威胁低价值点）。
  // 第一层 cap=11（冲四2活三2活二1），内部层 cap=10（冲四2活三1活二1）。
  function capByBuckets(cands, sc, tiers, capOpt) {
    var cap = capOpt.cap, r4 = [], l3 = [], l2 = [], i, t;
    for (i = 0; i < cands.length; i++) {
      t = tiers[i];
      if (t === T_RUSH4) r4.push(i);
      else if (t === T_LIVE3 || t === T_LIVE3J) l3.push(i);
      else if (t === T_LIVE2) l2.push(i);
    }
    var out = [], used = {};
    function take(arr, n) {
      for (var k = 0; k < n && arr.length && out.length < cap; k++) {
        var idx = arr.shift();   // 桶内按分数（cands 已排序）取
        out.push(cands[idx]); used[idx] = 1;
      }
    }
    take(r4, capOpt.keepRush4);
    take(l3, capOpt.keepLive3);
    take(l2, capOpt.keepLive2);
    // 按分数补齐（cands 已全局排序，取未选）直到 cap
    for (i = 0; i < cands.length && out.length < cap; i++) {
      if (!used[i]) out.push(cands[i]);
    }
    return out;
  }

  function genMoves(board, N, color, applyDefense, applyLst, capOpt) {
    var opp = color === BLACK ? WHITE : BLACK;
    var focus = focusCells(board, N);
    var cands = focus.cands, sc = [], tiers = [], i;
    if (focus.stones === 0) return cands;
    var half = N / 2;
    // 开局规范（用户 2026-08-08：中心/斜线是人为主观经验，仅极早生效、后续按棋理）：
    //   - 中心度：执黑前两手(<4子)、执白前三手(<6子) 靠近中心
    //   - 斜线：AI 前两手(<4子) 尽量走斜线（另由 getMove L12b 硬约束保证）
    var isEarly = (color === BLACK) ? (focus.stones < 4) : (focus.stones < 6);
    var isVeryEarly = focus.stones < 4;
    // 全局攻防态势：己方进攻潜力（hasAttack / myMax）vs 敌方已有威胁（oppThreat）。
    // 在强制层不触发、走 L13 深搜时生效——若敌方已有威胁明显占优，落子侧重防守。
    var hasAttack = false, j, myMax = 0;
    for (j = 0; j < cands.length; j++) {
      var ta0 = threatAt(board, N, cands[j], color);
      if (ta0.tier >= T_LIVE3) hasAttack = true;
      if (ta0.value > myMax) myMax = ta0.value;
    }
    var oppThreat = existingThreat(board, N, opp);   // 敌方已有死三/活二等威胁总值
    // 攻防转换固定参数（黑白区分）：
    //   执黑：敌方威胁需明显占优(>4倍)才偏守、偏守降权弱(0.8) → 全力进攻
    //   执白：稍占优(>1.2倍)即偏守、降权强(0.3) → 重防守
    var T = color === BLACK ? 4 : 1.2;
    var D = color === BLACK ? 0.8 : 0.3;
    var defendMode = applyDefense && (oppThreat > myMax * T);
    for (i = 0; i < cands.length; i++) {
      var idx = cands[i];
      var tA = threatAt(board, N, idx, color);
      var tO = threatAt(board, N, idx, opp, 'def');
      var x = idx % N, y = (idx / N) | 0;
      var d = Math.max(Math.abs(x - half), Math.abs(y - half));
      tiers[i] = tA.tier;   // 分类分组截断用（分桶）
      // 统一落点价值 = 己方落子进攻(atk) + 堵对方价值(tO：占住即破坏对方在此形成的威胁)。
      // ⚠ 进攻权重按攻防态势自适应：defendMode → 进攻×D 偏守；
      //   己方无有效进攻（只能构建活二/死三）→ 白弱进攻仅作轻微 tiebreak（×0.1）；
      //   正常（有进攻且敌威胁小）→ 进攻价值完整保留。
      // 黑进攻导向（用户 2026-08-12）：黑堵白价值降权×0.7 仅"白威胁不占优"且 L13 启发层
      //   （applyLst）生效；攻守转换（oppThreat>myMax×2）黑 t0w=1 正常防守。
      // ⚠ 用户 2026-08-14：AI 执黑前 9 手（黑落子 ≤5 次）不攻守转换——强制 t0w=0.7 进攻，
      //   第 9 手后才按"白威胁 > 黑进攻×8"判断。
      var t0w = (applyLst && color === BLACK &&
        (countStones(board, N) <= 9 || !(oppThreat > myMax * 8))) ? 0.7 : 1;
      var atk = tA.value;
      if (!hasAttack && color === WHITE) atk = tA.value * 0.1;
      else if (defendMode) atk = tA.value * D;   // 有进攻但敌威胁占优 → 按攻击性系数降权偏守
      sc[i] = atk + tO.value * t0w;
      // 局部棋型威胁密度（用户 2026-08-12）：小区域内对方大量活二/眠三/眠二汇聚即做杀潜力，
      // 黑白都考虑，执白防御参数更高。我方占 idx 即消除对方在该点的做杀潜力。
      // ⚠ 仅顶层落点选择（applyDefense=true）生效，避免干扰强制层多候选选点。
      if (applyDefense) sc[i] += localShapeThreat(board, N, idx, opp) * (color === WHITE ? 0.3 : 0.15);
      sc[i] += (potentialThreat(board, N, idx, color) + potentialThreat(board, N, idx, opp)) * 0.1;
      sc[i] += (half - d) * 0.0001;   // 微弱中心度
      if (isVeryEarly) {
        // 第二手强制斜线（用户要求：AI 前两手必须走对角）
        if (diagBonus(board, N, idx, color) > 0) sc[i] += 100000;
      }
    }
    // 选择排序（cands 通常不多）；tiers 同步交换
    var len = cands.length;
    for (i = 0; i < len; i++) {
      for (var j = i + 1; j < len; j++) {
        if (sc[j] > sc[i]) {
          var tv = sc[i]; sc[i] = sc[j]; sc[j] = tv;
          var ti = cands[i]; cands[i] = cands[j]; cands[j] = ti;
          var tt = tiers[i]; tiers[i] = tiers[j]; tiers[j] = tt;
        }
      }
    }
    if (capOpt) return capByBuckets(cands, sc, tiers, capOpt);
    return cands;
  }

  // 启发式·深度搜索核心：Negamax + Alpha-Beta 剪枝。
  // 负向最大：每个落点后以对手视角递归（-negamax），配合 α-β 剪枝与硬时间上限。
  // 叶子(depth<=0)调用 evaluateBoard；lastIdx 落子即判负(对手成五)时返回负值提前剪枝。
  // ⚠ applyLst 参数贯穿递归：L13 顶层传 true（evaluateBoard 应用局部棋型密度/黑堵白降权），
  //   强制层（pickBestBySearch）不传（false，评估保持正常防守）。
  function negamax(board, N, color, depth, alpha, beta, lastIdx, opp, ply, applyLst) {
    if (_timeout) return 0;
    if (_now() - _start > _hardLimit) { _timeout = true; return 0; }
    if (lastIdx >= 0 && isWin(board, N, lastIdx, opp)) return -(V.FIVE - ply);
    if (depth <= 0) {
      // 随机扰动已去掉（曾导致 AI 起步平庸、对局结果不稳定）
      return evaluateBoard(board, N, color, applyLst);
    }
    if ((++_nodes & 255) === 0 && _now() - _start > _hardLimit) { _timeout = true; return 0; }
    // 内部 genMoves 传 applyLst（仅黑堵白降权 t0w）+ capOpt。
    // 分类分组截断仅启发层（applyLst=true）启用（cap10：冲四2活三1活二1）保证分支多样性；
    // 强制层（applyLst=false，如 L6 防必胜）用纯分数截断10（keepX=0），避免干扰强制层选点（第21手回归点）
    // 分桶按颜色区分（用户 2026-08-12 定稿）：**仅白棋分桶**，黑棋不分桶（纯分数截断）——
    // 分离实验证明：黑分桶（无论保底多少）都会改变候选顺序干扰黑进攻、导致黑弱；黑不分桶时黑强。
    // 白棋分桶（保冲四2活三1活二1）保证防守候选全面。强制层（applyLst=false）不分桶。
    var capOpt;
    if (!applyLst || color === BLACK) capOpt = { cap: 10, keepRush4: 0, keepLive3: 0, keepLive2: 0 };
    else capOpt = { cap: 10, keepRush4: 2, keepLive3: 1, keepLive2: 1 };
    var moves = genMoves(board, N, color, undefined, applyLst, capOpt);
    if (!moves.length) return evaluateBoard(board, N, color, applyLst);
    var best = -INF, i, m;
    for (i = 0; i < moves.length; i++) {
      m = moves[i];
      board[m] = color;
      var v = -negamax(board, N, opp, depth - 1, -beta, -alpha, m, color, ply + 1, applyLst);
      board[m] = EMPTY;
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 分层候选点选优：被 L3/L5/L6/L7/L10/L11 各层调用，在已选出的候选点里用局部 Negamax
  // 深搜选最优。默认固定深度（候选≤3→深4，≤5→深3，>5→深2）；
  // maxDepth 传入时改用迭代加深（深度 1→maxDepth，预算内尽量深），供 L7/L10/L11 等
  // "多候选 + 无必赢 + 连续做杀"的复杂决策使用——浅层搜索会把所有候选都评估为大负
  // （看不到己方后续反击），必须更深才能区分"堵哪个端点能拖住/反杀"。
  function pickBestBySearch(board, N, me, opp, cands, budget, maxDepth) {
    if (!cands.length) return -1;
    if (cands.length === 1) return cands[0];
    // 预排序：己方威胁 - 对方威胁（仅决定各深度内展开顺序，最终由深搜评估定夺）
    var arr = [], i;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      arr.push({ i: c, d: threatAt(board, N, c, me).value - threatAt(board, N, c, opp, 'def').value });
    }
    arr.sort(function (a, b) { return b.d - a.d; });
    if (arr.length > 10) arr.length = 10;
    _start = _now(); _timeout = false; _hardLimit = budget * 0.95;
    var half = N / 2;
    if (maxDepth > 0) {
      // 迭代加深：每深度只信任当层全部候选都完成的结果（避免部分候选被超时截断造成误导）
      var bestFinal = arr[0].i;
      for (var d = 1; d <= maxDepth; d++) {
        if (_timeout || _now() - _start > budget) break;
        var bestD = -1, bestDV = -INF, allDone = true;
        for (i = 0; i < arr.length; i++) {
          if (_timeout || _now() - _start > budget) { allDone = false; break; }
          var m = arr[i].i;
          board[m] = me;
          var v = -negamax(board, N, opp, d, -INF, INF, m, me, 1);
          board[m] = EMPTY;
          if (_timeout) { allDone = false; break; }
          v -= Math.max(Math.abs(m % N - half), Math.abs((m / N | 0) - half)) * 0.0001;
          if (v > bestDV) { bestDV = v; bestD = m; }
        }
        if (allDone && bestD >= 0) bestFinal = bestD;
      }
      _timeout = false;
      return bestFinal;
    }
    // 固定深度模式（默认）
    var depth = arr.length <= 3 ? 4 : arr.length <= 5 ? 3 : 2;
    var best = -1, bestV = -INF;
    for (i = 0; i < arr.length; i++) {
      var m = arr[i].i;
      if (_timeout) break;
      board[m] = me;
      var v = -negamax(board, N, opp, depth - 1, -INF, INF, m, me, 1);
      board[m] = EMPTY;
      // 等分靠中心
      var mx = m % N, my = (m / N) | 0;
      var cd = Math.max(Math.abs(mx - half), Math.abs(my - half));
      v -= cd * 0.0001;
      if (v > bestV) { bestV = v; best = m; }
    }
    _timeout = false;
    return best >= 0 ? best : arr[0].i;
  }

  /* ==================== 十、总控：决策树主入口（规格第6节） ==================== */

  // 分层漏斗按固定顺序逐层检测（L1~L13），每层"触发即返回"；全部不触发才进 L13 深搜。
  //   执行顺序：L1空盘 → L2成五 → L3/L4防必胜 → L5己方四三 → L6己方活四 → L7防一步必胜
  //            → L8防三三攻防一体 → L9开局进攻(<8子) → L10己方三三 → L11防潜在三三
  //            → L12 VCF → L12防对方VCF → L12b前两手强制斜线 → L13 启发式深搜
  // 层内候选点统一用 pickBestBySearch 做局部 Negamax 选最优；trace 回填 {layer,elapsed,depth}。
  function getMove(board, size, color, timeBudgetMs, trace) {
    size = Math.max(5, size | 0);
    var opp = color === BLACK ? WHITE : BLACK;
    var budget = (typeof timeBudgetMs === 'number' && timeBudgetMs > 0) ? timeBudgetMs : DEFAULT_BUDGET;
    var _t0 = _now();
    function remain() { return Math.max(20, budget - (_now() - _t0)); }
    // 时间策略（用户 2026-08-14 定稿）：决策层（强制层 L1-L13）用满剩余时间——强制层触发即返回
    //   不走 L14，限制只损害选点质量（第21手 L6 需 ~2.4s 选 (12,10)）；openingDecision 仅前7手
    //   本就快（内部再限 2s）。L14 深搜用满整个 budget（相对 L14 开始，不扣前面层耗时）、至少 2s，
    //   总时长允许超过单步限制（用户不掐表计时，确保 AI 能力强大优先）。
    function ret(x, y, layer) {
      if (trace) { trace.layer = layer; trace.elapsed = _now() - _t0; }
      return [x, y];
    }
    var focus = focusCells(board, size);

    // 【L0】己方直接成五：必胜必走（最高优先级）
    var w = findWinMove(board, size, color);
    if (w >= 0) return ret(w % size, (w / size) | 0, 'L0');

    // 【L1/L2】对方已有活四/冲四（对方"一步即连五"的点必须应对）——强制防守
    var winPts = findWinPoints(board, size, opp);
    if (winPts.length) {
      if (hasLiveFour(board, size, opp)) {
        // 【L1】对方活四：候选=活四两个空端（规格），堵任一端。
        //   两端后续发展可能不同（一端连对方做杀线），多候选无必赢 → 迭代加深"往后看"选端
        var l2 = findLiveFourEnds(board, size, opp);
        if (!l2.length) l2 = winPts;
        var m2 = pickBestBySearch(board, size, color, opp, l2, remain(), MAX_ITER_DEPTH);
        return ret(m2 % size, (m2 / size) | 0, 'L1');
      }
      // 【L2】对方冲四：候选=冲四唯一空端（含跳冲四缺口），堵唯一空端
      var m3 = pickBestBySearch(board, size, color, opp, winPts, remain(), MAX_ITER_DEPTH);
      return ret(m3 % size, (m3 / size) | 0, 'L2');
    }

    // 【L3】己方四三/四四（必胜组合杀）：有就主动走，抢在对手之前
    var l4 = findOwn43_44(board, size, color);
    if (l4.length) {
      var m4 = pickBestBySearch(board, size, color, opp, l4, remain(), MAX_ITER_DEPTH);
      return ret(m4 % size, (m4 / size) | 0, 'L3');
    }

    // 【L4】己方单活四（非四三/四四的活四）：活四必赢
    var l5 = findOwnLiveFour(board, size, color);
    if (l5.length) {
      var m5 = pickBestBySearch(board, size, color, opp, l5, remain(), MAX_ITER_DEPTH);
      return ret(m5 % size, (m5 / size) | 0, 'L4');
    }

    // 【L5】己方冲四+做杀（潜在四三/四四）：冲四迫使对手应，同时为后续四三/四四铺路，主动进攻
    var l5b = findOwnRush4Kill(board, size, color);
    if (l5b.length) {
      var m5b = pickBestBySearch(board, size, color, opp, l5b, remain(), MAX_ITER_DEPTH);
      return ret(m5b % size, (m5b / size) | 0, 'L5');
    }

    // 【L6】防对方一步必胜威胁（含"冲四+做杀"向后看）：找到能消除全部威胁的堵点
    //   - is43/is44/活四 → 一步必胜；冲四+potentialThreat>0 → 冲四为做杀铺路，同 L6 级，提前堵冲四点
    var l6 = blockCombined(board, size, color, opp);
    if (l6.length) {
      // L6 多候选堵点需"往后看"区分（选堵哪个端点能拖住/反杀），用迭代加深（预算内尽量深）
      var m6 = pickBestBySearch(board, size, color, opp, l6, remain(), MAX_ITER_DEPTH);
      return ret(m6 % size, (m6 / size) | 0, 'L6');
    }
    // 【L7】防三三攻防一体：L6 无法单点全防（敌方多活三/三三）时，找"堵活三又冲四"的点抢先手
    var d43 = findDefendWithRush4(board, size, color, opp);
    if (d43 >= 0) return ret(d43 % size, (d43 / size) | 0, 'L7');

    // 【L8】己方三三：能形成双活三就下（追平/反攻）。三三非必赢，多候选需深搜比较后续发展
    var l8 = findOwn33(board, size, color);
    if (l8.length) {
      var m8 = pickBestBySearch(board, size, color, opp, l8, remain(), MAX_ITER_DEPTH);
      return ret(m8 % size, (m8 / size) | 0, 'L8');
    }

    // 【L9】己方做杀层：① 冲四+潜在三三；② 活三+潜在四三/四四/三三（半径4检测做杀链）
    var l8b = findOwnKillLayer(board, size, color);
    if (l8b.length) {
      var m8b = pickBestBySearch(board, size, color, opp, l8b, remain(), MAX_ITER_DEPTH);
      return ret(m8b % size, (m8b / size) | 0, 'L9');
    }

    // 【L10】防对方潜在三三（含"活三+做杀"向后看）：对方某点落子即成三三 / 活三为做杀铺路。
    //   多候选堵点 + 连续做杀，无必赢局面 → 同样迭代加深"往后看"
    var l9 = blockPotential33(board, size, color, opp);
    if (l9.length) {
      // 用户要求：候选堵点中若有"自己落子后成冲四/活四"的，优先以该攻防一体点为准
      var rush = [], i;
      for (i = 0; i < l9.length; i++) {
        var t = threatAt(board, size, l9[i], color);
        if (t.tier === T_RUSH4 || t.tier === T_LIVE4) rush.push(l9[i]);
      }
      var sel = rush.length ? rush : l9;
      var m9 = pickBestBySearch(board, size, color, opp, sel, remain(), MAX_ITER_DEPTH);
      return ret(m9 % size, (m9 / size) | 0, 'L10');
    }

    // 【L11】VCF 连续冲四强制胜搜索（可搜很深，深度14）
    var vcfMove = vcfWin(board, size, color, 14);
    if (vcfMove >= 0) return ret(vcfMove % size, (vcfMove / size) | 0, 'L11');
    // 【L12】防对方VCF杀：己方无 VCF 必胜但对方有连续冲四必胜（VCF 杀）时，
    //   优先占住对方杀棋首手，打断对方多步杀（时间受 _vcfHard=200ms 约束）
    var oppDef = findOppVcfDefense(board, size, color);
    if (oppDef >= 0) return ret(oppDef % size, (oppDef / size) | 0, 'L12');

    // 【L13】开局决策层：前7手定式（合并升级原 L1 空盘天元 / L9 开局进攻 / L12b 强制斜线），
    // 位于 L14 深搜前。强制层（L0-L12）均不触发时，由本层提供开局定式：执黑 1/3/5/7 手、
    // 执白 2/4/6 手。返回 -1 表示无开局定式，交给 L14 深搜兜底。
    var od = openingDecision(board, size, color, remain());
    if (od >= 0) return ret(od % size, (od / size) | 0, 'L13');

    // 【L14】启发式深度搜索（兜底层，所有强制层都不触发时）：迭代加深 1→MAX_ITER_DEPTH + 时间硬上限
    _start = _now(); _timeout = false; _nodes = 0;
    // ⚠ 2026-08-14 bug：原循环内每深度 _hardLimit=remain()，但 negamax 判 `_now()-_start > _hardLimit`
    //   用的是"从 _start 起总耗时"——已耗超过剩余时立即超时，深度7+ 一开局就被判超时、提前退出。
    //   现预算上限设一次为整个 budget（相对 L14 开始 _start，不扣前面决策层耗时；用户 2026-08-14
    //   定稿：L14 用满预算、至少 2s，允许总时长超过单步限制，确保 AI 能力强大优先）。
    _hardLimit = Math.max(budget, 2000);
    // 顶层落点选择启用"全局攻防态势判断"（applyDefense=true）与"黑堵白降权"（applyLst=true）
    // + 分类分组截断（cap11：冲四2 活三2 活二1，补齐到11——比内部层多2个，顶层看得更全）
    var moves = genMoves(board, size, color, true, true,
      color === BLACK
        ? { cap: 10, keepRush4: 0, keepLive3: 0, keepLive2: 0 }   // 黑：不分桶（纯分数10）
        : { cap: 11, keepRush4: 2, keepLive3: 2, keepLive2: 1 }); // 白：分桶（保2/2/1 补齐到11）
    if (!moves.length) { if (trace) { trace.layer = 'L14'; trace.elapsed = _now() - _t0; } return null; }
    var best = moves[0], d;
    // 迭代加深 1→MAX_ITER_DEPTH：浅层快速完成、预算尽量留给深层；某层超时则截断（返回已完成的深层 best）。
    // ⚠ 深度上限 2026-08-14 从 6 提高到 12——原 6 层完成即停导致 10s 预算只搜 3.3s 提前截断；
    //   现"时间到"才是截断条件，深度6为下限、预算内尽量更深。曾限制深度5 被用户否决，勿再取巧限深度。
    // ⚠ 超时判断用 `_now()-_start`（L14 自身耗时）而非 `_now()-_t0`（getMove 总耗时）——前面决策层
    //   耗时不被扣减，L14 始终用满整个预算（总时长允许超单步限制，用户 2026-08-14）。
    for (d = 1; d <= MAX_ITER_DEPTH; d++) {
      if (_now() - _start > budget) break;
      var alpha = -INF, depthBest = -1;
      for (var i = 0; i < moves.length; i++) {
        if (_timeout || _now() - _start > budget) break;
        var m = moves[i];
        board[m] = color;
        // L13 顶层应用启发式评估（applyLst=true）：evaluateBoard 纳入局部棋型密度（黑白对称）
        var v = -negamax(board, size, opp, d - 1, -INF, alpha, m, color, 1, true);
        board[m] = EMPTY;
        if (v > alpha) { alpha = v; depthBest = m; }
      }
      if (depthBest < 0 || _timeout) break;
      best = depthBest;
      if (trace) trace.depth = d;   // 记录实际达到的搜索深度（调试/日志用）
      if (_now() - _start > budget) break;
    }
    _timeout = false;
    if (best < 0) best = moves[0];
    return ret(best % size, (best / size) | 0, 'L14');
  }

  /* ==================== 十一、API 导出 ==================== */

  // getMove 是总控（game.js 每步只调它）；其余（BLACK/WHITE/EMPTY + 检测函数）供冒烟/单元测试与调试用
  var api = {
    getMove: getMove,
    BLACK: BLACK, WHITE: WHITE, EMPTY: EMPTY,
    // 调试/冒烟测试用
    threatAt: threatAt, lineType: lineType, evaluateBoard: evaluateBoard,
    V: V, findLiveFourEnds: findLiveFourEnds, findWinMove: findWinMove,
    blockCombined: blockCombined, blockPotential33: blockPotential33,
    findOwn33: findOwn33, findWinPoints: findWinPoints,
    findOwn43_44: findOwn43_44, findOwnLiveFour: findOwnLiveFour,
    findOwnRush4Kill: findOwnRush4Kill, findOwnKillLayer: findOwnKillLayer,
    live2Value: live2Value, findDoubleLive2Points: findDoubleLive2Points,
    potentialThreat: potentialThreat, vcfWin: vcfWin,
    genMoves: genMoves, negamax: negamax, evaluateBoard: evaluateBoard,
    probe: function (board, N, color, m, depth, budgetMs, applyLst) {
      _start = _now(); _timeout = false; _hardLimit = budgetMs;
      var opp = color === BLACK ? WHITE : BLACK;
      board[m] = color;
      var v = -negamax(board, N, opp, depth - 1, -INF, INF, m, color, 1, applyLst);
      board[m] = 0;
      return v;
    }
  };
  global.GomokuAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
