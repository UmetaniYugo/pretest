// import { getAdviceFromGemini } from './aiAdvice.js'; // Removed for global usage

/* compare.js - Mobile optimization & Fixes */

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
let latestResults1 = null;
let latestResults2 = null;
let isComparisonActive = false; // Flag to control advice generation

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

// Context initialization
const ctx1 = canvas1.getContext('2d');
const ctx2 = canvas2.getContext('2d');

// Canvasリサイズ同期用ループ (描画はしない、サイズだけ合わせる)
// 同期描画ループ (Video -> Skeleton)
function startDrawLoop(video, canvas, ctxRef, label, getLatestResults) {
  if (!video || !canvas) return () => { };
  if (!ctxRef.ctx) ctxRef.ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let rafId = null;

  function loop() {
    try {
      if (!video.paused && !video.ended && video.readyState >= 2) {
        // Intrinsic resolution (実際の解像度)
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // Canvasの解像度（バッファサイズ）を動画の解像度に合わせる
        // これによりMediaPipeの座標と1:1になる
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
          // style.width/height は設定しない（CSSの width:100%; height:100% に任せる）
          // これにより、動画がCSSで縮小されてもCanvasだけ巨大化するのを防ぐ
          canvas.style.width = '100%';
          canvas.style.height = '100%';

          ctxRef.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctxRef.ctx.resetTransform();
        }

        // 1. ビデオを描画
        ctxRef.ctx.clearRect(0, 0, vw, vh);
        ctxRef.ctx.drawImage(video, 0, 0, vw, vh);

        // 2. 骨格を描画 (あれば)
        const results = getLatestResults();
        if (results && results.poseLandmarks) {
          drawPoseOverlay(results, ctxRef.ctx);
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

function stopLoop(rafRef) { if (rafRef && typeof rafRef === 'function') rafRef(); }

function drawPoseOverlay(results, ctx) {
  if (!results.poseLandmarks) return;
  try {
    window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
    window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
  } catch (e) {
    // 描画エラーはログ抑制(頻出するため)
  }
}

function recordLandmarks(results, frameArray, video) {
  if (!results.poseLandmarks) return;
  const now = video.currentTime || 0;
  // 記録頻度制御なしで全フレーム記録推奨だが、データ量削減のため間引く
  const last = frameArray.length ? frameArray[frameArray.length - 1].time : -999;
  if (frameArray.length === 0 || Math.abs(now - last) > 0.05) {
    frameArray.push({ landmarks: JSON.parse(JSON.stringify(results.poseLandmarks)), time: now });
  }
}

// MediaPipe results handler
if (pose1) {
  pose1.onResults(results => {
    try {
      latestResults1 = results;
      recordLandmarks(results, referencePoseFrames, video1);
    } catch (e) { console.error(e); }
  });
}
if (pose2) {
  pose2.onResults(results => {
    try {
      latestResults2 = results;
      recordLandmarks(results, targetPoseFrames, video2);
    } catch (e) { console.error(e); }
  });
}

// --- 動画アップロード処理 ---

// MediaPipeへのフレーム送信ループ
function startPoseLoop(v, p) {
  let active = true;
  async function loop() {
    if (!active) return;
    if (!v.paused && !v.ended && v.readyState >= 2 && p) {
      try {
        await p.send({ image: v });
      } catch (e) { console.error(e); }
    }
    if (active) requestAnimationFrame(loop);
  }
  loop();
  return () => { active = false; };
}

function handleFileSelect(event, videoEl, canvasEl, videoNameEl, videoStatusEl, urlManager, pose, ctx, label, setStopLoop) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  // 既存ループ停止
  if (setStopLoop && setStopLoop.get && setStopLoop.get()) {
    setStopLoop.get()();
  }

  videoNameEl.textContent = file.name;
  videoStatusEl.textContent = '読み込み中...';

  const url = URL.createObjectURL(file);
  urlManager.set(url);

  // イベントハンドラ設定 (src代入前)
  videoEl.onloadedmetadata = () => {
    videoStatusEl.innerHTML = `準備完了<br><small>(${videoEl.videoWidth}x${videoEl.videoHeight}, ${videoEl.duration.toFixed(0)}s)</small>`;
    addLog(`動画ロード成功: ${file.name}`);

    // 親コンテナのアスペクト比を動画の比率に合わせる
    if (videoEl.parentElement) {
      videoEl.parentElement.style.aspectRatio = `${videoEl.videoWidth} / ${videoEl.videoHeight}`;
    }

    videoEl.style.display = 'block';
    canvasEl.style.display = 'block';

    // 自動再生削除
    // videoEl.play().catch(e => addLog(`自動再生保留: ${e.message}`, 'info'));

    // ループ開始
    const stopSync = startDrawLoop(videoEl, canvasEl, { ctx: ctx }, label, () => (label === 'Left' ? latestResults1 : latestResults2));
    const stopPose = startPoseLoop(videoEl, pose);

    if (setStopLoop) {
      setStopLoop.set(() => {
        stopSync();
        stopPose();
      });
    }
  };

  videoEl.onerror = () => {
    videoStatusEl.textContent = 'エラー';
    addLog(`Load Error: ${videoEl.error ? videoEl.error.message : ''}`, 'error');
  };

  videoEl.src = url;
  videoEl.load();
}

// ループ管理
const loopManager1 = { val: null, get() { return this.val; }, set(fn) { this.val = fn; } };
const loopManager2 = { val: null, get() { return this.val; }, set(fn) { this.val = fn; } };

video1Input.addEventListener('change', (e) => handleFileSelect(e, video1, canvas1, video1Name, video1Status, objectURLManager1, pose1, ctx1, 'Left', loopManager1));
video2Input.addEventListener('change', (e) => handleFileSelect(e, video2, canvas2, video2Name, video2Status, objectURLManager2, pose2, ctx2, 'Right', loopManager2));

// --- 比較・再生処理 ---

compareBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!video1.src || !video2.src || video1.style.display === 'none' || video2.style.display === 'none') {
    alert('両方の動画をアップロードしてください');
    return;
  }

  // UIフィードバック
  compareBtn.disabled = true;
  compareBtn.textContent = '処理中...';
  adviceArea.textContent = '再生準備中...';
  adviceArea.style.background = '#455a64';

  addLog('比較モード開始');

  // 既存ループ停止
  if (loopManager1.val) loopManager1.val();
  if (loopManager2.val) loopManager2.val();

  referencePoseFrames = [];
  targetPoseFrames = [];

  // 先頭へ
  video1.currentTime = 0;
  video2.currentTime = 0;

  isComparisonActive = true;

  try {
    await Promise.all([video1.play(), video2.play()]);
  } catch (e) {
    addLog('再生開始エラー: ' + e.message, 'error');
    compareBtn.disabled = false;
    compareBtn.textContent = '動画比較してアドバイス表示';
    return;
  }

  // ループ再開
  const s1 = startDrawLoop(video1, canvas1, { ctx: ctx1 }, 'Left', () => latestResults1);
  const s2 = startDrawLoop(video2, canvas2, { ctx: ctx2 }, 'Right', () => latestResults2);
  const p1 = startPoseLoop(video1, pose1);
  const p2 = startPoseLoop(video2, pose2);

  loopManager1.set(() => { s1(); p1(); });
  loopManager2.set(() => { s2(); p2(); });
});

// 再生終了監視
let endedCount = 0;
let isProcessingAdvice = false;

const jointSelect = document.getElementById('jointSelect');

function analyzeMotion(referenceFrames, targetFrames, jointIndex) {
  if (!referenceFrames.length || !targetFrames.length) return 'データが不足しています。';

  // 簡易的な肩幅による正規化
  // index 11: left_shoulder, 12: right_shoulder
  function getScale(landmarks) {
    if (!landmarks) return 1;
    const ls = landmarks[11];
    const rs = landmarks[12];
    if (ls && rs && ls.visibility > 0.5 && rs.visibility > 0.5) {
      return Math.sqrt(Math.pow(ls.x - rs.x, 2) + Math.pow(ls.y - rs.y, 2)) || 1;
    }
    return 1;
  }

  // フレーム数の一致（簡易的に短い方に合わせるか、サンプリングする）
  // ここでは単純に先頭から比較し、フレーム平均をとる
  const len = Math.min(referenceFrames.length, targetFrames.length);
  let diffSum = 0;
  let validCount = 0;

  // Y座標の推移（高さ）の平均
  let refYSum = 0;
  let tarYSum = 0;

  for (let i = 0; i < len; i++) {
    if (!referenceFrames[i] || !targetFrames[i]) continue;

    const refL = referenceFrames[i].landmarks;
    const tarL = targetFrames[i].landmarks;

    if (!refL || !tarL) continue;

    const rScale = getScale(refL);
    const tScale = getScale(tarL);

    const refJoint = refL[jointIndex];
    const tarJoint = tarL[jointIndex];

    if (refJoint && tarJoint && refJoint.visibility > 0.5 && tarJoint.visibility > 0.5) {
      // 正規化座標比較
      // (単純化のため、画像の中心などを原点とした相対座標にするのが理想だが、ここでは高さの違いを見るためにYを比較)
      const rY = refJoint.y / rScale;
      const tY = tarJoint.y / tScale;

      const diff = Math.abs(rY - tY);
      diffSum += diff;
      refYSum += rY;
      tarYSum += tY;
      validCount++;
    }
  }

  if (validCount === 0) return '指定された関節が検出されませんでした。';

  const avgDiff = diffSum / validCount;
  const avgRefY = refYSum / validCount;
  const avgTarY = tarYSum / validCount;

  // アドバイス文章作成
  let advice = `平均ズレ（正規化後）: ${avgDiff.toFixed(3)}\n`;

  if (avgDiff < 0.1) {
    advice += '判定: お手本と非常によく似た動きです！素晴らしいです。';
  } else {
    advice += '判定: お手本との違いが見られます。\n';
    if (avgTarY > avgRefY + 0.05) { // Y座標が大きい = 画面下 = 位置が低い
      advice += '・全体的に位置が低くなっています。もう少し高く意識してみましょう。';
    } else if (avgTarY < avgRefY - 0.05) {
      advice += '・全体的に位置が高くなっています。重心を落とすか、位置を調整しましょう。';
    } else {
      advice += '・軌道がずれています。フォームを確認してください。';
    }
  }

  return advice;
}

function onVideoEnded() {
  if (isProcessingAdvice) return;
  if (!isComparisonActive) return;

  endedCount++;
  if (endedCount >= 2) {
    addLog('両動画再生終了。解析開始...');

    // ループは停止しない（巻き戻し再生のため）
    // if (loopManager1.val) loopManager1.val();
    // if (loopManager2.val) loopManager2.val();

    endedCount = 0;
    isProcessingAdvice = true;

    // アドバイス生成
    adviceArea.textContent = '解析中...';

    setTimeout(() => {
      try {
        const jointIndex = parseInt(jointSelect.value, 10);
        const advice = analyzeMotion(
          referencePoseFrames,
          targetPoseFrames,
          jointIndex
        );

        adviceArea.textContent = advice;
        adviceArea.style.background = '#00695c';
        addLog('解析成功');
      } catch (e) {
        adviceArea.textContent = '解析失敗: ' + e.message;
        adviceArea.style.background = '#b71c1c';
        addLog('解析エラー: ' + e.message, 'error');
      } finally {
        compareBtn.disabled = false;
        compareBtn.textContent = '動画比較してアドバイス表示';
        isProcessingAdvice = false;
        isComparisonActive = false;
      }
    }, 500);
  }
}

video1.addEventListener('ended', onVideoEnded);
video2.addEventListener('ended', onVideoEnded);
