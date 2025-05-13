const liveVideo = document.getElementById('liveVideo');
const uploadedVideo = document.getElementById('uploadedVideo');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const uploadInput = document.getElementById('uploadInput');

let liveLandmarks = null;
let uploadedLandmarks = null;

// Pose モデルの準備
const pose = new Pose.Pose({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});
pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
pose.onResults(results => {
  if (results.poseLandmarks) {
    if (currentSource === 'live') {
      liveLandmarks = results.poseLandmarks;
    } else {
      uploadedLandmarks = results.poseLandmarks;
    }
    compareLandmarks();
  }
});

let currentSource = 'live';

// カメラから映像を取得
navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
  liveVideo.srcObject = stream;
  liveVideo.onloadedmetadata = () => {
    const camera = new Camera.Camera(liveVideo, {
      onFrame: async () => {
        currentSource = 'live';
        await pose.send({ image: liveVideo });
      },
      width: 640,
      height: 480
    });
    camera.start();
  };
});

// アップロード動画を処理
uploadInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  uploadedVideo.src = url;

  uploadedVideo.onplay = () => {
    const interval = setInterval(async () => {
      if (uploadedVideo.paused || uploadedVideo.ended) {
        clearInterval(interval);
        return;
      }
      canvas.width = uploadedVideo.videoWidth;
      canvas.height = uploadedVideo.videoHeight;
      ctx.drawImage(uploadedVideo, 0, 0, canvas.width, canvas.height);
      const image = canvas;
      currentSource = 'uploaded';
      await pose.send({ image });
    }, 500); // 0.5秒おきに分析
  };
});

// 比較処理 & 結果表示
function compareLandmarks() {
  if (!liveLandmarks || !uploadedLandmarks) return;

  const liveWrist = liveLandmarks[16];
  const uploadedWrist = uploadedLandmarks[16];

  const dx = liveWrist.x - uploadedWrist.x;
  const dy = liveWrist.y - uploadedWrist.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const resultPanel = document.getElementById('resultPanel');
  const resultMessage = document.getElementById('resultMessage');

  if (distance < 0.1) {
    resultMessage.innerText = "動きがよく一致しています！フォームは安定しています。";
  } else {
    resultMessage.innerText = "動きにズレがあります。手の動きを意識してみましょう。";
  }

  resultPanel.style.display = 'block';
}

function closeResult() {
  document.getElementById('resultPanel').style.display = 'none';
}
