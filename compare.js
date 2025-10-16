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
    } catch (e) { addLog('pose2.onResults 例外: ' + (e.message || e), 'error'); }
  });
}

// processing loop for pose (throttled)
function startProcessingLoop(video, pose, side) {
  let lastSent = 0;
  const minInterval = 1000 / 15; // <=15 FPS
  let rafId = null;
  function loop(ts) {
    if (video.paused || video.ended || video.readyState < 2) { rafId = requestAnimationFrame(loop); return; }
    if (!lastSent || (ts - lastSent) >= minInterval) {
      try { pose.send({ image: video }); } catch (e) { addLog(`${side}: pose.send 例外: ${e.message}`, 'warn'); }
      lastSent = ts;
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  return () => { if (rafId) cancelAnimationFrame(rafId); };
}

let stopLoop1 = null, stopLoop2 = null;
let stopDraw1 = null, stopDraw2 = null;

video1.addEventListener('play', () => {
  if (!ctx1) { ctx1 = canvas1.getContext('2d'); addLog('ctx1 初期化'); }
  setCanvasSizeToVideo(canvas1, video1);
  stopDraw1 = startDrawLoop(video1, canvas1, { ctx: ctx1 }, '左(draw)');
  if (pose1) stopLoop1 = startProcessingLoop(video1, pose1, '左');
  addLog('左: play event');
  const p = video1.play(); if (p && typeof p.catch === 'function') p.catch(err => addLog('video1.play() promise rejected: ' + (err?.message||err), 'error'));
});
video1.addEventListener('pause', () => { if (stopDraw1) stopDraw1(); if (stopLoop1) stopLoop1(); addLog('左: pause'); });
video1.addEventListener('ended', () => { if (stopDraw1) stopDraw1(); if (stopLoop1) stopLoop1(); addLog('左: ended'); });

video2.addEventListener('play', () => {
  if (!ctx2) { ctx2 = canvas2.getContext('2d'); addLog('ctx2 初期化'); }
  setCanvasSizeToVideo(canvas2, video2);
  stopDraw2 = startDrawLoop(video2, canvas2, { ctx: ctx2 }, '右(draw)');
  if (pose2) stopLoop2 = startProcessingLoop(video2, pose2, '右');
  addLog('右: play event');
  const p = video2.play(); if (p && typeof p.catch === 'function') p.catch(err => addLog('video2.play() promise rejected: ' + (err?.message||err), 'error'));
});
video2.addEventListener('pause', () => { if (stopDraw2) stopDraw2(); if (stopLoop2) stopLoop2(); addLog('右: pause'); });
video2.addEventListener('ended', () => { if (stopDraw2) stopDraw2(); if (stopLoop2) stopLoop2(); addLog('右: ended'); });

// helper to set canvas size using DPR
function setCanvasSizeToVideo(canvas, video) {
  if (!video || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const vw = video.videoWidth || Math.max(1, Math.round(video.clientWidth));
  const vh = video.videoHeight || Math.max(1, Math.round(video.clientHeight));
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  addLog(`canvas pixel size set: ${canvas.width}x${canvas.height} (css ${vw}x${vh}, dpr ${dpr})`);
}

// existing loading handlers: keep previous robust implementation if present
function setupVideoLoadingHandlers(video, nameElem, statusElem, objectURLManager, side) {
  let loadTimeout = null;
  let loadedMeta = false;
  function clearLoadTimeout(){ if (loadTimeout){ clearTimeout(loadTimeout); loadTimeout = null; } }
  video.addEventListener('loadedmetadata', () => { loadedMeta = true; clearLoadTimeout(); statusElem.innerHTML = `読み込み完了 (${Math.round(video.duration)} 秒)`; addLog(`${side}: loadedmetadata (duration=${video.duration})`); }, { once:true });
  video.addEventListener('loadeddata', () => { addLog(`${side}: loadeddata`); }, { once:true });
  video.addEventListener('canplay', () => { addLog(`${side}: canplay`); }, { once:true });
  video.addEventListener('canplaythrough', () => { addLog(`${side}: canplaythrough`); }, { once:true });
  video.addEventListener('error', () => { clearLoadTimeout(); const err = video.error; const msg = videoErrorMessage(err); statusElem.innerHTML = `動画読み込みエラー: ${msg}`; addLog(`${side}: video error - ${msg}`, 'error'); video.style.display = 'none'; objectURLManager.revoke(); });
  video.addEventListener('stalled', () => addLog(`${side}: stalled`,'warn'));
  video.addEventListener('suspend', () => addLog(`${side}: suspend`,'warn'));
  video.addEventListener('waiting', () => addLog(`${side}: waiting`,'warn'));
  video.addEventListener('abort', () => addLog(`${side}: abort`,'warn'));

  return function handleFile(file) {
    loadedMeta = false; clearLoadTimeout(); statusElem.innerHTML = '読み込み中 <span class="loader" aria-hidden="true"></span>';
    nameElem.innerText = `${file.name} (${file.type || 'unknown'}, ${Math.round(file.size/1024)} KB)`;
    addLog(`選択: name=${file.name}, type=${file.type}, size=${file.size} bytes`);
    if (file.type && !file.type.startsWith('video/')) addLog(`注意: MIMEタイプが video/ ではありません: ${file.type}`, 'warn');
    try { const url = URL.createObjectURL(file); objectURLManager.set(url); video.src = url; video.load(); addLog(`objectURL 作成成功 (${url})`); } catch (e) { addLog('createObjectURL に失敗、FileReader にフォールバック: ' + (e.message||e), 'warn'); const fr = new FileReader(); fr.onload = () => { try { video.src = fr.result; objectURLManager.set(null); video.load(); addLog('FileReader による dataURL 設定成功'); } catch (err) { addLog('dataURL 設定後の load に失敗: ' + (err.message||err), 'error'); } }; fr.onerror = () => { statusElem.innerText = 'ファイル読み込みに失敗しました（FileReader）'; addLog('FileReader エラー', 'error'); }; fr.readAsDataURL(file); }
    loadTimeout = setTimeout(() => { if (!loadedMeta) { statusElem.innerText = '読み込みが遅いか失敗しました（タイムアウト）。可能性: 非対応コーデック / 大きすぎるファイル / ブラウザ制限'; addLog(`${side}: loadedmetadata タイムアウト（${file.name}）`, 'error'); } }, 8000);
  };
}

function videoErrorMessage(err) { if (!err) return '不明なエラー'; switch (err.code) { case 1: return 'MEDIA_ERR_ABORTED: 読み込み中断'; case 2: return 'MEDIA_ERR_NETWORK: ネットワークエラー'; case 3: return 'MEDIA_ERR_DECODE: デコード失敗（コーデック不一致等）'; case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED: サポート外の形式'; default: return `不明なエラーコード: ${err.code}`; } }

const handleVideo1File = setupVideoLoadingHandlers(video1, video1Name, video1Status, objectURLManager1, '左(お手本)');
const handleVideo2File = setupVideoLoadingHandlers(video2, video2Name, video2Status, objectURLManager2, '右(比較)');

function isAcceptableFile(file) { if (!file) return false; const t = (file.type || '').toLowerCase(); return t.includes('mp4') || t.includes('quicktime') || t.startsWith('video/'); }

video1Input.addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; if (!file) return; addLog('左のファイル選択イベント発火'); if (!isAcceptableFile(file)) { video1Name.innerText = 'サポートされないファイル形式です'; video1Status.innerText = 'フォーマット不明'; addLog('左: サポート外のファイル形式: ' + (file.type || 'unknown'), 'error'); video1.style.display = 'none'; canvas1.style.display = 'none'; return; } try { handleVideo1File(file); video1.style.display = 'block'; canvas1.style.display = 'block'; referencePoseFrames = []; video1Status.innerText = '読み込み開始...'; } catch (e) { addLog('左: handleVideo1File で例外: ' + (e.message||e), 'error'); video1Status.innerText = 'ファイル処理に失敗しました'; } });

video2Input.addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; if (!file) return; addLog('右のファイル選択イベント発火'); if (!isAcceptableFile(file)) { video2Name.innerText = 'サポートされないファイル形式です'; video2Status.innerText = 'フォーマット不明'; addLog('右: サポート外のファイル形式: ' + (file.type || 'unknown'), 'error'); video2.style.display = 'none'; canvas2.style.display = 'none'; return; } try { handleVideo2File(file); video2.style.display = 'block'; canvas2.style.display = 'block'; targetPoseFrames = []; video2Status.innerText = '読み込み開始...'; } catch (e) { addLog('右: handleVideo2File で例外: ' + (e.message||e), 'error'); video2Status.innerText = 'ファイル処理に失敗しました'; } });


// Compare
compareBtn.addEventListener('click', async () => {
  adviceArea.innerText = 'AIによるアドバイス生成中...';
  addLog('Compare ボタン押下');
  if (!referencePoseFrames.length || !targetPoseFrames.length) { adviceArea.innerText = '両方の動画を再生して骨格抽出データを取得してください（再生ボタンを押してください）。'; addLog('Compare 実行前のチェックでデータ不足', 'warn'); return; }
  const refLm = referencePoseFrames[referencePoseFrames.length - 1].landmarks;
  const tarLm = targetPoseFrames[targetPoseFrames.length - 1].landmarks;
  try {
    const module = await import('./aiAdvice.js');
    if (!module || typeof module.getAdviceFromGemini !== 'function') throw new Error('aiAdvice モジュールが不正です');
    addLog('aiAdvice モジュール読み込み成功');
    const advice = await module.getAdviceFromGemini(refLm, tarLm);
    adviceArea.innerText = advice;
    addLog('AI 応答受信');
  } catch (e) {
    addLog('AIモジュール読み込み/実行エラー: ' + (e.message||e), 'error');
    adviceArea.innerText = `AIモジュールの読み込みに失敗しました: ${e.message}`;
  }
});

window.addEventListener('beforeunload', () => { try{ objectURLManager1.revoke(); objectURLManager2.revoke(); }catch{} });

addLog('compare.js (draw-loop 更新) 初期化完了');
{"mode":"update"}
