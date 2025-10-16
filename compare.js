/* compare.js - 動画選択/再生/MediaPipe処理は常に動作するようにし、
   AIアドバイス部分はボタン押下時に動的 import で遅延ロードします。 */

const video1Input = document.getElementById('video1Input');
const video2Input = document.getElementById('video2Input');
const video1Name = document.getElementById('video1Name');
const video2Name = document.getElementById('video2Name');
const video1Status = document.getElementById('video1Status');
const video2Status = document.getElementById('video2Status');

const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const adviceArea = document.getElementById('adviceArea');
const compareBtn = document.getElementById('compareBtn');

let referencePoseFrames = [];
let targetPoseFrames = [];

// object URL 管理
let currentObjectURL1 = null;
let currentObjectURL2 = null;
const objectURLManager1 = {
  set(url) { if (currentObjectURL1 && currentObjectURL1 !== url) try { URL.revokeObjectURL(currentObjectURL1); } catch{} currentObjectURL1 = url; },
  revoke() { if (currentObjectURL1) try { URL.revokeObjectURL(currentObjectURL1); } catch{} currentObjectURL1 = null; }
};
const objectURLManager2 = {
  set(url) { if (currentObjectURL2 && currentObjectURL2 !== url) try { URL.revokeObjectURL(currentObjectURL2); } catch{} currentObjectURL2 = url; },
  revoke() { if (currentObjectURL2) try { URL.revokeObjectURL(currentObjectURL2); } catch{} currentObjectURL2 = null; }
};

// MediaPipe Pose 初期化（1回）
const pose1 = new window.Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${file}` });
pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
const pose2 = new window.Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${file}` });
pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

// canvas context holders
let ctx1 = null;
let ctx2 = null;

// onResults 登録（重複登録防止）
pose1.onResults(results => {
  if (!ctx1) return;
  drawPose(results, ctx1, canvas1, video1);
  recordLandmarks(results, referencePoseFrames, video1);
});
pose2.onResults(results => {
  if (!ctx2) return;
  drawPose(results, ctx2, canvas2, video2);
  recordLandmarks(results, targetPoseFrames, video2);
});

function drawPose(results, ctx, canvas, video) {
  if (!results.poseLandmarks) return;
  canvas.width = video.videoWidth || canvas.clientWidth;
  canvas.height = video.videoHeight || canvas.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (e) { /* iOS などで描画に失敗しても継続 */ }
  window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
  window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
}

function recordLandmarks(results, frameArray, video) {
  if (!results.poseLandmarks) return;
  const now = video.currentTime || 0;
  const last = frameArray.length ? frameArray[frameArray.length - 1].time : -999;
  if (frameArray.length === 0 || Math.abs(now - last) > 1) {
    frameArray.push({ landmarks: JSON.parse(JSON.stringify(results.poseLandmarks)), time: now });
  }
}

// 送信ループ（スロットリング）: 最大 15 FPS
function startProcessingLoop(video, pose) {
  let lastSent = 0;
  const minInterval = 1000 / 15;
  let rafId = null;
  function loop(ts) {
    if (video.paused || video.ended || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    if (!lastSent || (ts - lastSent) >= minInterval) {
      try { pose.send({ image: video }); } catch (e) { console.warn('pose.send error', e); }
      lastSent = ts;
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
  return () => { if (rafId) cancelAnimationFrame(rafId); };
}

let stopLoop1 = null;
let stopLoop2 = null;
video1.addEventListener('play', () => { if (!ctx1) ctx1 = canvas1.getContext('2d'); stopLoop1 = startProcessingLoop(video1, pose1); });
video1.addEventListener('pause', () => { if (stopLoop1) stopLoop1(); });
video1.addEventListener('ended', () => { if (stopLoop1) stopLoop1(); });

video2.addEventListener('play', () => { if (!ctx2) ctx2 = canvas2.getContext('2d'); stopLoop2 = startProcessingLoop(video2, pose2); });
video2.addEventListener('pause', () => { if (stopLoop2) stopLoop2(); });
video2.addEventListener('ended', () => { if (stopLoop2) stopLoop2(); });

// 読み込みハンドラ生成
function setupVideoLoadingHandlers(video, nameElem, statusElem, objectURLManager) {
  let loadTimeout = null;
  let loaded = false;
  function clearLoadTimeout() { if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; } }

  video.addEventListener('loadedmetadata', () => { loaded = true; clearLoadTimeout(); statusElem.innerHTML = `読み込み完了 (${Math.round(video.duration)} 秒)`; }, { once: true });
  video.addEventListener('loadeddata', () => { /* 必要ならサムネ作成 */ }, { once: true });
  video.addEventListener('error', () => { clearLoadTimeout(); const err = video.error; statusElem.innerHTML = `動画読み込みエラー: ${err ? err.code : '不明'}`; video.style.display = 'none'; objectURLManager.revoke(); });

  return function handleFile(file) {
    loaded = false;
    clearLoadTimeout();
    statusElem.innerHTML = '読み込み中 <span class="loader" aria-hidden="true"></span>';
    nameElem.innerText = `${file.name} (${file.type || 'unknown'}, ${Math.round(file.size/1024)} KB)`;

    try {
      const url = URL.createObjectURL(file);
      objectURLManager.set(url);
      video.src = url;
      video.load();
    } catch (e) {
      // fallback to FileReader -> dataURL
      const fr = new FileReader();
      fr.onload = () => { video.src = fr.result; objectURLManager.set(null); video.load(); };
      fr.onerror = () => { statusElem.innerText = 'ファイル読み込みに失敗しました'; };
      fr.readAsDataURL(file);
    }

    loadTimeout = setTimeout(() => { if (!loaded) { statusElem.innerText = '読み込みが遅いか失敗しました。もう一度選択してください。'; } }, 8000);
  };
}

const handleVideo1File = setupVideoLoadingHandlers(video1, video1Name, video1Status, objectURLManager1);
const handleVideo2File = setupVideoLoadingHandlers(video2, video2Name, video2Status, objectURLManager2);

function isAcceptableFile(file) {
  if (!file) return false;
  const t = (file.type || '').toLowerCase();
  return t.includes('mp4') || t.includes('quicktime') || t.startsWith('video/');
}

video1Input.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!isAcceptableFile(file)) { video1Name.innerText = 'サポートされないファイル形式です'; video1.style.display = 'none'; canvas1.style.display = 'none'; return; }
  handleVideo1File(file);
  video1.style.display = 'block';
  canvas1.style.display = 'block';
  referencePoseFrames = [];
  video1Status.innerText = '読み込み開始...';
});

video2Input.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!isAcceptableFile(file)) { video2Name.innerText = 'サポートされないファイル形式です'; video2.style.display = 'none'; canvas2.style.display = 'none'; return; }
  handleVideo2File(file);
  video2.style.display = 'block';
  canvas2.style.display = 'block';
  targetPoseFrames = [];
  video2Status.innerText = '読み込み開始...';
});

// Compare ボタン押下時に aiAdvice を遅延ロードして実行
compareBtn.addEventListener('click', async () => {
  adviceArea.innerText = 'AIによるアドバイス生成中...';
  if (!referencePoseFrames.length || !targetPoseFrames.length) {
    adviceArea.innerText = '両方の動画を再生して骨格抽出データを取得してください（再生ボタンを押してください）。';
    return;
  }
  const refLm = referencePoseFrames[referencePoseFrames.length - 1].landmarks;
  const tarLm = targetPoseFrames[targetPoseFrames.length - 1].landmarks;

  try {
    // 動的 import：モジュール読み込みでページ初期化を阻害しない
    const module = await import('./aiAdvice.js');
    if (!module || typeof module.getAdviceFromGemini !== 'function') throw new Error('AIモジュールが不正です');
    const advice = await module.getAdviceFromGemini(refLm, tarLm);
    adviceArea.innerText = advice;
  } catch (e) {
    console.error('AIモジュール読み込み/実行エラー', e);
    adviceArea.innerText = `AIモジュールの読み込みに失敗しました: ${e.message}`;
  }
});

// ページ離脱時に objectURL を解放
window.addEventListener('beforeunload', () => { try { objectURLManager1.revoke(); objectURLManager2.revoke(); } catch {} });
