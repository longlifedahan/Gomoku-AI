/* 五子棋游戏逻辑 + UI（首页 / 设置 / 对局 / 计时 / 悔棋 / 存档 / 战绩榜） */
(function () {
  'use strict';

  var SIZE = 17;              // 标准 17×17 棋盘（旧 15×15 存档长度不匹配自动失效）
  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var KEY_SETTINGS = 'gomoku.settings';
  var KEY_SAVE = 'gomoku.save';
  var KEY_HISTORY = 'gomoku.history';
  var KEY_LB = 'gomoku.leaderboard';
  var SETTINGS_VERSION = 4;    // 设置版本：历史用户升级后重置进攻性选择为新默认"自适应"
  // ⚠ 全局榜新编码（2026-08-12 用户）：所有新 score 从 100w 基准开始，<100w 为老数据（云端无法删，客户端过滤不展示）。
  //   榜1 执黑胜次数 = 100w + 黑胜次数；榜2 执白胜次数 = 100w + 白胜次数；榜3 执白胜最少步数 = 100w + 1000 - K
  var SCORE_BASE = 1000000;           // 新数据基准（老数据 score < 100w 忽略）
  var MOVES_BASE = 1000;              // 榜3 步数编码基数：score = 100w + 1000 - 步数（步数少=分高）
  var BOARD_BLACK = 1;                // 榜位 1：执黑胜次数
  var BOARD_WHITE = 2;                // 榜位 2：执白胜次数
  var BOARD_WHITEMOVES = 3;           // 榜位 3：执白胜最少步数

  // ---------- 设置持久化 ----------
  // 设备检测（用户 2026-08-14）：首次进入默认 AI 思考时间按设备区分——手机 5s / 电脑 3.5s。
  // 移动端 WebView（B站 App）UA 含移动关键词；Node 测试无 navigator 时返回 false（默认 3.5s，保测试稳定）。
  function isMobileDevice() {
    return typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod|Mobile|Mobi/i.test(navigator.userAgent || '');
  }
  function loadSettings() {
    var def = { first: 'white', customK: 1.0, searchTime: isMobileDevice() ? 5 : 3.5, sound: false, decisionTree: true, version: SETTINGS_VERSION };
    try {
      var raw = localStorage.getItem(KEY_SETTINGS);
      if (raw) {
        var s = JSON.parse(raw);
        var oldVer = !s.version || s.version < SETTINGS_VERSION;
        return {
          first: ['black', 'white', 'random'].indexOf(s.first) >= 0 ? s.first : def.first,
          customK: (typeof s.customK === 'number' && s.customK >= 0.8 && s.customK <= 1.25) ? s.customK : def.customK,
          // 历史存档搜索时间统一刷新为新默认 3.5s（旧默认曾为 2.5s）
          searchTime: oldVer ? def.searchTime : ((typeof s.searchTime === 'number' && s.searchTime >= 2 && s.searchTime <= 10) ? s.searchTime : def.searchTime),
          sound: typeof s.sound === 'boolean' ? s.sound : def.sound,   // 声音默认关
          decisionTree: typeof s.decisionTree === 'boolean' ? s.decisionTree : def.decisionTree,   // 决策树默认启用
          version: SETTINGS_VERSION
        };
      }
    } catch (e) { /* 忽略 */ }
    return def;
  }
  function clampInt(v, min, max, def) {
    v = parseInt(v, 10);
    if (isNaN(v)) return def;
    return Math.max(min, Math.min(max, v));
  }
  function saveSettings() {
    try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
  }

  var settings = loadSettings();

  // ---------- 对局状态 ----------
  var board = [];                 // 一维数组 idx = y*SIZE+x
  var turn = BLACK;
  var playerColor = BLACK;
  var aiColor = WHITE;
  var over = false;
  var winner = null;              // 0 平局 / 1 黑 / 2 白
  var lastMove = -1;
  var aiThinking = false;
  var movesHist = [];             // 悔棋用落子历史 [{idx, color}]
  var gameStart = 0;              // 本局开始时间戳
  var timerId = null;             // 计时器句柄
  var curElapsed = 0;             // 本局累计用时（ms）
  var lastWinElapsed = 0;         // 最近一次获胜用时（用于榜单同步）
  var lbInvalid = false;          // 本局曾悔棋/使用帮助 → 不计入排行榜
  var resultClosed = false;       // 已关闭结算条（完整查看残局）
  var helpMove = null;            // 帮助建议点 {x,y}（虚影提示）
  var lastMoveAt = 0;             // 上次落子时间戳（用于统计玩家思考时长）
  var gameMode = 'ai';            // 对局模式：'ai' 对战 AI / 'pvp' 人工对战（一人操控黑白）

  function newBoard() {
    var b = new Array(SIZE * SIZE);
    for (var i = 0; i < b.length; i++) b[i] = EMPTY;
    return b;
  }
  function isFull() {
    for (var i = 0; i < board.length; i++) if (board[i] === EMPTY) return false;
    return true;
  }

  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  function checkWinAt(idx, color) {
    var x = idx % SIZE, y = (idx / SIZE) | 0;
    for (var k = 0; k < 4; k++) {
      var dx = DIRS[k][0], dy = DIRS[k][1], cnt = 1, s;
      for (s = 1; s < 5; s++) {
        var nx = x + dx * s, ny = y + dy * s;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || board[ny * SIZE + nx] !== color) break;
        cnt++;
      }
      for (s = 1; s < 5; s++) {
        var nx2 = x - dx * s, ny2 = y - dy * s;
        if (nx2 < 0 || nx2 >= SIZE || ny2 < 0 || ny2 >= SIZE || board[ny2 * SIZE + nx2] !== color) break;
        cnt++;
      }
      if (cnt >= 5) return true;
    }
    return false;
  }

  // ---------- 计时 ----------
  function startTimer() {
    if (timerId !== null || over) return;
    gameStart = Date.now() - curElapsed;
    updateTimer();
    timerId = setInterval(updateTimer, 250);
  }
  function stopTimer() {
    if (timerId !== null) { clearInterval(timerId); timerId = null; }
    if (gameStart) curElapsed = Date.now() - gameStart;
  }
  function elapsedMs() {
    return gameStart ? Date.now() - gameStart : curElapsed;
  }
  function updateTimer() {
    var el = document.getElementById('game-timer');
    if (el) el.textContent = '用时 ' + fmtTime(elapsedMs());
  }
  function fmtTime(ms) {
    ms = Math.max(0, Math.round(ms));
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
    s %= 60; m %= 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return m + ':' + pad2(s);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ---------- 存档 ----------
  function saveGame() {
    try {
      localStorage.setItem(KEY_SAVE, JSON.stringify({
        board: board, turn: turn, playerColor: playerColor, aiColor: aiColor,
        gameMode: gameMode,
        lastMove: lastMove, over: over, winner: winner, settings: settings,
        movesHist: movesHist, elapsed: curElapsed, lbInvalid: lbInvalid
      }));
    } catch (e) { /* 忽略 */ }
  }
  function loadSave() {
    try {
      var raw = localStorage.getItem(KEY_SAVE);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.board || s.board.length !== SIZE * SIZE) return null;
      return s;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(KEY_SAVE); } catch (e) { /* 忽略 */ }
  }

  // ---------- 本地战绩（2026-08-12 新榜：执黑/执白胜次数，老数据清除） ----------
  var LB_VERSION = 4;
  function emptyLB() {
    return { blackWins: 0, wins100: 0, fastestMs: 0, bestMoves: 0, games: 0, wins: 0,
      blackFastestList: [], blackMovesList: [], whiteFastestList: [], whiteMovesList: [],
      version: LB_VERSION };
  }
  function loadLB() {
    try {
      var raw = localStorage.getItem(KEY_LB);
      if (raw) {
        var o = JSON.parse(raw);
        if (o.version !== LB_VERSION) return emptyLB();   // 老数据清除（本地可删）
        var norm = function (list, key) {
          var out = [];
          if (Array.isArray(list)) {
            for (var i = 0; i < list.length; i++) {
              var e = list[i];
              if (typeof e === 'object' && e !== null) out.push(e);
              else { var o2 = {}; o2[key] = e; o2.ts = 0; out.push(o2); }
            }
          }
          return out;
        };
        return {
          blackWins: o.blackWins | 0, wins100: o.wins100 | 0,
          fastestMs: o.fastestMs | 0, bestMoves: o.bestMoves | 0,
          games: o.games | 0, wins: o.wins | 0,
          blackFastestList: norm(o.blackFastestList, 'ms'), blackMovesList: norm(o.blackMovesList, 'moves'),
          whiteFastestList: norm(o.whiteFastestList, 'ms'), whiteMovesList: norm(o.whiteMovesList, 'moves'),
          version: LB_VERSION
        };
      }
    } catch (e) { /* 忽略 */ }
    return emptyLB();
  }
  var lb = loadLB();
  function saveLB() {
    try { localStorage.setItem(KEY_LB, JSON.stringify(lb)); } catch (e) { /* 忽略 */ }
  }
  function renderLocalLB() {
    document.getElementById('lb-wins100').textContent = lb.blackWins;   // 执黑胜次数
    document.getElementById('lb-fastest').textContent = lb.wins100;      // 执白胜次数
    document.getElementById('lb-bestmoves').textContent = lb.bestMoves ? lb.bestMoves + ' 手' : '--';
    document.getElementById('lb-total').textContent = lb.games + '/' + lb.wins;
  }
  function renderLbList(id, arr, valFn) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!Array.isArray(arr) || arr.length === 0) {
      el.innerHTML = '<div class="lb-empty">暂无战绩，执白战胜 AI 吧</div>';
      return;
    }
    var rows = '';
    for (var i = 0; i < arr.length && i < 10; i++) {
      rows += '<div class="lb-list-row"><span class="lb-list-rank' + (i < 3 ? ' top' + (i + 1) : '') + '">' +
        (i + 1) + '</span><span class="lb-list-time">' + valFn(arr[i]) + '</span>' +
        '<span class="lb-list-date">' + fmtDate(arr[i].ts) + '</span></div>';
    }
    el.innerHTML = rows;
  }
  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  // 搜索时间是否达到设备默认值（用户 2026-08-18：低于默认 → 成绩不计入排行榜）。
  // 电脑默认 3.5s / 手机（含 B站 WebView）默认 5s，与 loadSettings 的 def.searchTime 一致。
  function searchTimeMeetsDefault() {
    return settings.searchTime >= (isMobileDevice() ? 5 : 3.5);
  }
  // 是否计入排行榜（2026-08-12）：执黑/执白获胜都计入；悔棋/使用帮助（lbInvalid）、人工对战（pvp）、
  // 搜索时间低于设备默认（2026-08-18 用户）不计入
  function winQualifies() {
    if (gameMode === 'pvp' || lbInvalid) return false;
    if (!searchTimeMeetsDefault()) return false;
    return winner === playerColor;
  }
  function recordGameEnd() {
    if (gameMode === 'pvp' || lbInvalid) return;   // 人工对战 / 悔棋 / 使用帮助不计战绩
    if (!searchTimeMeetsDefault()) return;         // 搜索时间低于设备默认不计战绩（2026-08-18 用户）
    lb.games++;
    if (winner === playerColor) {
      lb.wins++;
      var ts = Date.now();
      if (playerColor === BLACK) {
        lb.blackWins++;                            // 执黑胜次数（榜1）
        addFastest('blackFastestList', curElapsed, ts);   // 黑棋最快时间
        addBestMoves('blackMovesList', movesHist.length, ts); // 黑棋最少手数
      } else {
        lb.wins100++;                              // 执白胜次数（榜2）
        addFastest('whiteFastestList', curElapsed, ts);    // 白棋最快时间
        addBestMoves('whiteMovesList', movesHist.length, ts); // 白棋最少手数（榜3）
        lb.bestMoves = (lb.whiteMovesList[0] || {}).moves || 0;
      }
    }
    saveLB();
  }
  // 记录某方最快用时列表（保留前50），listKey 如 'blackFastestList'/'whiteFastestList'
  function addFastest(listKey, ms, ts) {
    var list = lb[listKey] = lb[listKey] || [];
    list.push({ ms: ms, ts: ts });
    list.sort(function (a, b) { return a.ms - b.ms; });
    if (list.length > 50) list.length = 50;
    lb.fastestMs = list[0].ms;
  }
  // 记录某方最少手数列表（保留前50），listKey 如 'blackMovesList'/'whiteMovesList'
  function addBestMoves(listKey, moves, ts) {
    var list = lb[listKey] = lb[listKey] || [];
    list.push({ moves: moves, ts: ts });
    list.sort(function (a, b) { return a.moves - b.moves; });
    if (list.length > 50) list.length = 50;
  }

  // ---------- 全局榜单（Toy SDK，非阻塞加载） ----------
  var toyReady = false;
  function loadSDK() {
    try {
      if (typeof window.toy !== 'undefined' && window.toy && typeof window.toy.getRankList === 'function') {
        toyReady = true;
        return;
      }
      var s = document.createElement('script');
      s.src = 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
      s.async = true;
      s.onload = function () {
        if (typeof window.toy !== 'undefined' && window.toy) toyReady = true;
      };
      document.head.appendChild(s);
    } catch (e) { /* 非浏览器环境忽略 */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setLbTip(html) {
    document.getElementById('lb-scroll').innerHTML = '<div class="lb-tip">' + html + '</div>';
    document.getElementById('lb-mine').innerHTML = '';
  }

  function openGlobalLB() {
    document.getElementById('top10-modal').hidden = true;
    document.getElementById('global-modal').hidden = false;
    document.getElementById('lb-tabs').hidden = true;
    document.getElementById('lb-period-tabs').hidden = true;
    setLbTip('加载中…');
    var attempts = 0;
    (function waitSDK() {
      if (toyReady) { loadGlobalList(BOARD_BLACK, 'all'); return; }
      if (attempts++ > 10) { setLbTip('请在 B 站 App 内打开本游戏查看全局排行榜'); return; }
      setTimeout(waitSDK, 200);
    })();
  }
  function closeGlobalLB() {
    document.getElementById('global-modal').hidden = true;
  }

  var activeBoard = BOARD_BLACK, activePeriod = 'all';
  function loadGlobalList(boardId, period) {
    activeBoard = boardId;
    activePeriod = period || 'all';
    var tabs = document.getElementById('lb-tabs');
    tabs.hidden = false;
    var btns = tabs.querySelectorAll('.tab');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', (+btns[i].getAttribute('data-board')) === boardId);
    }
    // 日/周/月/总 period tab 高亮
    var ptabs = document.getElementById('lb-period-tabs');
    ptabs.hidden = false;
    var pbtns = ptabs.querySelectorAll('.tab');
    for (var p = 0; p < pbtns.length; p++) {
      pbtns[p].classList.toggle('active', pbtns[p].getAttribute('data-period') === activePeriod);
    }
    setLbTip('加载中…');
    try {
      Promise.all([
        window.toy.getRankList({ board: boardId, period: activePeriod, limit: 100 }).catch(function () { return null; }),
        window.toy.getMyRank({ board: boardId, period: activePeriod }).catch(function () { return null; })
      ]).then(function (res) {
        if (!res[0]) { setLbTip('榜单加载失败，请稍后重试'); return; }
        renderRankList(res[0], res[1], boardId);
      });
    } catch (e) { setLbTip('榜单加载失败，请稍后重试'); }
  }

  // 渲染榜单：过滤老数据（score<100w 不展示），榜单滚动区 + "我"固定底部（竖线分隔）
  function renderRankList(list, mine, boardId) {
    list = list.filter(function (it) { return it.score >= SCORE_BASE; });
    if (!list.length) {
      setLbTip('暂无上榜记录，去执黑/执白战胜 AI 吧');
      return;
    }
    var rows = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      rows += '<div class="lb-row">' +
        '<span class="lb-rank' + (it.rank <= 3 ? ' t' + it.rank : '') + '">' + it.rank + '</span>' +
        (it.avatar ? '<img class="lb-avatar" src="' + esc(it.avatar) + '" alt="">' : '<span class="lb-avatar"></span>') +
        '<span class="lb-name">' + esc(it.nickname) + '</span>' +
        '<span class="lb-score">' + rankScoreText(boardId, it.score) + '</span>' +
        '</div>';
    }
    document.getElementById('lb-scroll').innerHTML = rows;
    // "我"固定底部（竖线分隔），老数据（score<100w）不展示
    var mineEl = document.getElementById('lb-mine');
    if (mine && mine.ranked && mine.score >= SCORE_BASE) {
      mineEl.innerHTML = '<div class="lb-row"><span class="lb-rank">' + mine.rank + '</span>' +
        '<span class="lb-avatar"></span><span class="lb-name">我</span>' +
        '<span class="lb-score">' + rankScoreText(boardId, mine.score) + '</span></div>';
    } else {
      mineEl.innerHTML = '';
    }
  }
  // 新编码展示：榜1/2 = 100w + 次数；榜3 = 100w + 1000 - 步数
  function rankScoreText(boardId, score) {
    var v = score - SCORE_BASE;
    if (boardId === BOARD_BLACK || boardId === BOARD_WHITE) return v + ' 次';
    var m = SCORE_BASE + MOVES_BASE - score;   // 步数
    return (m > 0 && m <= MOVES_BASE) ? m + ' 手' : '-';
  }
  // 新编码上报（2026-08-12）：榜1 执黑胜次数、榜2 执白胜次数、榜3 执白胜最少步数（均有数据才上报）
  function submitScores() {
    if (!toyReady) return;
    try {
      var tasks = [];
      if (lb.blackWins > 0) tasks.push(window.toy.submitScore({ board: BOARD_BLACK, score: SCORE_BASE + lb.blackWins }).catch(function () {}));
      if (lb.wins100 > 0) tasks.push(window.toy.submitScore({ board: BOARD_WHITE, score: SCORE_BASE + lb.wins100 }).catch(function () {}));
      if (lb.bestMoves > 0) tasks.push(window.toy.submitScore({ board: BOARD_WHITEMOVES, score: SCORE_BASE + MOVES_BASE - lb.bestMoves }).catch(function () {}));
      Promise.all(tasks);
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 流程控制 ----------
  function startNewGame() {
    gameMode = 'ai';
    var first = settings.first;
    playerColor = first === 'black' ? BLACK : first === 'white' ? WHITE : (Math.random() < 0.5 ? BLACK : WHITE);
    aiColor = playerColor === BLACK ? WHITE : BLACK;
    initRound();
  }
  // 人工对战：一人操控黑白两方，轮流落子，无 AI
  function startPvpGame() {
    gameMode = 'pvp';
    playerColor = BLACK;
    aiColor = WHITE;
    initRound();
  }
  function restartGame() {
    initRound();
  }
  function initRound() {
    stopTimer();            // 停止旧计时器
    gameStart = 0;          // 计时起点清零，首次落子后才开始计时
    board = newBoard();
    turn = BLACK;
    over = false; winner = null; lastMove = -1; aiThinking = false;
    movesHist = [];
    curElapsed = 0; lastWinElapsed = 0; lbInvalid = false; resultClosed = false;
    helpMove = null; lastMoveAt = 0;
    updateTimer();
    saveGame();
    showGame();
    render();
    if (gameMode === 'ai' && turn === aiColor) scheduleAI();
  }
  function continueGame() {
    var s = loadSave();
    if (!s || s.over) return;
    board = s.board;
    turn = s.turn; playerColor = s.playerColor; aiColor = s.aiColor;
    gameMode = s.gameMode === 'pvp' ? 'pvp' : 'ai';
    lastMove = s.lastMove; over = s.over; winner = s.winner;
    movesHist = s.movesHist || [];
    curElapsed = s.elapsed || 0;
    lbInvalid = !!s.lbInvalid;
    resultClosed = false;
    if (s.settings) {
      var sOldVer = !s.settings.version || s.settings.version < SETTINGS_VERSION;
      settings = {
        first: ['black', 'white', 'random'].indexOf(s.settings.first) >= 0 ? s.settings.first : settings.first,
        customK: (typeof s.settings.customK === 'number' && s.settings.customK >= 0.8 && s.settings.customK <= 1.25) ? s.settings.customK : settings.customK,
        // 历史存档搜索时间统一刷新为新默认 3.5s
        searchTime: sOldVer ? settings.searchTime : ((typeof s.settings.searchTime === 'number' && s.settings.searchTime >= 2 && s.settings.searchTime <= 10) ? s.settings.searchTime : settings.searchTime),
        version: SETTINGS_VERSION
      };
    }
    showGame();
    render();
    if (movesHist.length > 0) startTimer();   // 续玩已有落子的对局时恢复计时
    if (gameMode === 'ai' && !over && turn === aiColor) scheduleAI();
  }

  // ---------- 落子声（Web Audio 生成短音，settings.sound 控制开/关） ----------
  var _audioCtx = null;
  function playStoneSound() {
    if (!settings.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!_audioCtx) _audioCtx = new AC();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      var t = _audioCtx.currentTime;
      var osc = _audioCtx.createOscillator();
      var gain = _audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 520;
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(t); osc.stop(t + 0.09);
    } catch (e) { /* 忽略 */ }
  }

  // ---------- BGM（music/bgm.mp3，随声音开关播放/暂停） ----------
  var bgm = null;
  function initBgm() {
    try {
      bgm = new Audio('music/bgm.mp3');
      bgm.loop = true;
      bgm.volume = 0.5;
    } catch (e) { bgm = null; }
  }
  function updateBgm() {
    if (!bgm) return;
    if (settings.sound) {
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      bgm.pause();
    }
  }
  initBgm();

  function placeStone(x, y, color) {
    var idx = y * SIZE + x;
    if (over || board[idx] !== EMPTY) return false;
    // ⚠ 2026-08-14 二次防线：AI 思考期间禁止玩家落子（AI 落子走 onmessage/aiSyncMove 时
    //   aiThinking 已置 false，color=aiColor 不受影响；此检查兜底 pointerdown 的拦截）
    if (aiThinking && color === playerColor) return false;
    board[idx] = color;
    playStoneSound();   // 落子声（受 settings.sound 控制）
    lastMove = idx;
    if (movesHist.length === 0) startTimer();   // 首次落子后开始计时
    var hand = movesHist.length + 1;
    if (gameMode === 'pvp' || color === playerColor) {
      helpMove = null; // 落子后清除帮助虚影
      var thinkMs = lastMoveAt ? Date.now() - lastMoveAt : 0;
      var who = gameMode === 'pvp' ? (color === BLACK ? '黑' : '白') : '玩家';
      console.log('[' + who + '] 第' + hand + '手 落子[' + x + ',' + y + '] 思考' + thinkMs + 'ms');
    }
    lastMoveAt = Date.now();
    movesHist.push({ idx: idx, color: color });
    if (checkWinAt(idx, color)) {
      over = true; winner = color; clearSave();
    } else if (isFull()) {
      over = true; winner = 0; clearSave();
    } else {
      turn = color === BLACK ? WHITE : BLACK;
    }
    if (over) {
      stopTimer();
      curElapsed = elapsedMs();
      recordGameEnd();
      if (winQualifies()) {
        lastWinElapsed = curElapsed;
        submitScores();   // 后台静默上报（执黑/执白胜次数 + 执白胜最少步数），不阻塞
      }
    }
    saveGame();
    render();
    if (gameMode === 'ai' && !over && turn === aiColor) scheduleAI();
    // 对局结束：结算条出现在底部，重排棋盘以完整显示残局
    if (over) requestAnimationFrame(resizeCanvas);
    return true;
  }

  // 层编号 → 名称（日志输出用，L0 起重新编号）
  function layerName(l) {
    var map = {
      'L0': 'L0(己方直接成五)',
      'L1': 'L1(防对方活四)',
      'L2': 'L2(防对方冲四)',
      'L3': 'L3(己方四三四四)',
      'L4': 'L4(己方活四)',
      'L5': 'L5(己方冲四+做杀)',
      'L6': 'L6(己方VCF连续冲四杀)',
      'L7': 'L7(防一步必胜威胁)',
      'L8': 'L8(防三三攻防一体)',
      'L9': 'L9(防对方VCF杀)',
      'L9b': 'L9b(敌方VCF路上冲四+真三三)',
      'L10': 'L10(己方三三)',
      'L11': 'L11(己方做杀层)',
      'L12': 'L12(防对方冲四+潜在三三)',
      'L13': 'L13(防潜在三三)',
      'L14': 'L14(开局决策层)',
      'L14b': 'L14b(强威胁棋型识别库)',
      'L15': 'L15(启发式深搜)'
    };
    return map[l] || l;
  }

  // ---------- AI 异步思考（Web Worker，不阻塞主线程） ----------
  // 用户 2026-08-14：AI 搜索放到独立线程，主线程正常渲染/计时，思考期间 aiThinking 锁落子/悔棋。
  // 浏览器不支持 Worker 时回退主线程同步计算（getAiWorker 返回 null）。
  var _aiWorker = null, _aiPending = null, _aiTimeout = null;   // _aiPending: 'ai'（对局AI）| 'help'（帮助）
  function getAiWorker() {
    if (_aiWorker) return _aiWorker;
    try {
      _aiWorker = new Worker('js/worker.js');
      _aiWorker.onmessage = onAiWorkerMsg;
      // Worker 加载/运行出错（如 file:// 环境禁用 Worker）→ 静默回退主线程同步，不打印日志
      _aiWorker.onerror = function () { _aiWorker = null; };
    } catch (e) { _aiWorker = null; }
    return _aiWorker;
  }
  function onAiWorkerMsg(e) {
    var d = e.data, kind = d.kind;
    var trace = { layer: d.layer, depth: d.depth, elapsed: d.elapsed };
    // ⚠ 2026-08-14 bug：超时兜底已接管（_aiPending 置 null）后，迟到的 Worker 返回若仍处理会重复落子
    //   （AI 连下2手）。仅处理"仍挂起且匹配当前请求"的返回。
    if (_aiPending !== kind) return;
    if (_aiTimeout) { clearTimeout(_aiTimeout); _aiTimeout = null; }
    _aiPending = null;
    if (kind === 'ai') {
      if (over) { aiThinking = false; render(); return; }
      var hand = movesHist.length + 1;
      console.log('[AI] 第' + hand + '手 → 触发[' + layerName(trace.layer || '未知') + '] 耗时' +
        Math.round(trace.elapsed || 0) + 'ms' + (d.move ? ' 落子[' + d.move[0] + ',' + d.move[1] + ']' : ' 无落子'));
      aiThinking = false;
      if (!over && d.move) placeStone(d.move[0], d.move[1], aiColor);
      render();
    } else if (kind === 'help') {
      aiThinking = false;
      if (d.move) helpMove = { x: d.move[0], y: d.move[1] };
      render();
    }
  }
  // 主线程同步 AI 计算（Worker 不可用/无响应时的兜底；同步会阻塞主线程，此时页面/计时卡顿）
  function aiSyncMove(budget, color, cbKind) {
    var trace = {};
    var t0 = performance.now();
    var move = GomokuAI.getMove(board, SIZE, color, budget, trace, settings.decisionTree);
    var el = performance.now() - t0;
    if (cbKind === 'ai') {
      var hand = movesHist.length + 1;
      console.log('[AI] 第' + hand + '手 → 触发[' + layerName(trace.layer || '未知') + '] 耗时' +
        Math.round(el) + 'ms' + (move ? ' 落子[' + move[0] + ',' + move[1] + ']' : ' 无落子'));
      aiThinking = false;
      if (!over && move) placeStone(move[0], move[1], aiColor);
    } else {
      aiThinking = false;
      if (move) helpMove = { x: move[0], y: move[1] };
    }
    render();
  }
  // 启动 Worker 异步搜索并设超时兜底（Worker 无响应时回退同步，防止 aiThinking 卡死）
  function aiThink(kind, color, budget) {
    var w = getAiWorker();
    if (!w) { aiSyncMove(budget, color, kind); return; }
    _aiPending = kind;
    w.postMessage({ kind: kind, board: board.slice(), size: SIZE, color: color, budget: budget, decisionTree: settings.decisionTree });
    _aiTimeout = setTimeout(function () {
      if (_aiPending === kind) {   // Worker 无响应（加载失败/异常）→ 静默回退同步，不打印日志
        _aiPending = null;
        aiSyncMove(budget, color, kind);
      }
    }, budget + 1500);
  }

  function scheduleAI() {
    // ⚠ 2026-08-14 bug：防重复调度——若 aiThinking 已在思考仍被再次调用，两个 setTimeout 队列会
    //   触发两次 AI 落子（玩家没落子 AI 连下2手）。
    if (aiThinking) return;
    aiThinking = true;
    render();
    setTimeout(function () {
      if (over) { aiThinking = false; render(); return; }
      // 攻防转换固定参数（执黑进攻/执白防守，ai.js 内按 color 区分），搜索时间用 settings.searchTime（2-10s）
      aiThink('ai', aiColor, Math.round(settings.searchTime * 1000));
    }, 40);
  }

  // ---------- 悔棋 ----------
  function hasPlayerMove() {
    for (var i = 0; i < movesHist.length; i++) {
      if (movesHist[i].color === playerColor) return true;
    }
    return false;
  }
  // ---------- 导出棋局（复制到剪贴板 + 提示弹窗） ----------
  // 导出含：棋盘二维数组 board（兼容旧格式）+ 每步落子序列 moves（[[x,y,color],...]，便于 AI 分析/恢复棋谱）
  function exportGame() {
    var arr = [];
    for (var y = 0; y < SIZE; y++) {
      var row = [];
      for (var x = 0; x < SIZE; x++) row.push(board[y * SIZE + x]);
      arr.push(row);
    }
    var obj = {
      v: 1,
      size: SIZE,
      moves: movesHist.map(function (m) { return [m.idx % SIZE, (m.idx / SIZE) | 0, m.color]; }),
      board: arr
    };
    copyText(JSON.stringify(obj), function () {
      document.getElementById('export-modal').hidden = false;
    });
  }
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (done) done();
      }).catch(function () {
        legacyCopyText(text);
        if (done) done();
      });
    } else {
      legacyCopyText(text);
      if (done) done();
    }
  }
  function legacyCopyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 导入棋局（解析导出信息） ----------
  // 兼容新格式 {v,size,moves,board} 与旧格式二维棋盘数组。
  // 返回 { size, board(一维,当前SIZE布局), moves:[{idx,color}] }；无法解析返回 null。
  function parseImport(text) {
    try {
      var o = JSON.parse(text);
      var isArr = Array.isArray(o);
      if (!isArr && (!o || typeof o !== 'object')) return null;
      var size = SIZE;
      if (!isArr && o.size >= 5 && o.size <= 19) size = o.size;
      var limit = Math.min(SIZE, size);
      var b = new Array(SIZE * SIZE);
      for (var i = 0; i < b.length; i++) b[i] = EMPTY;
      var moves = [];
      if (isArr) {
        // 旧格式：二维棋盘数组（仅恢复盘面，无落子顺序）
        for (var y = 0; y < o.length && y < limit; y++) {
          var row = o[y];
          for (var x = 0; x < row.length && x < limit; x++) {
            var cv = row[x];
            if (cv === BLACK || cv === WHITE) b[y * SIZE + x] = cv;
          }
        }
      } else if (Array.isArray(o.moves)) {
        for (var k = 0; k < o.moves.length; k++) {
          var m = o.moves[k];
          if (!Array.isArray(m) || m.length < 3) continue;
          var x2 = m[0] | 0, y2 = m[1] | 0, c2 = m[2];
          if (x2 < 0 || x2 >= limit || y2 < 0 || y2 >= limit) continue;
          if (c2 !== BLACK && c2 !== WHITE) continue;
          if (b[y2 * SIZE + x2] !== EMPTY) continue;
          b[y2 * SIZE + x2] = c2;
          moves.push({ idx: y2 * SIZE + x2, color: c2 });
        }
      } else if (Array.isArray(o.board)) {
        for (var yy = 0; yy < o.board.length && yy < limit; yy++) {
          var r2 = o.board[yy];
          for (var xx = 0; xx < r2.length && xx < limit; xx++) {
            var cv2 = r2[xx];
            if (cv2 === BLACK || cv2 === WHITE) b[yy * SIZE + xx] = cv2;
          }
        }
      }
      return { size: size, board: b, moves: moves };
    } catch (e) {
      return null;
    }
  }

  // 打开导入弹窗（场景回调：历史棋谱恢复图 / 人工对战导入残局）
  var importCb = null;
  function openImport(cb) {
    var ta = document.getElementById('import-text');
    if (ta) ta.value = '';
    importCb = cb;
    document.getElementById('import-modal').hidden = false;
  }
  function closeImport() {
    document.getElementById('import-modal').hidden = true;
    importCb = null;
  }

  // 人工对战导入残局：从导出信息恢复棋盘与落子序列，继续对局
  function importPosition(text) {
    var p = parseImport(text);
    if (!p) {
      openConfirm('导入失败：无法解析粘贴的内容，请确认是「导出」按钮复制出的棋局信息。', function () {});
      return;
    }
    stopTimer();
    gameMode = 'pvp';
    board = p.board.slice();
    movesHist = p.moves.slice();
    lastMove = movesHist.length ? movesHist[movesHist.length - 1].idx : -1;
    // 黑先手：偶数手已下完 → 轮到黑
    turn = (movesHist.length % 2 === 0) ? BLACK : WHITE;
    over = false; winner = null; resultClosed = false;
    aiThinking = false; helpMove = null; lbInvalid = false;
    curElapsed = 0; gameStart = 0; lastMoveAt = 0;
    var w = checkBoardWin();
    if (w) { over = true; winner = w; }
    showGame();
    render();
    if (!over && movesHist.length) startTimer();
  }
  // 检测当前盘面是否已有某方五连（导入残局时判断是否已终局）
  function checkBoardWin() {
    for (var i = 0; i < board.length; i++) {
      if (board[i] === EMPTY) continue;
      if (checkWinAt(i, board[i])) return board[i];
    }
    return 0;
  }

  // ---------- 帮助：调用 AI 算法选出最合适的点（虚影提示） ----------
  function requestHelp() {
    if (over || aiThinking || turn !== playerColor) return;
    // 使用帮助 → 本局不计入排行榜
    lbInvalid = true;
    // 锁 aiThinking：帮助计算期间禁落子/悔棋，避免 helpMove 基于的棋盘与当前不符
    aiThinking = true;
    render();
    aiThink('help', playerColor, Math.round(settings.searchTime * 1000));
  }

  function undo() {
    if (aiThinking) return;
    // 人工对战：撤销最后一手（黑白均可），轮回到被撤销那手方
    if (gameMode === 'pvp') {
      if (!movesHist.length) return;
      doUndoPvp();
      return;
    }
    // 撤销玩家最近一手及其后的所有 AI 应手
    var i = movesHist.length - 1;
    while (i >= 0 && movesHist[i].color !== playerColor) i--;
    if (i < 0) return;
    // 首次悔棋：执白对局会因此不计入排行榜
    // B站内原生 confirm/alert 会被拦截，这里用自定义确认弹窗
    if (!lbInvalid && playerColor === WHITE) {
      openConfirm('悔棋后本局成绩将不计入排行榜，确定悔棋吗？', function (ok) {
        if (ok) {
          lbInvalid = true;
          doUndo(i);
        }
      });
      return;
    }
    lbInvalid = true;
    doUndo(i);
  }
  function doUndo(i) {
    for (var k = movesHist.length - 1; k >= i; k--) {
      board[movesHist[k].idx] = EMPTY;
      movesHist.pop();
    }
    lastMove = movesHist.length ? movesHist[movesHist.length - 1].idx : -1;
    turn = playerColor;
    over = false; winner = null; resultClosed = false;
    curElapsed = elapsedMs();
    saveGame();
    render();
    if (timerId === null) startTimer();
  }
  // 人工对战悔棋：撤销最后一手，轮回到该手方
  function doUndoPvp() {
    var m = movesHist.pop();
    board[m.idx] = EMPTY;
    lastMove = movesHist.length ? movesHist[movesHist.length - 1].idx : -1;
    turn = m.color;
    over = false; winner = null; resultClosed = false;
    curElapsed = elapsedMs();
    saveGame();
    render();
    if (timerId === null) startTimer();
  }

  // ---------- 自定义确认弹窗 ----------
  var confirmCb = null;
  function openConfirm(text, cb) {
    document.getElementById('confirm-text').textContent = text;
    confirmCb = cb;
    document.getElementById('confirm-modal').hidden = false;
  }
  function closeConfirm() {
    document.getElementById('confirm-modal').hidden = true;
    confirmCb = null;
  }

  // ---------- 状态文本 ----------
  function statusText() {
    if (over) {
      if (gameMode === 'pvp') return winner === 0 ? '平局' : (winner === BLACK ? '黑方获胜' : '白方获胜');
      if (winner === playerColor) return '你赢了';
      if (winner === aiColor) return '电脑获胜';
      return '平局';
    }
    if (gameMode === 'pvp') return turn === BLACK ? '轮到你（黑棋）' : '轮到你（白棋）';
    if (aiThinking) return '电脑思考中…';
    return turn === playerColor ? (playerColor === BLACK ? '轮到你（黑棋）' : '轮到你（白棋）') : '电脑思考中…';
  }

  // ---------- 渲染 ----------
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var boardCss = 0, dpr = 1;

  function resizeCanvas() {
    var wrap = document.querySelector('.board-wrap');
    var maxW = wrap.clientWidth - 12;
    var maxH = wrap.clientHeight - 12;
    var px = Math.max(200, Math.min(maxW, maxH, 720));
    dpr = window.devicePixelRatio || 1;
    boardCss = px;
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    render();
  }

  function drawStone(cx, cy, color, cell, isLast) {
    var r = cell * 0.43;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    var g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    if (color === BLACK) { g.addColorStop(0, '#666'); g.addColorStop(1, '#101010'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9c9c9'); }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    if (isLast) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = color === BLACK ? '#ffffff' : '#c0392b';
      ctx.fill();
    }
  }

  function render() {
    if (!boardCss) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boardCss, boardCss);
    var cell = boardCss / SIZE;
    var margin = cell / 2;

    ctx.fillStyle = '#E3B778';
    ctx.fillRect(0, 0, boardCss, boardCss);

    ctx.strokeStyle = 'rgba(90,50,10,0.45)';
    ctx.lineWidth = 1;
    for (var i = 0; i < SIZE; i++) {
      var p = margin + i * cell;
      ctx.beginPath(); ctx.moveTo(margin, p); ctx.lineTo(boardCss - margin, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, margin); ctx.lineTo(p, boardCss - margin); ctx.stroke();
    }

    var stars = [3, (SIZE - 1) / 2, SIZE - 4];
    for (var sy = 0; sy < stars.length; sy++) {
      for (var sx = 0; sx < stars.length; sx++) {
        ctx.beginPath();
        ctx.arc(margin + stars[sx] * cell, margin + stars[sy] * cell, cell * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(90,50,10,0.6)';
        ctx.fill();
      }
    }

    for (var idx = 0; idx < SIZE * SIZE; idx++) {
      var c = board[idx];
      if (c === EMPTY) continue;
      var x = idx % SIZE, y = (idx / SIZE) | 0;
      drawStone(margin + x * cell, margin + y * cell, c, cell, idx === lastMove);
    }

    // 帮助虚影：半透明圆环提示 AI 建议的落子点
    if (helpMove && !over) {
      ctx.beginPath();
      ctx.arc(margin + helpMove.x * cell, margin + helpMove.y * cell, cell * 0.42, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245,158,11,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(margin + helpMove.x * cell, margin + helpMove.y * cell, cell * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245,158,11,0.9)';
      ctx.fill();
    }

    // 结束后棋谱：在每个棋子上标注落子顺序
    if (over) {
      for (var mk = 0; mk < movesHist.length; mk++) {
        var h = movesHist[mk];
        var hx = h.idx % SIZE, hy = (h.idx / SIZE) | 0;
        ctx.font = 'bold ' + Math.max(7, cell * 0.4) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = h.color === BLACK ? '#ffffff' : '#2d2d2d';
        ctx.fillText(String(mk + 1), margin + hx * cell, margin + hy * cell);
      }
    }

    document.getElementById('game-status').textContent = statusText();
    document.getElementById('game-moves').textContent = '步数 ' + movesHist.length;
    document.getElementById('game-meta').textContent =
      gameMode === 'pvp' ? '黑白对弈' : ('你执' + (playerColor === BLACK ? '黑' : '白'));
    document.getElementById('btn-undo').disabled = aiThinking || !movesHist.length;
    var impBtn = document.getElementById('btn-import');
    if (impBtn) impBtn.hidden = gameMode !== 'pvp';
    var helpBtn = document.getElementById('btn-help');
    if (helpBtn) helpBtn.style.display = gameMode === 'pvp' ? 'none' : '';

    var ov = document.getElementById('overlay');
    var foot = document.getElementById('game-footer');
    if (over && !resultClosed) {
      ov.hidden = false;
      foot.hidden = true;
      document.getElementById('overlay-title').textContent =
        gameMode === 'pvp'
          ? (winner === 0 ? '平局' : winner === BLACK ? '黑方获胜' : '白方获胜')
          : (winner === playerColor ? '你赢了' : winner === aiColor ? '电脑获胜' : '平局');
      document.getElementById('overlay-sub').textContent =
        gameMode === 'pvp'
          ? '用时 ' + fmtTime(curElapsed)
          : winner === playerColor
            ? (winQualifies()
                ? '用时 ' + fmtTime(curElapsed) + '，这局你技高一筹'
                : lbInvalid
                  ? '本局曾悔棋，未计入排行榜（用时 ' + fmtTime(curElapsed) + '）'
                  : '搜索时间低于默认值，未计入排行榜（用时 ' + fmtTime(curElapsed) + '）')
            : winner === aiColor ? '用时 ' + fmtTime(curElapsed) + '，再来一局试试' : '势均力敌';
    } else {
      ov.hidden = true;
      foot.hidden = false;
    }
  }

  // ---------- 落子输入 ----------
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (over || aiThinking) {
      if (!over && aiThinking) console.log('[点击拦截] AI思考中，忽略落子（aiThinking=' + aiThinking + ' turn=' + turn + '）');
      return;
    }
    if (gameMode === 'ai' && turn !== playerColor) {
      console.log('[点击拦截] 非玩家回合 turn=' + turn + ' player=' + playerColor);
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var cell = boardCss / SIZE;
    var x = Math.round((e.clientX - rect.left) / cell - 0.5);
    var y = Math.round((e.clientY - rect.top) / cell - 0.5);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    // 人工对战：轮流落黑白；对战 AI：仅落己方
    placeStone(x, y, gameMode === 'pvp' ? turn : playerColor);
  });

  // ---------- 视图切换 ----------
  function hasAnyStone() {
    for (var i = 0; i < board.length; i++) if (board[i] !== EMPTY) return true;
    return false;
  }
  function showHome() {
    stopTimer();
    // 仅对"进行中且有落子"的对局持久化，避免启动时写入空棋盘存档
    if (!over && hasAnyStone()) saveGame();
    renderLocalLB();
    document.getElementById('view-game').classList.remove('active');
    document.getElementById('view-home').classList.add('active');
    var s = loadSave();
    // 继续游戏仅针对 AI 对战存档（人工对战不计入，需重新进入）
    document.getElementById('btn-continue').disabled = !(s && !s.over && s.gameMode !== 'pvp');
  }
  function showGame() {
    document.getElementById('view-home').classList.remove('active');
    document.getElementById('view-game').classList.add('active');
    requestAnimationFrame(resizeCanvas);
  }

  // ---------- 历史棋谱（保存/列表/回放） ----------
  function loadHistory() {
    try {
      var r = JSON.parse(localStorage.getItem(KEY_HISTORY));
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  // 保存当前局（落子序列 + 结果 + 时间 + 手数）到历史，最多保留 20 局
  function saveHistoryGame() {
    if (!movesHist.length) return;
    var list = loadHistory();
    list.unshift({
      ts: Date.now(),
      winner: winner,
      hand: movesHist.length,
      moves: movesHist.map(function (m) { return { idx: m.idx, color: m.color }; })
    });
    if (list.length > 20) list.length = 20;
    try { localStorage.setItem(KEY_HISTORY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
  }
  function renderHistoryList() {
    var list = loadHistory();
    var el = document.getElementById('history-list');
    el.innerHTML = '';
    if (!list.length) { el.innerHTML = '<div class="lb-tip">暂无历史棋谱</div>'; return; }
    list.forEach(function (rec) {
      var d = new Date(rec.ts);
      function p2(n) { return n < 10 ? '0' + n : '' + n; }
      var time = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      var resText = rec.winner === 0 ? '平局' : (rec.winner === BLACK ? '黑胜' : '白胜');
      var div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = '<span class="hi-time">' + time + '</span>' +
        '<span class="hi-hand">' + (rec.hand || 0) + ' 手</span>' +
        '<span class="hi-res">' + resText + '</span>';
      div.addEventListener('click', (function (r) { return function () { openReplay(r); }; })(rec));
      el.appendChild(div);
    });
  }
  var currentReplay = null;   // 当前回放棋谱（导出用）
  function openReplay(rec) {
    currentReplay = rec;
    var moves = rec.moves || [];
    document.getElementById('replay-info').textContent =
      '对局时间：' + new Date(rec.ts).toLocaleString() + '　·　' + (rec.hand || 0) + ' 手　·　' +
      (rec.winner === 0 ? '平局' : (rec.winner === BLACK ? '黑胜' : '白胜'));
    renderReplay(moves);
    document.getElementById('replay-modal').hidden = false;
  }
  // 历史棋谱导出：与对局导出同格式 {v,size,moves,board}，复制到剪贴板，可到人工对战"导入残局"恢复
  function exportHistoryGame(rec) {
    if (!rec || !Array.isArray(rec.moves)) return;
    var moves = rec.moves;
    var b = new Array(SIZE * SIZE).fill(EMPTY);
    var mList = [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      b[m.idx] = m.color;
      mList.push([m.idx % SIZE, (m.idx / SIZE) | 0, m.color]);
    }
    var arr = [];
    for (var y = 0; y < SIZE; y++) {
      var row = [];
      for (var x = 0; x < SIZE; x++) row.push(b[y * SIZE + x]);
      arr.push(row);
    }
    copyText(JSON.stringify({ v: 1, size: SIZE, moves: mList, board: arr }), function () {
      document.getElementById('export-modal').hidden = false;
    });
  }
  // 不可变棋谱渲染：按落子顺序在 replay-board 上画棋盘、棋子与序号
  function renderReplay(moves) {
    var rcanvas = document.getElementById('replay-board');
    if (!rcanvas) return;
    var wrap = document.getElementById('replay-wrap');
    var maxW = (wrap && wrap.clientWidth ? wrap.clientWidth : 320) - 12;
    var px = Math.max(200, Math.min(maxW, 360));
    var rdpr = window.devicePixelRatio || 1;
    rcanvas.style.width = px + 'px';
    rcanvas.style.height = px + 'px';
    rcanvas.width = Math.round(px * rdpr);
    rcanvas.height = Math.round(px * rdpr);
    var rctx = rcanvas.getContext('2d');
    rctx.setTransform(rdpr, 0, 0, rdpr, 0, 0);
    rctx.clearRect(0, 0, px, px);
    var cell = px / SIZE;
    var margin = cell / 2;
    rctx.fillStyle = '#E3B778';
    rctx.fillRect(0, 0, px, px);
    rctx.strokeStyle = 'rgba(90,50,10,0.45)';
    rctx.lineWidth = 1;
    for (var i = 0; i < SIZE; i++) {
      var p = margin + i * cell;
      rctx.beginPath(); rctx.moveTo(margin, p); rctx.lineTo(px - margin, p); rctx.stroke();
      rctx.beginPath(); rctx.moveTo(p, margin); rctx.lineTo(p, px - margin); rctx.stroke();
    }
    var stars = [3, (SIZE - 1) / 2, SIZE - 4];
    for (var sy = 0; sy < stars.length; sy++) for (var sx = 0; sx < stars.length; sx++) {
      rctx.beginPath();
      rctx.arc(margin + stars[sx] * cell, margin + stars[sy] * cell, cell * 0.1, 0, Math.PI * 2);
      rctx.fillStyle = 'rgba(90,50,10,0.6)';
      rctx.fill();
    }
    var lastIdx = moves.length ? moves[moves.length - 1].idx : -1;
    for (var m = 0; m < moves.length; m++) {
      var mv = moves[m];
      var x = mv.idx % SIZE, y = (mv.idx / SIZE) | 0;
      drawStoneAt(rctx, margin + x * cell, margin + y * cell, mv.color, cell, mv.idx === lastIdx);
    }
    for (var mk = 0; mk < moves.length; mk++) {
      var h = moves[mk];
      var hx = h.idx % SIZE, hy = (h.idx / SIZE) | 0;
      rctx.font = 'bold ' + Math.max(7, cell * 0.4) + 'px sans-serif';
      rctx.textAlign = 'center';
      rctx.textBaseline = 'middle';
      rctx.fillStyle = h.color === BLACK ? '#ffffff' : '#2d2d2d';
      rctx.fillText(String(mk + 1), margin + hx * cell, margin + hy * cell);
    }
  }
  function drawStoneAt(rctx, cx, cy, color, cell, isLast) {
    var r = cell * 0.43;
    rctx.beginPath();
    rctx.arc(cx, cy, r, 0, Math.PI * 2);
    var g = rctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    if (color === BLACK) { g.addColorStop(0, '#666'); g.addColorStop(1, '#101010'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9c9c9'); }
    rctx.fillStyle = g;
    rctx.fill();
    rctx.lineWidth = 1;
    rctx.strokeStyle = 'rgba(0,0,0,0.35)';
    rctx.stroke();
    if (isLast) {
      rctx.beginPath();
      rctx.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
      rctx.fillStyle = color === BLACK ? '#ffffff' : '#c0392b';
      rctx.fill();
    }
  }
  // ---------- 本地 TOP50（一级：黑/白棋；二级：最快时间/最少手数） ----------
  var topColor = 'black', topMetric = 'time';
  function renderTopList(color, metric) {
    topColor = color; topMetric = metric;
    var ctabs = document.querySelectorAll('#top-color-tabs .tab');
    for (var i = 0; i < ctabs.length; i++) ctabs[i].classList.toggle('active', ctabs[i].getAttribute('data-color') === color);
    var mtabs = document.querySelectorAll('#top-metric-tabs .tab');
    for (var j = 0; j < mtabs.length; j++) mtabs[j].classList.toggle('active', mtabs[j].getAttribute('data-metric') === metric);
    var key = (color === 'black' ? 'black' : 'white') + (metric === 'time' ? 'FastestList' : 'MovesList');
    var list = lb[key] || [];
    var el = document.getElementById('top-list');
    if (!list.length) { el.innerHTML = '<div class="lb-empty">暂无记录</div>'; return; }
    var rows = '';
    for (var k = 0; k < list.length && k < 50; k++) {
      var e = list[k];
      var val = metric === 'time' ? fmtTime(e.ms) : e.moves + ' 手';
      rows += '<div class="lb-list-row"><span class="lb-list-rank' + (k < 3 ? ' top' + (k + 1) : '') + '">' +
        (k + 1) + '</span><span class="lb-list-time">' + val + '</span>' +
        '<span class="lb-list-date">' + fmtDate(e.ts) + '</span></div>';
    }
    el.innerHTML = rows;
  }
  function openTop10() {
    renderLocalLB();
    renderTopList('black', 'time');
    document.getElementById('top10-modal').hidden = false;
  }
  function closeTop10() {
    document.getElementById('top10-modal').hidden = true;
  }

  // ---------- 按钮绑定 ----------
  document.getElementById('btn-start').onclick = startNewGame;
  document.getElementById('btn-pvp').onclick = startPvpGame;
  // 禁手模式：跳转到禁手五子棋 Toy（chess2）
  document.getElementById('btn-forbidden').onclick = function () {
    window.location.href = 'https://www.bilibili.com/toy/chess2/index.html';
  };
  document.getElementById('btn-continue').onclick = continueGame;
  document.getElementById('btn-settings').onclick = openSettings;
  document.getElementById('btn-back').onclick = showHome;
  document.getElementById('btn-restart').onclick = restartGame;
  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-export').onclick = exportGame;
  document.getElementById('btn-export-ok').onclick = function () {
    document.getElementById('export-modal').hidden = true;
  };
  document.getElementById('btn-help').onclick = requestHelp;
  document.getElementById('btn-again').onclick = restartGame;
  // 结算条"保存棋局"：将当前局棋谱存入历史
  document.getElementById('btn-save-game').onclick = function () {
    saveHistoryGame();
    document.getElementById('saveok-modal').hidden = false;
  };
  document.getElementById('btn-saveok-ok').onclick = function () {
    document.getElementById('saveok-modal').hidden = true;
  };
  // 首页历史棋谱
  document.getElementById('btn-history').onclick = function () {
    renderHistoryList();
    document.getElementById('history-modal').hidden = false;
  };
  document.getElementById('btn-close-history').onclick = function () {
    document.getElementById('history-modal').hidden = true;
  };
  // 人工对战：导入残局（从导出信息恢复棋谱继续对局）
  document.getElementById('btn-import').onclick = function () {
    openImport(function (text) { importPosition(text); });
  };
  // 历史棋谱：从导出信息恢复棋谱图
  document.getElementById('btn-import-history').onclick = function () {
    document.getElementById('history-modal').hidden = true;
    openImport(function (text) {
      var p = parseImport(text);
      if (!p) {
        openConfirm('导入失败：无法解析粘贴的内容，请确认是「导出」按钮复制出的棋局信息。', function () {});
        return;
      }
      var mv = p.moves;
      if (!mv.length) {
        // 旧格式无落子顺序：按盘面扫描顺序生成（仅展示棋子与位置）
        for (var i = 0; i < p.board.length; i++) if (p.board[i]) mv.push({ idx: i, color: p.board[i] });
      }
      document.getElementById('replay-info').textContent = '从导出信息导入 · ' + mv.length + ' 手';
      renderReplay(mv);
      document.getElementById('replay-modal').hidden = false;
    });
  };
  // 导入弹窗确定/取消
  document.getElementById('btn-import-ok').onclick = function () {
    var ta = document.getElementById('import-text');
    var text = ta ? ta.value : '';
    var cb = importCb;
    closeImport();
    if (cb) cb(text);
  };
  document.getElementById('btn-import-cancel').onclick = closeImport;
  document.getElementById('btn-close-replay').onclick = function () {
    document.getElementById('replay-modal').hidden = true;
  };
  // 棋谱回放页"导出棋谱"：复制到剪贴板（可在人工对战导入残局）
  document.getElementById('btn-export-replay').onclick = function () {
    exportHistoryGame(currentReplay);
  };
  // 棋谱回放页"保存图片"：将 replay-board 画布导出为 PNG 下载到本地
  document.getElementById('btn-save-replay-pic').onclick = function () {
    var rcanvas = document.getElementById('replay-board');
    if (!rcanvas || !rcanvas.width) return;
    try {
      var url = rcanvas.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = url;
      a.download = '五子棋棋谱-' + new Date().getTime() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) { /* 忽略 */ }
  };
  document.getElementById('btn-top10').onclick = openTop10;
  document.getElementById('btn-close-top10').onclick = closeTop10;
  document.getElementById('btn-global-lb').onclick = openGlobalLB;
  document.getElementById('btn-close-global').onclick = closeGlobalLB;
  var lbTabs = document.querySelectorAll('#lb-tabs .tab');
  for (var ti = 0; ti < lbTabs.length; ti++) {
    lbTabs[ti].addEventListener('click', function () {
      loadGlobalList(+this.getAttribute('data-board'), activePeriod);
    });
  }
  // 日/周/月/总 切换
  var periodBtns = document.querySelectorAll('#lb-period-tabs .tab');
  for (var pi = 0; pi < periodBtns.length; pi++) {
    periodBtns[pi].addEventListener('click', function () {
      loadGlobalList(activeBoard, this.getAttribute('data-period'));
    });
  }
  // 本地 TOP50：一级黑/白 + 二级时间/手数
  var topColorTabs = document.querySelectorAll('#top-color-tabs .tab');
  for (var ci = 0; ci < topColorTabs.length; ci++) {
    topColorTabs[ci].addEventListener('click', function () {
      renderTopList(this.getAttribute('data-color'), topMetric);
    });
  }
  var topMetricTabs = document.querySelectorAll('#top-metric-tabs .tab');
  for (var mi = 0; mi < topMetricTabs.length; mi++) {
    topMetricTabs[mi].addEventListener('click', function () {
      renderTopList(topColor, this.getAttribute('data-metric'));
    });
  }

  function openSettings() {
    var radio = document.querySelector('input[name="first"][value="' + settings.first + '"]');
    if (radio) radio.checked = true;
    var snd = document.querySelector('input[name="sound"][value="' + (settings.sound ? 'on' : 'off') + '"]');
    if (snd) snd.checked = true;
    var dt = document.querySelector('input[name="dt"][value="' + (settings.decisionTree ? '1' : '0') + '"]');
    if (dt) dt.checked = true;
    document.getElementById('time-range').value = settings.searchTime;
    document.getElementById('time-val').textContent = settings.searchTime + 's';
    document.getElementById('settings-modal').hidden = false;
  }
  document.getElementById('btn-save-settings').onclick = function () {
    var f = document.querySelector('input[name="first"]:checked');
    settings.first = f ? f.value : 'black';
    settings.searchTime = parseFloat(document.getElementById('time-range').value) || 3.5;
    var snd = document.querySelector('input[name="sound"]:checked');
    settings.sound = snd ? snd.value === 'on' : false;
    var dt = document.querySelector('input[name="dt"]:checked');
    settings.decisionTree = dt ? dt.value === '1' : true;
    saveSettings();
    updateSoundUI();
    document.getElementById('settings-modal').hidden = true;
  };
  // footer 声音开关：点击切换 settings.sound（与设置弹窗同步），同时控制 BGM 播放/暂停
  function updateSoundUI() {
    document.getElementById('btn-sound').textContent = '声音:' + (settings.sound ? '开' : '关');
    updateBgm();
  }
  document.getElementById('btn-sound').onclick = function () {
    settings.sound = !settings.sound;
    saveSettings();
    updateSoundUI();
  };
  updateSoundUI();
  document.getElementById('btn-cancel-settings').onclick = function () {
    document.getElementById('settings-modal').hidden = true;
  };
  // 设置弹窗交互：搜索时间滑块
  document.getElementById('time-range').addEventListener('input', function () {
    document.getElementById('time-val').textContent = this.value + 's';
  });
  document.getElementById('btn-confirm-yes').onclick = function () {
    var cb = confirmCb;
    closeConfirm();
    if (cb) cb(true);
  };
  document.getElementById('btn-confirm-no').onclick = function () {
    var cb = confirmCb;
    closeConfirm();
    if (cb) cb(false);
  };

  window.addEventListener('resize', resizeCanvas);

  // 非阻塞加载 Toy SDK（不阻塞本地渲染与游戏）
  loadSDK();
  // 初始：回到首页
  showHome();
})();
