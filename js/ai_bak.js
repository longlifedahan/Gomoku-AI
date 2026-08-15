/*
 * 五子棋 AI
 * 算法：启发式评估 + Negamax α-β 剪枝 + 迭代加深 + 候选点裁剪
 * 棋盘用一维数组 board[idx]，idx = y*size + x；0=空 1=黑 2=白
 *
 * 难度 1-100 通过以下参数体现：
 *   - 搜索深度   maxDepth = 2 + floor(难度/16)          (2 ~ 8)
 *   - 候选点数量 rootLimit = 6 + floor(难度/12)          (6 ~ 14)
 *   - 时间预算   budget = 250 + 难度*10 ms               (0.26s ~ 1.25s)
 *   - 低难度偶发失误：难度<40 时随机在 top-3 里选较差的一手
 * 另有硬时间上限防止单步超时，保证每步 < 2s。
 */
(function (global) {
  'use strict';

  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  var INF = 1000000000;

  // 形状权重：五连 > 活四 > 冲四 > 活三 > 冲三 > 活二 > 眠二
  // 权重刻意拉开梯度，让"进攻冲四/活三"与"防守堵活二/堵三"成为首要目标。
  var SC = {
    FIVE: 100000000,
    LIVE_FOUR: 10000000,
    RUSH_FOUR: 1000000,
    LIVE_THREE: 100000,
    RUSH_THREE: 10000,
    LIVE_TWO: 1000,
    SLEEP_TWO: 100,
    ONE: 20
  };
  // 单方向形状达到该分值以上即视为一个"威胁"（活四 / 冲四 / 活三）
  var THREAT = SC.LIVE_THREE;
  // 一手形成"双三 / 四三 / 双四"等双威胁（接近必胜）时额外加成
  var DOUBLE_BONUS = 5000000;
  // "威胁储量"评估：双活二 / (活二+活三) 是潜在双威胁，略加权重（越多的活二活三越接近必胜）
  var POTENTIAL_2 = 30000;    // 2 个活二 → 潜在双三
  var POTENTIAL_23 = 40000;   // 活二 + 活三 → 潜在四三/双三
  // 候选点排序时的防守权重：偏向堵住对方的活二/活三，防止被逐步逼死
  var DEFENSE_WEIGHT = 1.3;

  function classify(stones, open) {
    if (stones >= 5) return SC.FIVE;
    if (stones === 4) return open === 2 ? SC.LIVE_FOUR : open === 1 ? SC.RUSH_FOUR : 0;
    if (stones === 3) return open === 2 ? SC.LIVE_THREE : open === 1 ? SC.RUSH_THREE : 0;
    if (stones === 2) return open === 2 ? SC.LIVE_TWO : open === 1 ? SC.SLEEP_TWO : 0;
    if (stones === 1) return open === 2 ? SC.ONE : 0;
    return 0;
  }

  // 把形状得分映射成"范式层级"：0 无 / 1 活二 / 2 冲三 / 3 活三 / 4 冲四 / 5 活四 / 6 五连
  function tierOf(sc) {
    if (sc >= SC.FIVE) return 6;
    if (sc >= SC.LIVE_FOUR) return 5;
    if (sc >= SC.RUSH_FOUR) return 4;
    if (sc >= SC.LIVE_THREE) return 3;
    if (sc >= SC.RUSH_THREE) return 2;
    if (sc >= SC.LIVE_TWO) return 1;
    return 0;
  }
  // 进攻先手 / 防守必挡的范式层级阈值
  var FORCE_TIER = 4;   // 形成冲四/活四（先手节奏）
  var MUST_TIER = 3;    // 对方在此可成活三及以上（必挡范式）
  var ATTACK_FORCE_BONUS = 200000;
  var BLOCK_THREAT_BONUS = 150000;

  function inB(x, y, size) { return x >= 0 && x < size && y >= 0 && y < size; }

  // 在空点 (idx) 落子 color 后，该点四方向形状信息（含跳子延伸）
  // 返回 { score: 得分(含双威胁加成), maxTier: 最强范式层级, threatCount: ≥活三的方向数 }
  function shapeInfoAt(board, size, idx, color) {
    var x = idx % size, y = (idx / size) | 0;
    var total = 0, maxTier = 0, threatCount = 0, k;
    for (k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1];
      var stones = 1, open = 0;
      // 正向：连续子
      var fx = x + dx, fy = y + dy, run = 0;
      while (inB(fx, fy, size) && board[fy * size + fx] === color) { run++; fx += dx; fy += dy; }
      stones += run;
      // 正向：跳子延伸（空一格后还有同色子）
      if (inB(fx, fy, size) && board[fy * size + fx] === EMPTY) {
        var gx = fx + dx, gy = fy + dy;
        if (inB(gx, gy, size) && board[gy * size + gx] === color) {
          var jr = 0;
          while (inB(gx, gy, size) && board[gy * size + gx] === color) { jr++; gx += dx; gy += dy; }
          stones += jr;
          if (inB(gx, gy, size) && board[gy * size + gx] === EMPTY) open++;
        } else open++;
      }
      // 反向：连续子
      var bx = x - dx, by = y - dy; run = 0;
      while (inB(bx, by, size) && board[by * size + bx] === color) { run++; bx -= dx; by -= dy; }
      stones += run;
      // 反向：跳子延伸
      if (inB(bx, by, size) && board[by * size + bx] === EMPTY) {
        var gx2 = bx - dx, gy2 = by - dy;
        if (inB(gx2, gy2, size) && board[gy2 * size + gx2] === color) {
          var jr2 = 0;
          while (inB(gx2, gy2, size) && board[gy2 * size + gx2] === color) { jr2++; gx2 -= dx; gy2 -= dy; }
          stones += jr2;
          if (inB(gx2, gy2, size) && board[gy2 * size + gx2] === EMPTY) open++;
        } else open++;
      }
      var sc = classify(stones, open);
      var tier = tierOf(sc);
      total += sc;
      if (tier > maxTier) maxTier = tier;
      if (tier >= MUST_TIER) threatCount++;
    }
    // 双三 / 四三 / 双四（2 个及以上威胁方向）→ 接近必胜
    if (threatCount >= 2) total += DOUBLE_BONUS;
    return { score: total, maxTier: maxTier, threatCount: threatCount };
  }

  // ---------- 整盘静态评估：逐线扫描，每段只计一次，支持跳子 ----------
  var _linesCache = {};
  function getLines(size) {
    if (_linesCache[size]) return _linesCache[size];
    var lines = [], i, j, d, s;
    for (i = 0; i < size; i++) {
      var row = [], col = [];
      for (j = 0; j < size; j++) { row.push(i * size + j); col.push(j * size + i); }
      lines.push(row, col);
    }
    for (d = -(size - 1); d <= size - 1; d++) {
      var l = [];
      for (j = 0; j < size; j++) { var y = j - d; if (y >= 0 && y < size) l.push(y * size + j); }
      if (l.length >= 5) lines.push(l);
    }
    for (s = 0; s <= 2 * size - 2; s++) {
      var l2 = [];
      for (j = 0; j < size; j++) { var y2 = s - j; if (y2 >= 0 && y2 < size) l2.push(y2 * size + j); }
      if (l2.length >= 5) lines.push(l2);
    }
    _linesCache[size] = lines;
    return lines;
  }

  function evalLine(line, board, color, thr, two) {
    var L = line.length, i = 0, lineScore = 0;
    while (i < L) {
      var c = board[line[i]];
      if (c === EMPTY) { i++; continue; }
      var j = i + 1;
      while (j < L && board[line[j]] === c) j++;
      var stones = j - i, open = 0;
      if (i > 0 && board[line[i - 1]] === EMPTY) open++;
      var next = j;
      if (j < L && board[line[j]] === EMPTY) {
        var k = j + 1;
        if (k < L && board[line[k]] === c) {
          while (k < L && board[line[k]] === c) k++;
          stones += k - (j + 1);
          next = k;
          if (k < L && board[line[k]] === EMPTY) open++;
        } else { open++; next = j + 1; }
      }
      var sc = classify(stones, open);
      lineScore += (c === color) ? sc : -sc;
      // 威胁储量：活三及以上计为威胁；活二计入"潜在双威胁"统计
      if (sc >= THREAT) {
        if (c === color) thr[0]++; else thr[1]++;
      } else if (sc === SC.LIVE_TWO) {
        if (c === color) two[0]++; else two[1]++;
      }
      i = next;
    }
    return lineScore;
  }

  // "威胁储量"加成：越多活二/活三，越接近成双威胁
  function potentialBonus(twoMine, threeMine) {
    if (twoMine >= 2) return POTENTIAL_2;                        // 双活二 → 潜在双三
    if (twoMine >= 1 && threeMine >= 1) return POTENTIAL_23;     // 活二+活三 → 潜在四三/双三
    return 0;
  }

  function evaluateBoard(board, size, color) {
    var lines = getLines(size), total = 0;
    var thr = [0, 0], two = [0, 0];
    for (var i = 0; i < lines.length; i++) total += evalLine(lines[i], board, color, thr, two);
    // 轮到的颜色已具备 2 个以上威胁（双三 / 四三 / 双四）→ 接近必胜；对手亦然
    if (thr[0] >= 2) total += DOUBLE_BONUS;
    if (thr[1] >= 2) total -= DOUBLE_BONUS;
    // 威胁储量（活二/活三越多，潜在双威胁越强）——对称，保持 negamax 正确
    total += potentialBonus(two[0], thr[0]) - potentialBonus(two[1], thr[1]);
    return total;
  }

  function isWinAt(board, size, idx, color) {
    var x = idx % size, y = (idx / size) | 0, k, s;
    for (k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1], cnt = 1;
      for (s = 1; s < 5; s++) {
        var nx = x + dx * s, ny = y + dy * s;
        if (!inB(nx, ny, size) || board[ny * size + nx] !== color) break;
        cnt++;
      }
      for (s = 1; s < 5; s++) {
        var nx2 = x - dx * s, ny2 = y - dy * s;
        if (!inB(nx2, ny2, size) || board[ny2 * size + nx2] !== color) break;
        cnt++;
      }
      if (cnt >= 5) return true;
    }
    return false;
  }

  // ---------- 候选点生成：距棋子 2 格内空点，按 进攻+防守 启发分取前 limit 个 ----------
  var _markBuf = new Int32Array(225);
  var _markGen = 1;
  var _candBuf = new Int32Array(225);
  var _scoreBuf = new Float64Array(225);
  var _topBuf = new Int32Array(225);

  function ensureBufs(n) {
    if (_markBuf.length < n) {
      _markBuf = new Int32Array(n);
      _candBuf = new Int32Array(n);
      _scoreBuf = new Float64Array(n);
      _topBuf = new Int32Array(n);
    }
  }

  function genMoves(board, size, color, limit) {
    ensureBufs(size * size);
    _markGen = (_markGen + 1) | 0;
    if (_markGen === 0) _markGen = 1;
    var mark = _markBuf, n = size * size;
    var candLen = 0, stones = 0, idx;
    for (idx = 0; idx < n; idx++) {
      if (board[idx] === EMPTY) continue;
      stones++;
      var x = idx % size, y = (idx / size) | 0;
      var x0 = x > 2 ? x - 2 : 0, x1 = x + 2 < size ? x + 2 : size - 1;
      var y0 = y > 2 ? y - 2 : 0, y1 = y + 2 < size ? y + 2 : size - 1;
      for (var yy = y0; yy <= y1; yy++) {
        var base = yy * size;
        for (var xx = x0; xx <= x1; xx++) {
          var ni = base + xx;
          if (board[ni] === EMPTY && mark[ni] !== _markGen) {
            mark[ni] = _markGen;
            _candBuf[candLen++] = ni;
          }
        }
      }
    }
    if (stones === 0) {
      var c = (size / 2) | 0;
      return [c * size + c];
    }
    var opp = color === BLACK ? WHITE : BLACK;
    for (var i = 0; i < candLen; i++) {
      var ci = _candBuf[i];
      var a = shapeInfoAt(board, size, ci, color);
      var d = shapeInfoAt(board, size, ci, opp);
      // 进攻 + 防守（防守加权，优先破坏对方范式）
      var s = a.score + d.score * DEFENSE_WEIGHT;
      // 走自己范式：能形成冲四/活四等先手威胁 → 略加权重（抢主动权）
      if (a.maxTier >= FORCE_TIER) s += ATTACK_FORCE_BONUS;
      // 破坏敌人范式：对方在此可形成活三及以上威胁 → 优先抢占/堵
      if (d.maxTier >= MUST_TIER) s += BLOCK_THREAT_BONUS;
      _scoreBuf[i] = s;
    }
    var k = limit < candLen ? limit : candLen;
    var t;
    for (t = 0; t < k; t++) _topBuf[t] = -1;
    for (i = 0; i < candLen; i++) {
      var s = _scoreBuf[i];
      for (t = 0; t < k; t++) {
        if (_topBuf[t] === -1) { _topBuf[t] = i; break; }
        if (s > _scoreBuf[_topBuf[t]]) {
          for (var u = k - 1; u > t; u--) _topBuf[u] = _topBuf[u - 1];
          _topBuf[t] = i;
          break;
        }
      }
    }
    var res = [];
    for (t = 0; t < k; t++) res.push(_candBuf[_topBuf[t]]);
    return res;
  }

  function findWinningMove(board, size, color) {
    var n = size * size, idx;
    for (idx = 0; idx < n; idx++) {
      if (board[idx] !== EMPTY) continue;
      board[idx] = color;
      var won = isWinAt(board, size, idx, color);
      board[idx] = EMPTY;
      if (won) return idx;
    }
    return -1;
  }

  // ---------- 范式快速层（不依赖搜索深度） ----------
  // 找一方可形成"双威胁"（双三 / 四三 / 双四）的必胜点
  function findDoubleThreat(board, size, color) {
    var n = size * size, idx;
    for (idx = 0; idx < n; idx++) {
      if (board[idx] !== EMPTY) continue;
      if (shapeInfoAt(board, size, idx, color).threatCount >= 2) return idx;
    }
    return -1;
  }
  // 找一方可形成"连续活四"（4 连 + 两端开口，必胜范式）的点
  function findContiguousLiveFour(board, size, color) {
    var n = size * size, idx, k;
    for (idx = 0; idx < n; idx++) {
      if (board[idx] !== EMPTY) continue;
      var x = idx % size, y = (idx / size) | 0;
      for (k = 0; k < 4; k++) {
        var dx = DIRS[k][0], dy = DIRS[k][1];
        var fwd = 0, bx = x + dx, by = y + dy;
        while (inB(bx, by, size) && board[by * size + bx] === color) { fwd++; bx += dx; by += dy; }
        var back = 0, cx = x - dx, cy = y - dy;
        while (inB(cx, cy, size) && board[cy * size + cx] === color) { back++; cx -= dx; cy -= dy; }
        if (fwd + back === 3 &&
            inB(bx, by, size) && board[by * size + bx] === EMPTY &&
            inB(cx, cy, size) && board[cy * size + cx] === EMPTY) {
          return idx;
        }
      }
    }
    return -1;
  }
  // 找能"破坏对手必胜范式"的挡点：占据后对手不再能成活四 / 双威胁
  function findBlockMove(board, size, opp) {
    var n = size * size, pts = [], idx;
    for (idx = 0; idx < n; idx++) {
      if (board[idx] !== EMPTY) continue;
      var info = shapeInfoAt(board, size, idx, opp);
      if (info.maxTier >= 5 || info.threatCount >= 2) pts.push(idx);
    }
    if (pts.length === 0) return -1;
    var me = opp === BLACK ? WHITE : BLACK;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      board[p] = me;
      var still = false;
      for (idx = 0; idx < n; idx++) {
        if (board[idx] !== EMPTY) continue;
        var info2 = shapeInfoAt(board, size, idx, opp);
        if (info2.maxTier >= 5 || info2.threatCount >= 2) { still = true; break; }
      }
      board[p] = EMPTY;
      if (!still) return p;
    }
    return pts[0];
  }

  // ---------- Negamax + α-β 剪枝 ----------
  var _nodes = 0, _timeout = false, _searchStart = 0, _hardLimit = 0;

  function negamax(board, size, color, depth, alpha, beta, lastIdx, opp, limit, ply) {
    if (_timeout) return 0;
    if (lastIdx >= 0 && isWinAt(board, size, lastIdx, opp)) return -(INF - ply);
    if (depth <= 0) return evaluateBoard(board, size, color);
    if ((++_nodes & 511) === 0 && _now() - _searchStart > _hardLimit) { _timeout = true; return 0; }
    var moves = genMoves(board, size, color, limit);
    if (moves.length === 0) return 0;
    var best = -INF, i, m;
    for (i = 0; i < moves.length; i++) {
      m = moves[i];
      board[m] = color;
      var v = -negamax(board, size, opp, depth - 1, -beta, -alpha, m, color, limit, ply + 1);
      board[m] = EMPTY;
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  var _now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? function () { return performance.now(); } : function () { return Date.now(); };

  // ---------- 对外主入口 ----------
  function getMove(board, size, color, difficulty) {
    difficulty = Math.max(1, Math.min(100, difficulty | 0));
    var opp = color === BLACK ? WHITE : BLACK;
    var n = size * size, idx, any = false;
    for (idx = 0; idx < n; idx++) if (board[idx] !== EMPTY) { any = true; break; }
    if (!any) {
      var c = (size / 2) | 0;
      return [c, c];
    }
    // 快速层：直接获胜 / 必须堵
    var w = findWinningMove(board, size, color);
    if (w >= 0) return [w % size, (w / size) | 0];
    var b = findWinningMove(board, size, opp);
    if (b >= 0) return [b % size, (b / size) | 0];

    // 范式快速层：走自己的必胜范式 / 破坏敌人的必胜范式
    // 1) 自己能成"连续活四"（必胜范式）→ 走它
    var lf = findContiguousLiveFour(board, size, color);
    if (lf >= 0) return [lf % size, (lf / size) | 0];
    // 2) 自己能成"双威胁"（双三/四三/双四）→ 走它（接近必胜）
    var dt = findDoubleThreat(board, size, color);
    if (dt >= 0) return [dt % size, (dt / size) | 0];
    // 3) 对手的必胜范式点 → 正确破坏（挡活四/活三/双威胁）
    var blk = findBlockMove(board, size, opp);
    if (blk >= 0) return [blk % size, (blk / size) | 0];

    var maxDepth = 2 + Math.floor(difficulty / 16);
    var rootLimit = 6 + Math.floor(difficulty / 12);
    var interiorLimit = Math.max(4, Math.round(rootLimit * 0.6));
    var budget = 250 + difficulty * 10;
    _hardLimit = budget + 150;

    var rootMoves = genMoves(board, size, color, rootLimit);
    if (rootMoves.length === 0) return null;
    if (rootMoves.length === 1) {
      var r0 = rootMoves[0];
      return [r0 % size, (r0 / size) | 0];
    }

    var t0 = _now();
    _nodes = 0; _timeout = false; _searchStart = t0;
    var best = rootMoves[0], d, mv;
    for (d = 1; d <= maxDepth; d++) {
      var alpha = -INF, depthBest = -1;
      for (var i = 0; i < rootMoves.length; i++) {
        if (d > 1 && (_now() - t0 > budget || _timeout)) break;
        mv = rootMoves[i];
        board[mv] = color;
        var v = -negamax(board, size, opp, d - 1, -INF, -alpha, mv, color, interiorLimit, 1);
        board[mv] = EMPTY;
        if (v > alpha) { alpha = v; depthBest = mv; }
      }
      if (depthBest < 0 || _timeout) break;
      best = depthBest;
      if (_now() - t0 > budget) break;
    }
    _timeout = false;

    // 低难度偶发失误
    if (difficulty < 40 && rootMoves.length > 2) {
      var p = (40 - difficulty) / 100;
      if (Math.random() < p) {
        var j = 1 + Math.floor(Math.random() * Math.min(2, rootMoves.length - 1));
        best = rootMoves[j];
      }
    }
    var bx = best % size, by = (best / size) | 0;
    return [bx, by];
  }

  var api = { getMove: getMove, BLACK: BLACK, WHITE: WHITE, EMPTY: EMPTY };
  global.GomokuAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
