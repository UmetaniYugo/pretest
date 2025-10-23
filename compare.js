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
  set(url){ if (currentObjectURL1 && currentObjectURL1 !== url) try{ URL.revokeObjectURL(currentObjectURL1) }catch{} currentObjectURL1 = url },
  revoke(){ if (currentObjectURL1) try{ URL.revokeObjectURL(currentObjectURL1) }catch{} currentObjectURL1 = null }
};
const objectURLManager2 = {
  set(url){ if (currentObjectURL2 && currentObjectURL2 !== url) try{ URL.revokeObjectURL(currentObjectURL2) }catch{} currentObjectURL2 = url },
  revoke(){ if (currentObjectURL2) try{ URL.revokeObjectURL(currentObjectURL2) }catch{} currentObjectURL2 = null }
};

function addLog(msg, level='info'){
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
  if (!video || !canvas) return () => {};
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
    }
