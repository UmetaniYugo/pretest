// compare.js - canvas サイズとフレーム描画ループを強化して「引き伸ばしで静止画になる」を解消

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

// objectURL 管理（省略：既存の objectURLManager がある想定）
let currentObjectURL1 = null, currentObjectURL2 = null;
const objectURLManager1 = {
  set(url){ if (currentObjectURL1 && currentObjectURL1 !== url) try{ URL.revokeObjectURL(currentObjectURL1) }catch{} currentObjectURL1 = url },
  revoke(){ if (currentObjectURL1) try{ URL.revokeObjectURL(currentObjectURL1) }catch{} currentObjectURL1 = null }
};
const objectURLManager2 = {
  set(url){ if (currentObjectURL2 && currentObjectURL2 !== url) try{ URL.revokeObjectURL(currentObjectURL2) }catch{} currentObjectURL2 = url },
  revoke(){ if (currentObjectURL2) try{ URL.revokeObjectURL(currentObjectURL2) }catch{} currentObjectURL2 = null }
};

// 診断ログ
function addLog(msg, level='info'){
  const time = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
  diagnosticsEl.textContent = `${time} ${prefix} ${msg}\n\n` + diagnosticsEl.textContent;
  if (level === 'error') console.error(prefix, msg);
  else if (level === 'warn') console.warn(prefix, msg);
  else console.log(prefix, msg);
}

// MediaPipe 初期化チェック
if (!window.Pose) addLog('MediaPipe Pose が未読み込みです。compare.html の <script src="...pose.js"> を確認してください', 'error');

// MediaPipe Pose を一度だけ初期化
const pose1 = window.Pose ? new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}` }) : null;
if (pose1) pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
const pose2 = window.Pose ? new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}` }) : null;
if (pose2) pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

// canvas contexts
let ctx1 = null, ctx2 = null;

// ensure DPR-correct canvas size to avoid stretching
function setCanvasSizeToVideo(canvas, video) {
  if (!video || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  // use intrinsic video pixel size when available, otherwise fallback to client size
  const vw = video.videoWidth || Math.max(1, Math.round(video.clientWidth));
  const vh = video.videoHeight || Math.max(1, Math.round(video.clientHeight));
  // set backing store (pixels)
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  // set css display size
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  const ctx = canvas.getContext('2d');
  // set scale so drawing coordinates are in video pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  addLog(`canvas pixel size set: ${canvas.width}x${canvas.height} (css ${vw}x${vh}, dpr ${dpr})`);
}

// continuous draw loop while playing (keeps canvas showing live frames)
let rafDraw1 = null, rafDraw2 = null;
function startDrawLoop(video, canvas, ctxRef, rafRefName, label) {
  if (!video || !canvas) return;
  // ensure ctx
  if (!ctxRef.ctx) ctxRef.ctx = canvas.getContext('2d');
  // cancel if already running
  if (rafRefName === 'raf1' && rafDraw1) cancelAnimationFrame(rafDraw1);
  if (rafRefName === 'raf2' && rafDraw2) cancelAnimationFrame(rafDraw2);

  function loop() {
    try {
      if (video.paused || video.ended || video.readyState < 2) {
        // do not schedule continuous drawing unless playing
      } else {
        // ensure canvas sizing matches current video dimensions
        setCanvasSizeToVideo(canvas, video);
        // draw current frame into canvas (scaled automatically)
        try {
          ctxRef.ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctxRef.ctx.drawImage(video, 0, 0, video.videoWidth || canvas.clientWidth, video.videoHeight || canvas.clientHeight);
        } catch (e) {
          addLog(`${label}: drawImage 例外: ${e.message || e}`, 'warn');
        }
      }
    } catch (e) {
      addLog(`${label}: draw loop 例外: ${e.message || e}`, 'error');
    }
    const id = requestAnimationFrame(loop);
    if (rafRefName === 'raf1') rafDraw1 = id;
    else rafDraw2 = id;
  }
  loop();
}

function stopDrawLoop(rafRefName) {
  if (rafRefName === 'raf1' && rafDraw1) { cancelAnimationFrame(rafDraw1); rafDraw1 = null; }
  if (rafRefName === 'raf2' && rafDraw2) { cancelAnimationFrame(rafDraw2); rafDraw2 = null; }
}

// drawPose uses drawing_utils; keep it but it will only overlay connectors/landmarks
function drawPoseOverlay(results, ctx, canvas, video, label) {
  if (!results.poseLandmarks) return;
  // overlay uses video pixel size for proper scaling
  const vw = video.videoWidth || canvas.clientWidth;
  const vh = video.videoHeight || canvas.clientHeight;
  // if canvas backing store not matching, set it
  setCanvasSizeToVideo(canvas, video);
  try {
    // draw connectors/landmarks on top (assume drawImage already drawn from draw loop)
    window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
  } catch (e) {
    addLog(`${label}: drawConnectors/drawLandmarks 例外: ${e.message || e}`, 'error');
  }
}

// record landmarks (same as以前)
function recordLandmarks(results, frameArray, video) {
  if (!results.poseLandmarks) return;
  const now = video.currentTime || 0;
  const last = frameArray.length ? frameArray[frameArray.length - 1].time : -999;
  if (frameArray.length === 0 || Math.abs(now - last) > 1) {
    frameArray.push({ landmarks: JSON.parse(JSON.stringify(results.poseLandmarks)), time: now });
    addLog(`ランドマーク記録: time=${now.toFixed(2)} (frames=${frameArray.length})`);
  }
}

// MediaPipe onResults (overlay only)
if (pose1) {
  pose1.onResults(results => {
    try {
      if (!ctx1) { addLog('pose1.onResults: ctx1 未設定', 'warn'); return; }
      drawPoseOverlay(results, ctx1, canvas1, video1, '左');
      recordLandmarks(results, referencePoseFrames, video1);
    } catch (e) {
      addLog('pose1.onResults 例外: ' + (e.message || e), 'error');
    }
  });
}
if (pose2) {
  pose2.onResults(results => {
    try {
      if (!ctx2) { addLog('pose2.onResults: ctx2 未設定', 'warn'); return; }
      drawPoseOverlay(results, ctx2, canvas2, video2, '右');
      recordLandmarks(results, targetPoseFrames, video2);
    } catch (e) {
      addLog('pose2.onResults 例外: ' + (e.message || e), 'error');
    }
  });
}

// processing loop for sending frames to pose (throttled)
function startProcessingLoop(video, pose, side) {
  let lastSent = 0;
  const minInterval = 1000 / 15; // <=15 FPS
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

let stopLoop1 = null, stopLoop2 = null;

// play / pause / ended handlers: initialize ctx, start draw loop and pose loop
video1.addEventListener('play', () => {
  if (!ctx1) {
    ctx1 = canvas1.getContext('2d');
    addLog('ctx1 初期化');
  }
  // ensure canvas shows and sized
  setCanvasSizeToVideo(canvas1, video1);
  // start draw loop and pose processing
  startDrawLoop(video1, canvas1, { ctx: ctx1 }, 'raf1', '左(draw)');
  if (pose1) stopLoop1 = startProcessingLoop(video1, pose1, '左');
  addLog('左: play event');
  // detect play promise rejection
  const p = video1.play();
  if (p && typeof p.catch === 'function') {
    p.catch(err => addLog('video1.play() promise rejected: ' + (err?.message||err), 'error'));
  }
});
video1.addEventListener('pause', () => { stopDrawLoop('raf1'); if (stopLoop1) stopLoop1(); addLog('左: pause'); });
video1.addEventListener('ended', () => { stopDrawLoop('raf1'); if (stopLoop1) stopLoop1(); addLog('左: ended'); });

video2.addEventListener('play', () => {
  if (!ctx2) {
    ctx2 = canvas2.getContext('2d');
    addLog('ctx2 初期化');
  }
  setCanvasSizeToVideo(canvas2, video2);
  startDrawLoop(video2, canvas2, { ctx: ctx2 }, 'raf2', '右(draw)');
  if (pose2) stopLoop2 = startProcessingLoop(video2, pose2, '右');
  addLog('右: play event');
  const p = video2.play();
  if (p && typeof p.catch === 'function') {
    p.catch(err => addLog('video2.play() promise rejected: ' + (err?.message||err), 'error'));
  }
});
video2.addEventListener('pause', () => { stopDrawLoop('raf2'); if (stopLoop2) stopLoop2(); addLog('右: pause'); });
video2.addEventListener('ended', () => { stopDrawLoop('raf2'); if (stopLoop2) stopLoop2(); addLog('右: ended'); });

// loadedmetadata: size canvases so the initial poster/snapshot looks correct
video1.addEventListener('loadedmetadata', () => {
  try {
    setCanvasSizeToVideo(canvas1, video1);
    canvas1.style.display = 'block';
    video1.style.display = 'block';
    addLog(`左: loadedmetadata (${video1.videoWidth}x${video1.videoHeight})`);
  } catch (e) {
    addLog('左: loadedmetadata 例外: ' + (e.message || e), 'warn');
  }
});
video2.addEventListener('loadedmetadata', () => {
  try {
    setCanvasSizeToVideo(canvas2, video2);
    canvas2.style.display = 'block';
    video2.style.display = 'block';
    addLog(`右: loadedmetadata (${video2.videoWidth}x${video2.videoHeight})`);
  } catch (e) {
    addLog('右: loadedmetadata 例外: ' + (e.message || e), 'warn');
  }
});

// ----- 以下は既存のファイル読み込み処理を流用する想定（handleVideo1File, handleVideo2File 等） -----
// もし既に setupVideoLoadingHandlers / handleVideoXFile があるならそのまま使ってください。
// ここでは既存の関数が存在する前提で、それらが video.src = URL.createObjectURL(file); video.load(); を行うことを期待します。
// 既存の実装が無い場合は、以前の実装（createObjectURL と video.load の呼び出し）をここに追加してください。
// -------------------------------------------------------------------------------------------

// Compare ボタン: AI アドバイスは動的 import（別処理）
compareBtn.addEventListener('click', async () => {
  adviceArea.innerText = 'AIによるアドバイス生成中...';
  addLog('Compare ボタン押下');
  if (!referencePoseFrames.length || !targetPoseFrames.length) {
    adviceArea.innerText = '両方の動画を再生して骨格抽出データを取得してください（再生ボタンを押してください）。';
    addLog('Compare 実行前: ランドマークデータ不足', 'warn');
    return;
  }
  const refLm = referencePoseFrames[referencePoseFrames.length - 1].landmarks;
  const tarLm = targetPoseFrames[targetPoseFrames.length - 1].landmarks;
  try {
    const module = await import('./aiAdvice.js');
    if (!module || typeof module.getAdviceFromGemini !== 'function') throw new Error('aiAdvice モジュール不正');
    addLog('aiAdvice モジュール読み込み成功');
    const advice = await module.getAdviceFromGemini(refLm, tarLm);
    adviceArea.innerText = advice;
    addLog('AI 応答受信');
  } catch (e) {
    addLog('AI モジュールエラー: ' + (e.message || e), 'error');
    adviceArea.innerText = `AI取得エラー: ${e.message || e}`;
  }
});

// cleanup on unload
window.addEventListener('beforeunload', () => { try{ objectURLManager1.revoke(); objectURLManager2.revoke(); } catch {} });
addLog('compare.js (draw-loop 強化版) 初期化完了');
