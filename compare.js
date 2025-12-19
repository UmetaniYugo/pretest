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
const canvasTrajectory1 = document.getElementById('canvasTrajectory1');
const canvasTrajectory2 = document.getElementById('canvasTrajectory2');
const adviceArea = document.getElementById('adviceArea');
const compareBtn = document.getElementById('compareBtn');

let referencePoseFrames = [];
let targetPoseFrames = [];
let latestResults1 = null;
let latestResults2 = null;
let isComparisonActive = false; // Flag to control advice generation
let recorder1 = null;
let recorder2 = null;
let chunks1 = [];
let chunks2 = [];
const downloadArea = document.getElementById('downloadArea');

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
function startDrawLoop(video, canvas, ctxRef, label, getLatestResults, trajectoryCanvas) {
  if (!video || !canvas) return () => { };
  if (!ctxRef.ctx) ctxRef.ctx = canvas.getContext('2d');

  // 軌跡用キャンバス
  let ctxTraj = null;
  if (trajectoryCanvas) {
    ctxTraj = trajectoryCanvas.getContext('2d');
  }

  const dpr = window.devicePixelRatio || 1;
  let rafId = null;
  let lastLandmarks = null; // 前フレームの座標（軌跡描画用）

  function loop() {
    try {
      if (!video.paused && !video.ended && video.readyState >= 2) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // 1. メインCanvas (Skeleton) - 毎回リサイズ＆クリア
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          ctxRef.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctxRef.ctx.resetTransform();
        }

        // 2. 軌跡Canvas - リサイズ時はクリアされるが、それは許容（アスペクト比変更時など）
        // 通常はリサイズされないので軌跡が残る
        if (trajectoryCanvas && (trajectoryCanvas.width !== vw || trajectoryCanvas.height !== vh)) {
          trajectoryCanvas.width = vw;
          trajectoryCanvas.height = vh;
          trajectoryCanvas.style.width = '100%';
          trajectoryCanvas.style.height = '100%';
          ctxTraj.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctxTraj.resetTransform();
          lastLandmarks = null; // リセット
        }

        // ビデオ描画
        ctxRef.ctx.clearRect(0, 0, vw, vh);
        ctxRef.ctx.drawImage(video, 0, 0, vw, vh);

        // 骨格描画
        const results = getLatestResults();
        if (results && results.poseLandmarks) {
          drawPoseOverlay(results, ctxRef.ctx);

          // 3. 軌跡描画 (Incremental)
          if (ctxTraj) {
            drawTrajectoryIncremental(lastLandmarks, results.poseLandmarks, ctxTraj, label === 'Left' ? '#00FFFF' : '#FF00FF');
            lastLandmarks = results.poseLandmarks;
          }
        }
      }
    } catch (e) {
      if (Math.random() < 0.01) addLog(`${label}: draw loop 例外: ${e.message || e}`, 'error'); // ログ抑制
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
    const connections = window.POSE_CONNECTIONS || window.Pose.POSE_CONNECTIONS;
    if (connections) {
      window.drawConnectors(ctx, results.poseLandmarks, connections, { color: '#00FF00', lineWidth: 4 });
    }
    window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
  } catch (e) {
    // console.error(e);
  }
}

function drawTrajectoryIncremental(prevLandmarks, currLandmarks, ctx, color) {
  if (!prevLandmarks || !currLandmarks) return;
  const joints = getSelectedJoints();
  if (joints.length === 0) return;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.beginPath();

  joints.forEach(jointIndex => {
    const prev = prevLandmarks[jointIndex];
    const curr = currLandmarks[jointIndex];
    if (prev && curr && prev.visibility > 0.5 && curr.visibility > 0.5) {
      const x1 = prev.x * ctx.canvas.width;
      const y1 = prev.y * ctx.canvas.height;
      const x2 = curr.x * ctx.canvas.width;
      const y2 = curr.y * ctx.canvas.height;

      // 異常な飛び値（誤検出）を除外
      if (Math.abs(x1 - x2) < 100 && Math.abs(y1 - y2) < 100) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    }
  });
  ctx.stroke();
  ctx.restore();
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
    const stopSync = startDrawLoop(videoEl, canvasEl, { ctx: ctx }, label, () => (label === 'Left' ? latestResults1 : latestResults2), label === 'Left' ? canvasTrajectory1 : canvasTrajectory2);
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
  downloadArea.innerHTML = ''; // Reset download buttons
  chunks1 = [];
  chunks2 = [];

  try {
    // 録画のセットアップ (Canvasからストリームを取得)
    const stream1 = canvas1.captureStream(30); // 30fps
    const stream2 = canvas2.captureStream(30);

    // MediaRecorderのサポート確認と生成
    // mimeTypeはブラウザのサポート状況による (通常 webm)
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm'; // fallback
    }

    try {
      recorder1 = new MediaRecorder(stream1, { mimeType });
      recorder1.ondataavailable = e => { if (e.data.size > 0) chunks1.push(e.data); };
      recorder1.start();
    } catch (e) { console.warn('Recorder1 init fail', e); recorder1 = null; }

    try {
      recorder2 = new MediaRecorder(stream2, { mimeType });
      recorder2.ondataavailable = e => { if (e.data.size > 0) chunks2.push(e.data); };
      recorder2.start();
    } catch (e) { console.warn('Recorder2 init fail', e); recorder2 = null; }

    await Promise.all([video1.play(), video2.play()]);
  } catch (e) {
    addLog('再生開始エラー: ' + e.message, 'error');
    compareBtn.disabled = false;
    compareBtn.textContent = '動画比較してアドバイス表示';
    return;
  }

  // ループ再開
  const s1 = startDrawLoop(video1, canvas1, { ctx: ctx1 }, 'Left', () => latestResults1, canvasTrajectory1);
  const s2 = startDrawLoop(video2, canvas2, { ctx: ctx2 }, 'Right', () => latestResults2, canvasTrajectory2);
  const p1 = startPoseLoop(video1, pose1);
  const p2 = startPoseLoop(video2, pose2);

  loopManager1.set(() => { s1(); p1(); });
  loopManager2.set(() => { s2(); p2(); });
});

// 再生終了監視
let endedCount = 0;
let isProcessingAdvice = false;

const jointSelectionArea = document.getElementById('jointSelectionArea');

const JOINT_LABELS = {
  16: '右手首', 15: '左手首', 14: '右ひじ', 13: '左ひじ',
  12: '右肩', 11: '左肩', 24: '右腰', 23: '左腰',
  26: '右ひざ', 25: '左ひざ', 28: '右足首', 27: '左足首', 0: '鼻'
};

function getSelectedJoints() {
  const checkboxes = jointSelectionArea.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
}

function analyzeMotion(referenceFrames, targetFrames, selectedJoints) {
  if (!referenceFrames.length || !targetFrames.length) return 'データが不足しています。';

  // 簡易的な肩幅による正規化
  function getScale(landmarks) {
    if (!landmarks) return 1;
    const ls = landmarks[11];
    const rs = landmarks[12];
    if (ls && rs && ls.visibility > 0.5 && rs.visibility > 0.5) {
      return Math.sqrt(Math.pow(ls.x - rs.x, 2) + Math.pow(ls.y - rs.y, 2)) || 1;
    }
    return 1;
  }

  const len = Math.min(referenceFrames.length, targetFrames.length);
  let adviceList = [];

  selectedJoints.forEach(jointIndex => {
    let diffSum = 0;
    let validCount = 0;
    let yDiffSum = 0; // + means target is lower (larger Y)

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
        // Normalize
        const rX = refJoint.x / rScale;
        const rY = refJoint.y / rScale;
        const tX = tarJoint.x / tScale;
        const tY = tarJoint.y / tScale;

        // Distance
        const diff = Math.sqrt(Math.pow(rX - tX, 2) + Math.pow(rY - tY, 2));
        diffSum += diff;

        yDiffSum += (tY - rY);
        validCount++;
      }
    }

    const label = JOINT_LABELS[jointIndex] || `関節(${jointIndex})`;

    if (validCount === 0) {
      adviceList.push(`[${label}] 検出できませんでした。`);
      return;
    }

    const avgDiff = diffSum / validCount;
    const avgYDiff = yDiffSum / validCount;

    if (avgDiff < 0.1) {
      adviceList.push(`[${label}] 素晴らしい！お手本とほぼ同じ動きです。`);
    } else {
      let msg = `[${label}] ズレがあります。`;
      if (avgYDiff > 0.05) {
        msg += '位置が【低い】です。もっと高く保ちましょう。';
      } else if (avgYDiff < -0.05) {
        msg += '位置が【高い】です。重心を落とすかリラックスしてください。';
      } else {
        msg += '軌道がずれています。お手本の青い線をなぞるように意識しましょう。';
      }
      adviceList.push(msg);
    }
  });

  return adviceList.length > 0 ? adviceList.join('\n') : '関節が選択されていません。';
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

    // アドバイス生成 & ダウンロードボタン作成
    adviceArea.textContent = '解析中...';

    setTimeout(() => {
      try {
        // 録画停止 (エラー無視)
        try { if (recorder1 && recorder1.state !== 'inactive') recorder1.stop(); } catch (e) { }
        try { if (recorder2 && recorder2.state !== 'inactive') recorder2.stop(); } catch (e) { }

        // 分析実行
        const selectedJoints = getSelectedJoints();
        const advice = analyzeMotion(
          referencePoseFrames,
          targetPoseFrames,
          selectedJoints
        );

        adviceArea.textContent = advice;
        adviceArea.style.background = '#00695c';

        // ダウンロードボタン生成
        createDownloadButton(chunks1, 'otehon_skeleton.webm', 'お手本動画を保存');
        createDownloadButton(chunks2, 'hikaku_skeleton.webm', '比較動画を保存');

        addLog('解析・動画生成成功');
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

function createDownloadButton(chunks, filename, label) {
  if (!chunks || chunks.length === 0) return;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);

  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.padding = '10px';
  btn.style.background = '#e65100';
  btn.style.color = 'white';
  btn.style.border = 'none';
  btn.style.borderRadius = '5px';
  btn.style.cursor = 'pointer';
  btn.onclick = () => a.click();

  downloadArea.appendChild(btn);
}

video1.addEventListener('ended', onVideoEnded);
video2.addEventListener('ended', onVideoEnded);
