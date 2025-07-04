const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const ctx1 = canvas1.getContext('2d');
const ctx2 = canvas2.getContext('2d');
const adviceArea = document.getElementById('adviceArea');
const detectThrowBtn = document.getElementById('detectThrowBtn');

let referencePose = null;
let allReferencePoses = [];
let adviceHistory = []; // ここでアドバイスを溜める

const pose1 = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
const pose2 = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });

pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

let recordingAllPoses = false;

document.getElementById('video1Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video1.src = URL.createObjectURL(file);
    video1.onloadeddata = () => {
      video1.currentTime = 0;
      allReferencePoses = [];
      referencePose = null;
      adviceArea.innerText = "お手本動画を再生し、「お手本の投げ瞬間を自動検出」ボタンを押してください。";
    };
  }
});

document.getElementById('video2Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video2.src = URL.createObjectURL(file);
    video2.onloadeddata = () => video2.play();
  }
});

video1.addEventListener('play', () => {
  recordingAllPoses = true;
  startProcessing(video1, pose1, true);
});
video1.addEventListener('pause', () => {
  recordingAllPoses = false;
});
video1.addEventListener('ended', () => {
  recordingAllPoses = false;
  video1.currentTime = 0;
});

video2.addEventListener('play', () => {
  adviceHistory = []; // 再生ごとにリセット
  startProcessing(video2, pose2, false);
});
video2.addEventListener('ended', () => {
  video2.currentTime = 0;
  // 再生が終わったら、アドバイスを集計してまとめて表示
  adviceArea.innerText = summarizeAdvices(adviceHistory);
});

function startProcessing(video, pose, isReference) {
  function process() {
    if (video.paused || video.ended) return;
    pose.send({ image: video });
    requestAnimationFrame(process);
  }
  process();
}

pose1.onResults(results => {
  drawPose(results, ctx1, canvas1);
  if (recordingAllPoses && results.poseLandmarks) {
    allReferencePoses.push(JSON.parse(JSON.stringify(results.poseLandmarks)));
  }
});

pose2.onResults(results => {
  drawPose(results, ctx2, canvas2);
  // アドバイスは動画再生終了後にまとめて表示
  if (results.poseLandmarks && referencePose && !video2.paused && !video2.ended) {
    const advice = generatePracticalAdvice(referencePose, results.poseLandmarks);
    adviceHistory.push(advice);
  }
});

// 投げる瞬間自動検出ボタン
detectThrowBtn.onclick = () => {
  if (allReferencePoses.length < 2) {
    adviceArea.innerText = "お手本動画を一度最後まで再生してください。";
    return;
  }
  const idx = detectThrowMoment(allReferencePoses);
  referencePose = allReferencePoses[idx];
  adviceArea.innerText = "投げる瞬間を自動で設定しました。右側の動画と比較できます。";
};

// 投げる瞬間（右手首速度最大）を検出
function detectThrowMoment(poses) {
  let maxSpeed = 0;
  let throwIndex = 0;
  for (let i = 1; i < poses.length; i++) {
    const prev = poses[i-1][16]; // 右手首
    const curr = poses[i][16];
    if (!prev || !curr) continue;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const speed = Math.sqrt(dx*dx + dy*dy);
    if (speed > maxSpeed) {
      maxSpeed = speed;
      throwIndex = i;
    }
  }
  return throwIndex;
}

function drawPose(results, ctx, canvas) {
  if (!results.poseLandmarks) return;
  canvas.width = results.image.width;
  canvas.height = results.image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
  drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
}

// 実践しやすいアドバイス生成
function generatePracticalAdvice(ref, target) {
  const getAngle = (a, b, c) => {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const cb = { x: b.x - c.x, y: b.y - c.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAB = Math.sqrt(ab.x**2 + ab.y**2);
    const magCB = Math.sqrt(cb.x**2 + cb.y**2);
    return Math.acos(dot / (magAB * magCB)) * (180 / Math.PI);
  };

  const rS = ref[12], rE = ref[14], rW = ref[16];
  const tS = target[12], tE = target[14], tW = target[16];
  if (!(rS && rE && rW && tS && tE && tW)) return "十分なデータがありません";

  const angleRef = getAngle(rS, rE, rW);
  const angleTar = getAngle(tS, tE, tW);

  let advice = "";
  if (angleTar < angleRef - 10) {
    advice += "肘をもう少し伸ばして投げてみましょう。";
  } else if (angleTar > angleRef + 10) {
    advice += "肘をもう少し曲げて投げてみましょう。";
  } else {
    advice += "肘の使い方はお手本に近いです。";
  }
  // 腕の高さ（肩と手首のy座標比較）
  if (Math.abs(tW.y - tS.y) > Math.abs(rW.y - rS.y) + 0.07) {
    advice += "手首の位置が低いので、もう少し高く振り上げましょう。";
  } else if (Math.abs(tW.y - tS.y) < Math.abs(rW.y - rS.y) - 0.07) {
    advice += "手首の位置が高すぎるかもしれません。自然に振り下ろすよう意識しましょう。";
  }
  // 追加：手首の前後動（x座標）
  if (tW.x < tS.x - 0.05) {
    advice += "手首をより前に出すイメージで投げてみましょう。";
  }

  if (advice === "") advice = "お手本とよく似ています！";
  return advice;
}

// 複数アドバイスからまとめ文を生成
function summarizeAdvices(history) {
  if (!history || history.length === 0) return "アドバイスデータがありません。";
  // 出現回数の多いアドバイスをグルーピングして要約
  const freq = {};
  for (const adv of history) {
    freq[adv] = (freq[adv] || 0) + 1;
  }
  // 多い順に並べて最大3件くらい表示
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  let summary = "まとめアドバイス：\n";
  sorted.slice(0, 3).forEach(([advice, cnt], idx) => {
    summary += `${idx + 1}. ${advice}（${cnt}回）\n`;
  });
  return summary;
}
