import { getAdviceFromGemini } from './aiAdvice.js';

/* compare.js - canvas size and continuous draw loop improvements */

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
let currentObjectURL1 = null, currentObjectURL2 = null;
const objectURLManager1 = {
  set(url) { if (currentObjectURL1 && currentObjectURL1 !== url) try { URL.revokeObjectURL(currentObjectURL1) } catch { } currentObjectURL1 = url },
  revoke() { if (currentObjectURL1) try { URL.revokeObjectURL(currentObjectURL1) } catch { } currentObjectURL1 = null }
};
const objectURLManager2 = {
  set(url) { if (currentObjectURL2 && currentObjectURL2 !== url) try { URL.revokeObjectURL(currentObjectURL2) } catch { } currentObjectURL2 = url },
  revoke() { if (currentObjectURL2) try { URL.revokeObjectURL(currentObjectURL2) } catch { } currentObjectURL2 = null }
};

function addLog(msg, level = 'info') {
  const time = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
  diagnosticsEl.textContent = `${time} ${prefix} ${msg}\n\n` + diagnosticsEl.textContent;
  if (level === 'error') console.error(prefix, msg);
  else if (level === 'warn') console.warn(prefix, msg);
  else console.log(prefix, msg);
}

// MediaPipe check
if (!window.Pose) addLog('MediaPipe Pose が未読み込みです。compare.html の pose.js 読み込みを確認してください', 'error');

const pose1 = window.Pose ? new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}` }) : null;
if (pose1) pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
const pose2 = window.Pose ? new window.Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}` }) : null;
if (pose2) pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

let ctx1 = null, ctx2 = null;

// Robust draw loop function (DPR-aware)
function startDrawLoop(video, canvas, ctxRef, label) {
  if (!video || !canvas) return () => { };
  if (!ctxRef.ctx) ctxRef.ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let rafId = null;

  function loop() {
    try {
      if (!video.paused && !video.ended && video.readyState >= 2) {
        const vw = video.videoWidth || Math.max(1, Math.round(video.clientWidth));
        const vh = video.videoHeight || Math.max(1, Math.round(video.clientHeight));
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
        canvas.style.width = `${vw}px`;
        canvas.style.height = `${vh}px`;
        ctxRef.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        try {
          ctxRef.ctx.clearRect(0, 0, vw, vh);
          ctxRef.ctx.drawImage(video, 0, 0, vw, vh);
        } catch (e) {
          addLog(`${label}: drawImage 例外: ${e.message || e}`, 'warn');
        }
      }
    } catch (e) {
      addLog(`${label}: draw loop 例外: ${e.message || e}`, 'error');
    }
    rafId = requestAnimationFrame(loop);
  }
  loop();
  return () => { if (rafId) cancelAnimationFrame(rafId); };
}

function stopDrawLoop(rafRef) { if (rafRef && typeof rafRef === 'function') rafRef(); }

// overlay drawing using MediaPipe drawing_utils
function drawPoseOverlay(results, ctx, canvas, video, label) {
  if (!results.poseLandmarks) return;
  try {
    window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
  } catch (e) {
    addLog(`${label}: drawConnectors/drawLandmarks 例外: ${e.message || e}`, 'error');
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

// MediaPipe onResults
if (pose1) {
  pose1.onResults(results => {
    try {
      if (!ctx1) { addLog('pose1.onResults: ctx1 未設定', 'warn'); return; }
      drawPoseOverlay(results, ctx1, canvas1, video1, '左');
      recordLandmarks(results, referencePoseFrames, video1);
    } catch (e) { addLog('pose1.onResults 例外: ' + (e.message || e), 'error'); }
  });
}
if (pose2) {
  pose2.onResults(results => {
    try {
      if (!ctx2) { addLog('pose2.onResults: ctx2 未設定', 'warn'); return; }
      drawPoseOverlay(results, ctx2, canvas2, video2, '右');
      recordLandmarks(results, targetPoseFrames, video2);
    } catch (e) { addLog('pose2.onResults 例外: ' + (e.message || e), 'error'); }
  });
}

// --- 動画アップロード処理 ---

function handleFileSelect(event, videoEl, videoNameEl, videoStatusEl, urlManager) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    addLog('ファイルが選択されていません', 'warn');
    return;
  }

  videoNameEl.textContent = file.name;
  videoStatusEl.textContent = '読み込み中...';
  addLog(`ファイル選択: ${file.name} (${Math.round(file.size / 1024)}KB)`);

  const url = URL.createObjectURL(file);
  urlManager.set(url);

  videoEl.src = url;
  videoEl.load();

  videoEl.onloadedmetadata = () => {
    videoStatusEl.textContent = `準備完了 (${videoEl.videoWidth}x${videoEl.videoHeight}, ${videoEl.duration.toFixed(1)}s)`;
    addLog(`動画ロード成功: ${file.name}`);
  };

  videoEl.onerror = () => {
    videoStatusEl.textContent = 'エラー';
    addLog(`動画ロードエラー: ${videoEl.error ? videoEl.error.message : '詳細不明'}`, 'error');
  };
}

video1Input.addEventListener('change', (e) => handleFileSelect(e, video1, video1Name, video1Status, objectURLManager1));
video2Input.addEventListener('change', (e) => handleFileSelect(e, video2, video2Name, video2Status, objectURLManager2));

// --- 比較・再生処理 ---

let stopLoop1 = null;
let stopLoop2 = null;

compareBtn.addEventListener('click', async () => {
  if (!video1.src || !video2.src) {
    alert('両方の動画を選択してください');
    return;
  }

  addLog('比較開始: 動画再生');

  // データのクリア
  referencePoseFrames = [];
  targetPoseFrames = [];
  adviceArea.textContent = '解析・再生中...';
  adviceArea.style.background = '#333';

  // 動画再生
  try {
    await Promise.all([video1.play(), video2.play()]);
  } catch (e) {
    addLog('再生開始エラー: ' + e.message, 'error');
    return;
  }

  // 描画ループ開始
  stopLoop1 = startDrawLoop(video1, canvas1, { ctx: ctx1 }, 'Left');
  stopLoop2 = startDrawLoop(video2, canvas2, { ctx: ctx2 }, 'Right');

  // MediaPipeへのフレーム送信ループ
  function sendToPose(v, p) {
    if (!v.paused && !v.ended && p) {
      p.send({ image: v }).catch(e => console.error(e));
      requestAnimationFrame(() => sendToPose(v, p));
    }
  }
  sendToPose(video1, pose1);
  sendToPose(video2, pose2);
});

// 再生終了時の処理（両方終わったらアドバイス）
let endedCount = 0;
function onVideoEnded() {
  endedCount++;
  if (endedCount >= 2) {
    addLog('再生終了。AIアドバイスを取得します...');
    stopDrawLoop(stopLoop1);
    stopDrawLoop(stopLoop2);
    endedCount = 0; // reset

    adviceArea.textContent = 'Gemini AIに問い合わせ中...';

    // 少し待ってから実行（最後のフレーム処理待ちなど）
    setTimeout(async () => {
      try {
        const advice = await getAdviceFromGemini(
          referencePoseFrames.map(f => f.landmarks),
          targetPoseFrames.map(f => f.landmarks)
        );
        adviceArea.textContent = advice;
        adviceArea.style.background = '#004d40'; // 成功色
        addLog('アドバイス取得成功');
      } catch (e) {
        adviceArea.textContent = 'エラー: ' + e.message;
        adviceArea.style.background = '#4a1414'; // エラー色
        addLog('アドバイス取得エラー: ' + e.message, 'error');
      }
    }, 500);
  }
}

video1.addEventListener('ended', onVideoEnded);
video2.addEventListener('ended', onVideoEnded);
