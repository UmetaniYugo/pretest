const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const ctx1 = canvas1.getContext('2d');
const ctx2 = canvas2.getContext('2d');
const adviceArea = document.getElementById('adviceArea');

let referencePose = null;

// お手本区間記録用
let markingReference = false;
let tempReferencePoses = [];

const pose1 = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
const pose2 = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });

pose1.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
pose2.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

// お手本区間の開始ボタン
document.getElementById('markStart').onclick = () => {
  markingReference = true;
  tempReferencePoses = [];
};

// お手本区間の終了ボタン
document.getElementById('markEnd').onclick = () => {
  markingReference = false;
  // 区間中央の骨格をお手本に採用
  if (tempReferencePoses.length > 0) {
    referencePose = tempReferencePoses[Math.floor(tempReferencePoses.length / 2)];
    adviceArea.innerText = "お手本骨格を設定しました。";
  } else {
    adviceArea.innerText = "お手本区間に骨格データがありません。";
  }
};

pose1.onResults(results => {
  drawPose(results, ctx1, canvas1);
  if (markingReference && results.poseLandmarks) {
    // 深いコピーで保存
    tempReferencePoses.push(JSON.parse(JSON.stringify(results.poseLandmarks)));
  }
});

pose2.onResults(results => {
  drawPose(results, ctx2, canvas2);
  if (results.poseLandmarks && referencePose) {
    const advice = generateAdvice(referencePose, results.poseLandmarks);
    adviceArea.innerText = advice;
  }
});

document.getElementById('video1Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video1.src = URL.createObjectURL(file);
    video1.onloadeddata = () => video1.play();
  }
});

document.getElementById('video2Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video2.src = URL.createObjectURL(file);
    video2.onloadeddata = () => video2.play();
  }
});

video1.addEventListener('play', () => startProcessing(video1, pose1));
video2.addEventListener('play', () => startProcessing(video2, pose2));

// ループ再生も可。自動では戻さず、controlsで何度でも再生可能に。
video1.addEventListener('ended', () => { video1.currentTime = 0; });
video2.addEventListener('ended', () => { video2.currentTime = 0; });

function startProcessing(video, pose) {
  function process() {
    if (video.paused || video.ended) return;
    pose.send({ image: video });
    requestAnimationFrame(process);
  }
  process();
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

function generateAdvice(ref, target) {
  const angle = (a, b, c) => {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const cb = { x: b.x - c.x, y: b.y - c.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAB = Math.sqrt(ab.x**2 + ab.y**2);
    const magCB = Math.sqrt(cb.x**2 + cb.y**2);
    return Math.acos(dot / (magAB * magCB)) * (180 / Math.PI);
  };

  const r1 = ref[12], e1 = ref[14], w1 = ref[16];
  const r2 = target[12], e2 = target[14], w2 = target[16];
  if (!(r1 && e1 && w1 && r2 && e2 && w2)) return "十分なデータがありません";

  const angle1 = angle(r1, e1, w1);
  const angle2 = angle(r2, e2, w2);
  const diff = Math.abs(angle1 - angle2);

  return `右腕の角度差: 約${diff.toFixed(1)}度\n手本: ${angle1.toFixed(1)}度 / あなた: ${angle2.toFixed(1)}度`;
}
