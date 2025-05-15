const userVideo = document.getElementById('userVideo');
const uploadedVideo = document.getElementById('uploadedVideo');
const videoUpload = document.getElementById('videoUpload');
const resultBox = document.getElementById('resultBox');

// Mediapipe Pose
const pose = new Pose({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// ユーザーのリアルタイム映像にpose適用
const camera = new Camera(userVideo, {
  onFrame: async () => {
    await pose.send({ image: userVideo });
  },
  width: 640,
  height: 480
});

camera.start();

let latestUserLandmarks = null;
let latestUploadedLandmarks = null;

pose.onResults(results => {
  // どちらのソースか判定
  if (results.image.width === userVideo.videoWidth) {
    latestUserLandmarks = results.poseLandmarks;
  } else if (results.image.width === uploadedVideo.videoWidth) {
    latestUploadedLandmarks = results.poseLandmarks;
  }

  if (latestUserLandmarks && latestUploadedLandmarks) {
    const userAngle = getElbowAngle(latestUserLandmarks);
    const uploadedAngle = getElbowAngle(latestUploadedLandmarks);

    const diff = Math.abs(userAngle - uploadedAngle);
    let advice = `右肘の角度差: ${diff.toFixed(1)}°\n`;

    if (diff > 30) {
      advice += '→ 肘の角度がかなり違います。フォームを見直しましょう。';
    } else if (diff > 15) {
      advice += '→ 肘の角度にやや差があります。調整してみましょう。';
    } else {
      advice += '→ 肘の動きはほぼ一致しています！';
    }

    resultBox.innerText = advice;
  }
});

// アップロード動画が読み込まれたら処理開始
videoUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  uploadedVideo.src = url;

  uploadedVideo.addEventListener('loadeddata', () => {
    processUploadedVideo();
  });
});

function processUploadedVideo() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  function analyzeFrame() {
    if (uploadedVideo.paused || uploadedVideo.ended) return;
    
    canvas.width = uploadedVideo.videoWidth;
    canvas.height = uploadedVideo.videoHeight;
    ctx.drawImage(uploadedVideo, 0, 0, canvas.width, canvas.height);

    pose.send({ image: canvas });

    requestAnimationFrame(analyzeFrame);
  }

  analyzeFrame();
}

function getElbowAngle(landmarks) {
  const shoulder = landmarks[12]; // 右肩
  const elbow = landmarks[14];    // 右ひじ
  const wrist = landmarks[16];    // 右手首

  if (!shoulder || !elbow || !wrist) return 0;

  const a = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y);
  const b = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const c = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);

  const angle = Math.acos((a ** 2 + b ** 2 - c ** 2) / (2 * a * b));
  return angle * (180 / Math.PI); // ラジアン→度
}
