/* compare.js - エラーハンドリングと診断ログを強化した版
   - アップロード/読み込み/再生時の失敗を詳細に診断して UI に表示します
   - AI モジュールは遅延ロードのまま（Compare ボタン押下時に import）
*/

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
const objectURLManager1 = { set(url){ if (currentObjectURL1 && currentObjectURL1 !== url) try{ URL.revokeObjectURL(currentObjectURL1)}catch{} currentObjectURL1 = url }, revoke(){ if (currentObjectURL1) try{ URL.revokeObjectURL(currentObjectURL1)}catch{} currentObjectURL1 = null } };
const objectURLManager2 = { set(url){ if (currentObjectURL2 && currentObjectURL2 !== url) try{ URL.revokeObjectURL(currentObjectURL2)}catch{} currentObjectURL2 = url }, revoke(){ if (currentObjectURL2) try{ URL.revokeObjectURL(currentObjectURL2)}catch{} currentObjectURL2 = null } };

// 診断ログ出力ユーティリティ
function addLog(msg, level = 'info') {
  const time = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
  diagnosticsEl.textContent = `${time} ${prefix} ${msg}\n\n` + diagnosticsEl.textContent;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](prefix, msg);
}

// video.error.code の意味を分かりやすくする
function videoErrorMessage(err) {
  if (!err) return '不明なエラー';
  switch (err.code) {
    case 1: return 'MEDIA_ERR_ABORTED: ユーザーが再生を中止しました（または読み込みが中断）。';
    case 2: return 'MEDIA_ERR_NETWORK: ネットワークエラー（ブラウザがファイルを取得できない）。';
    case 3: return 'MEDIA_ERR_DECODE: ファイルのデコードに失敗（コーデック非対応や破損）。';
    case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED: 対応していないファイル形式またはプロトコル。';
    default: return `未知のエラーコード: ${err.code}`;
  }
}

// MediaPipe Pose 初期化（1回）
const pose1 = new window.Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${file}` });
pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
const pose2 = new window.Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${file}` });
pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

// canvas context 保持
let ctx1 = null;
let ctx2 = null;
pose1.onResults(results => { if (!ctx1) return; drawPose(results, ctx1, canvas1, video1); recordLandmarks(results, referencePoseFrames, video1); });
pose2.onResults(results => { if (!ctx2) return; drawPose(results, ctx2, canvas2, video2); recordLandmarks(results, targetPoseFrames, video2); });

function drawPose(results, ctx, canvas, video) {
  if (!results.poseLandmarks) return;
  canvas.width = video.videoWidth || canvas.clientWidth;
  canvas.height = video.videoHeight || canvas.clientHeight;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  try { ctx.drawImage(video,0,0,canvas.width,canvas.height); } catch(e) { addLog('canvas.drawImage に失敗（iOSの制約等）: ' + (e.message || e), 'warn'); }
  window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
  window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
}
function recordLandmarks(results, frameArray, video) {
  if (!results.poseLandmarks) return;
  const now = video.currentTime || 0;
  const last = frameArray.length ? frameArray[frameArray.length-1].time : -999;
  if (frameArray.length === 0 || Math.abs(now - last) > 1) {
    frameArray.push({ landmarks: JSON.parse(JSON.stringify(results.poseLandmarks)), time: now });
  }
}
function startProcessingLoop(video, pose) {
  let lastSent = 0;
  const minInterval = 1000 / 15; // 最大15FPS
  let rafId = null;
  function loop(ts) {
    if (video.paused || video.ended || video.readyState < 2) { rafId = requestAnimationFrame(loop); return; }
    if (!lastSent || (ts - lastSent) >= minInterval) {
      try { pose.send({ image: video }); } catch (e) { addLog('pose.send で例外: ' + (e.message||e), 'warn'); }
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

// 読み込みハンドラ生成（強化版）
function setupVideoLoadingHandlers(video, nameElem, statusElem, objectURLManager, side) {
  let loadTimeout = null;
  let loadedMeta = false;

  function clearLoadTimeout(){ if (loadTimeout){ clearTimeout(loadTimeout); loadTimeout = null; } }

  video.addEventListener('loadedmetadata', () => {
    loadedMeta = true;
    clearLoadTimeout();
    statusElem.innerHTML = `読み込み完了 (${Math.round(video.duration)} 秒)`;
    addLog(`${side}: loadedmetadata（duration=${video.duration}）`);
  }, { once:true });

  video.addEventListener('loadeddata', () => {
    addLog(`${side}: loadeddata`);
  }, { once:true });

  video.addEventListener('canplay', () => { addLog(`${side}: canplay`); }, { once:true });
  video.addEventListener('canplaythrough', () => { addLog(`${side}: canplaythrough`); }, { once:true });

  video.addEventListener('error', () => {
    clearLoadTimeout();
    const err = video.error;
    const msg = videoErrorMessage(err);
    statusElem.innerHTML = `動画読み込みエラー: ${msg}`;
    addLog(`${side}: video error - ${msg}`, 'error');
    video.style.display = 'none';
    canvas.style.display = 'none';
    objectURLManager.revoke();
  });

  // ネットワーク/デコードの進行状況を少し詳しく監視
  video.addEventListener('stalled', () => addLog(`${side}: stalled`,'warn'));
  video.addEventListener('suspend', () => addLog(`${side}: suspend`,'warn'));
  video.addEventListener('waiting', () => addLog(`${side}: waiting`,'warn'));
  video.addEventListener('abort', () => addLog(`${side}: abort`,'warn'));
  video.addEventListener('progress', () => { /* 進行状況が分かるなら追加 */ });

  return function handleFile(file) {
    // reset
    loadedMeta = false;
    clearLoadTimeout();
    statusElem.innerHTML = '読み込み中 <span class="loader" aria-hidden="true"></span>';
    nameElem.innerText = `${file.name} (${file.type || 'unknown'}, ${Math.round(file.size/1024)} KB)`;
    addLog(`選択: name=${file.name}, type=${file.type}, size=${file.size} bytes`);

    // コーデック非互換の可能性に関する簡易診断（拡張不可なのは注意）
    if (file.type && !file.type.startsWith('video/')) {
      addLog(`注意: MIMEタイプが video/ ではありません: ${file.type}`, 'warn');
    }

    // 優先: createObjectURL（速い）
    try {
      const url = URL.createObjectURL(file);
      objectURLManager.set(url);
      video.src = url;
      // 読み込みを強制
      video.load();
      addLog(`objectURL 作成成功 (${url})`);
    } catch (e) {
      addLog('createObjectURL に失敗、FileReader にフォールバック: ' + (e.message||e), 'warn');
      const fr = new FileReader();
      fr.onload = () => {
        try {
          video.src = fr.result;
          objectURLManager.set(null);
          video.load();
          addLog('FileReader による dataURL 設定成功');
        } catch (err) {
          addLog('dataURL 設定後の load に失敗: ' + (err.message||err), 'error');
        }
      };
      fr.onerror = () => { statusElem.innerText = 'ファイル読み込みに失敗しました（FileReader）'; addLog('FileReader エラー', 'error'); };
      fr.readAsDataURL(file);
    }

    // タイムアウト: loadedmetadata が来ない場合は診断メッセージを出す
    loadTimeout = setTimeout(() => {
      if (!loadedMeta) {
        statusElem.innerText = '読み込みが遅いか失敗しました（タイムアウト）。可能性: 非対応コーデック / 大きすぎるファイル / ブラウザ制限';
        addLog(`${side}: loadedmetadata タイムアウト（${file.name}）`, 'error');
      }
    }, 8000);
  };
}

const handleVideo1File = setupVideoLoadingHandlers(video1, video1Name, video1Status, objectURLManager1, '左(お手本)');
const handleVideo2File = setupVideoLoadingHandlers(video2, video2Name, video2Status, objectURLManager2, '右(比較)');

function isAcceptableFile(file) {
  if (!file) return false;
  const t = (file.type || '').toLowerCase();
  // mp4, quicktime(MOV) または動画全般をまず許容し、診断ロジックで原因を出す
  return t.includes('mp4') || t.includes('quicktime') || t.startsWith('video/');
}

// input change ハンドリング
video1Input.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  addLog('左のファイル選択イベント発火');
  if (!isAcceptableFile(file)) {
    video1Name.innerText = 'サポートされないファイル形式です';
    video1Status.innerText = 'フォーマット不明';
    addLog('左: サポート外のファイル形式: ' + (file.type || 'unknown'), 'error');
    video1.style.display = 'none';
    canvas1.style.display = 'none';
    return;
  }
  try {
    handleVideo1File(file);
    video1.style.display = 'block';
    canvas1.style.display = 'block';
    referencePoseFrames = [];
    video1Status.innerText = '読み込み開始...';
  } catch (e) {
    addLog('左: handleVideo1File で例外: ' + (e.message||e), 'error');
    video1Status.innerText = 'ファイル処理に失敗しました';
  }
});

video2Input.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  addLog('右のファイル選択イベント発火');
  if (!isAcceptableFile(file)) {
    video2Name.innerText = 'サポートされないファイル形式です';
    video2Status.innerText = 'フォーマット不明';
    addLog('右: サポート外のファイル形式: ' + (file.type || 'unknown'), 'error');
    video2.style.display = 'none';
    canvas2.style.display = 'none';
    return;
  }
  try {
    handleVideo2File(file);
    video2.style.display = 'block';
    canvas2.style.display = 'block';
    targetPoseFrames = [];
    video2Status.innerText = '読み込み開始...';
  } catch (e) {
    addLog('右: handleVideo2File で例外: ' + (e.message||e), 'error');
    video2Status.innerText = 'ファイル処理に失敗しました';
  }
});

// Compare ボタン押下時に ai モジュールを遅延読み込みして実行
compareBtn.addEventListener('click', async () => {
  adviceArea.innerText = 'AIによるアドバイス生成中...';
  addLog('Compareボタン押下 - AI処理開始');
  if (!referencePoseFrames.length || !targetPoseFrames.length) {
    adviceArea.innerText = '両方の動画を再生して骨格抽出データを取得してください（再生ボタンを押してください）。';
    addLog('Compare 実行前のチェックでデータ不足', 'warn');
    return;
  }
  const refLm = referencePoseFrames[referencePoseFrames.length-1].landmarks;
  const tarLm = targetPoseFrames[targetPoseFrames.length-1].landmarks;

  try {
    const module = await import('./aiAdvice.js');
    if (!module || typeof module.getAdviceFromGemini !== 'function') throw new Error('AIモジュールが不正です');
    addLog('aiAdvice モジュール読み込み成功');
    const advice = await module.getAdviceFromGemini(refLm, tarLm);
    adviceArea.innerText = advice;
    addLog('AI 応答受信');
  } catch (e) {
    addLog('AIモジュール読み込み/実行エラー: ' + (e.message||e), 'error');
    adviceArea.innerText = `AIモジュールの読み込みに失敗しました: ${e.message}`;
  }
});

// 画面遷移時に objectURL を解放
window.addEventListener('beforeunload', () => { try{ objectURLManager1.revoke(); objectURLManager2.revoke(); }catch{} });

// 初期ログ
addLog('compare.js 初期化完了');
