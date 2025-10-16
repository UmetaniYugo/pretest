// compare.js - 骨格描画を確実に行うよう強化したバージョン

const video1Input = document.getElementById('video1Input');
const video2Input = document.getElementById('video2Input');
const video1Name = document.getElementById('video1Name');
const video2Name = document.getElementById('video2Name');
const video1Status = document.getElementById('video1Status');
const video2Status = document.getElementById('video2Status');
const diagnosticsEl = document.getElementById('diagnostics');

const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const adviceArea = document.getElementById('adviceArea');
const compareBtn = document.getElementById('compareBtn');

let referencePoseFrames = [];
let targetPoseFrames = [];

// objectURL 管理
let currentObjectURL1 = null;
let currentObjectURL2 = null;
const objectURLManager1 = {
  set(url){ if (currentObjectURL1 && currentObjectURL1 !== url) try{ URL.revokeObjectURL(currentObjectURL1) }catch{} currentObjectURL1 = url },
  revoke(){ if (currentObjectURL1) try{ URL.revokeObjectURL(currentObjectURL1) }catch{} currentObjectURL1 = null }
};
const objectURLManager2 = {
  set(url){ if (currentObjectURL2 && currentObjectURL2 !== url) try{ URL.revokeObjectURL(currentObjectURL2) }catch{} currentObjectURL2 = url },
  revoke(){ if (currentObjectURL2) try{ URL.revokeObjectURL(currentObjectURL2) }catch{} currentObjectURL2 = null }
};

// 診断ログユーティリティ
function addLog(msg, level='info'){
  const time = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
  diagnosticsEl.textContent = `${time} ${prefix} ${msg}\n\n` + diagnosticsEl.textContent;
  if (level === 'error') console.error(prefix, msg);
  else if (level === 'warn') console.warn(prefix, msg);
  else console.log(prefix, msg);
}

// MediaPipe の存在確認
if (!window.Pose) {
  addLog('MediaPipe Pose が見つかりません。compare.html で pose.js を読み込んでいるか確認してください。', 'error');
}

// MediaPipe Pose 初期化
const pose1 = window.Pose ? new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}` }) : null;
if (pose1) pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

const pose2 = window.Pose ? new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}` }) : null;
if (pose2) pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

// canvas context holders（loadedmetadataで初期化）
let ctx1 = null;
let ctx2 = null;

// onResults 登録（描画と記録）
if (pose1) {
  pose1.onResults(results => {
    try {
      if (!ctx1) {
        addLog('pose1.onResults: ctx1 が未設定です', 'warn');
        return;
      }
      if (!results.poseLandmarks) {
        addLog('pose1.onResults: ランドマークがありません', 'warn');
        return;
      }
      drawPose(results, ctx1, canvas1, video1);
      recordLandmarks(results, referencePoseFrames, video1);
    } catch (e) {
      addLog('pose1.onResults 例外: ' + (e.message || e), 'error');
    }
  });
}
if (pose2) {
  pose2.onResults(results => {
    try {
      if (!ctx2) {
        addLog('pose2.onResults: ctx2 が未設定です', 'warn');
        return;
      }
      if (!results.poseLandmarks) {
        addLog('pose2.onResults: ランドマークがありません', 'warn');
        return;
      }
      drawPose(results, ctx2, canvas2, video2);
      recordLandmarks(results, targetPoseFrames, video2);
    } catch (e) {
      addLog('pose2.onResults 例外: ' + (e.message || e), 'error');
    }
  });
}

function drawPose(results, ctx, canvas, video) {
  if (!results.poseLandmarks) return;
  // videoの実ピクセルサイズが利用できるタイミングで canvas を合わせる
  const vw = video.videoWidth || canvas.clientWidth;
  const vh = video.videoHeight || canvas.clientHeight;
  if (canvas.width !== vw || canvas.height !== vh) {
    canvas.width = vw;
    canvas.height = vh;
    addLog(`canvas サイズ更新: ${vw}x${vh}`);
  }
  ctx.clearRect(0,0,canvas.width,canvas.height);
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    // iOS や一部ブラウザで drawImage がセキュリティ制約や状態により例外になることがある
    addLog('ctx.drawImage に失敗: ' + (e.message || e), 'warn');
  }
  // 描画ユーティリティは drawing_utils を HTML で読み込んで global にしている前提
  try {
    window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
  } catch (e) {
    addLog('drawConnectors/drawLandmarks に失敗: ' + (e.message || e), 'error');
  }
}

function recordLandmarks(results, frameArray, video) {
  if (!results.poseLandmarks) return;
  const now = video.currentTime || 0;
  const last = frameArray.length ? frameArray[frameArray.length - 1].time : -999;
  if (frameArray.length === 0 || Math.abs(now - last) > 1) {
    frameArray.push({ landmarks: JSON.parse(JSON.stringify(results.poseLandmarks)), time: now });
    addLog(`ランドマーク記録: time=${now.toFixed(2)} (frames=${frameArray.length})`);
  }
}

// 再生中にMediaPipeへ送るループ（スロットリング）
function startProcessingLoop(video, pose, side) {
  let lastSent = 0;
  const minInterval = 1000 / 15; // 最大 15 FPS
  let rafId = null;
  function loop(ts) {
    if (video.paused || video.ended || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    if (!lastSent || (ts - lastSent) >= minInterval) {
      try {
        pose.send({ image: video });
      } catch (e) {
        addLog(`${side}: pose.send 例外: ${e.message || e}`, 'warn');
      }
      lastSent = ts;
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  return () => { if (rafId) cancelAnimationFrame(rafId); };
}

let stopLoop1 = null;
let stopLoop2 = null;
video1.addEventListener('play', () => {
  if (!ctx1) {
    ctx1 = canvas1.getContext('2d');
    addLog('ctx1 初期化');
  }
  if (pose1) stopLoop1 = startProcessingLoop(video1, pose1, '左');
  addLog('左: play');
});
video1.addEventListener('pause', () => { if (stopLoop1) stopLoop1(); addLog('左: pause'); });
video1.addEventListener('ended', () => { if (stopLoop1) stopLoop1(); addLog('左: ended'); });

video2.addEventListener('play', () => {
  if (!ctx2) {
    ctx2 = canvas2.getContext('2d');
    addLog('ctx2 初期化');
  }
  if (pose2) stopLoop2 = startProcessingLoop(video2, pose2, '右');
  addLog('右: play');
});
video2.addEventListener('pause', () => { if (stopLoop2) stopLoop2(); addLog('右: pause'); });
video2.addEventListener('ended', () => { if (stopLoop2) stopLoop2(); addLog('右: ended'); });

// 読み込みイベントで canvas のサイズを同期（サムネ描画のため）
function attachSizeSync(video, canvas, side) {
  video.addEventListener('loadedmetadata', () => {
    try {
      canvas.width = video.videoWidth || canvas.clientWidth;
      canvas.height = video.videoHeight || canvas.clientHeight;
      addLog(`${side}: loadedmetadata - canvasサイズ設定 ${canvas.width}x${canvas.height}`);
      // 表示を確実にする
      canvas.style.display = 'block';
      video.style.display = 'block';
    } catch (e) {
      addLog(`${side}: loadedmetadata 内で例外: ${e.message || e}`, 'warn');
    }
  }, { once: true });
}
attachSizeSync(video1, canvas1, '左(お手本)');
attachSizeSync(video2, canvas2, '右(比較)');

// 読み込みハンドラ（objectURL / FileReader 等） - 省略せず既存の実装を利用する想定
// ここでは既にある setupVideoLoadingHandlers と handleVideoXFile を使っている想定です。
// もし別実装になっている場合は、handleVideoXFile が video.src=... / video.load() を確実に行っているかを確認してください。

// --- 以下、既存のファイル読み込み処理を再利用する場合のイベント登録（既存の関数名があるならそのまま使います） ---
if (typeof handleVideo1File === 'function') {
  // 既存ハンドラを使っている場合はそのまま
  addLog('handleVideo1File が見つかりました。既存の読み込みハンドラを使用します。');
}
if (typeof handleVideo2File === 'function') {
  addLog('handleVideo2File が見つかりました。既存の読み込みハンドラを使用します。');
}

// 初期ログ
addLog('compare.js（描画強化版） 初期化完了');
