// 五子棋 AI 工作线程：importScripts 加载 ai.js，在独立线程异步搜索，不阻塞主线程。
// 主线程侧 aiThinking 锁控制落子/悔棋；本线程只做纯计算（棋盘/预算通过 message 传入）。
// 若浏览器不支持 Worker，game.js 的 getAiWorker 返回 null，自动回退主线程同步计算。
importScripts('ai.js');

var _now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? function () { return performance.now(); } : function () { return Date.now(); };

self.onmessage = function (e) {
  var d = e.data;
  var trace = {};
  var t0 = _now();
  var move = null;
  try {
    move = GomokuAI.getMove(d.board, d.size, d.color, d.budget, trace);
  } catch (err) {
    // 计算异常也返回 null，由主线程兜底处理
  }
  self.postMessage({
    kind: d.kind,
    move: move,
    layer: trace.layer,
    depth: trace.depth,
    elapsed: _now() - t0
  });
};
