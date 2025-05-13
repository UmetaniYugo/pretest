const liveVideo = document.getElementById('liveVideo');
const uploadedVideo = document.getElementById('uploadedVideo');
const liveCanvas = document.getElementById('liveCanvas');
const uploadedCanvas = document.getElementById('uploadedCanvas');
const liveCtx = liveCanvas.getContext('2d');
const uploadedCtx = uploadedCanvas.getContext('2d');
const statusText = document.getElementById('statusText');

let liveLandmarks = null;
let uploadedLandmarks = null;

// MediaPipe Pose 設定
const createPose = (onResultsCallback) => {
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
  pose.onResults(onResultsCallback);
  return pose;
};

const livePose = createPose((results) => {
  liveCanvas.width = liveVideo.videoWidth;
  liveCanvas.height = liveVideo.videoHeight;
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  if (results.poseLandmarks) {
    drawConnectors(liveCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
    drawLandmarks(liveCtx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
    liveLandmarks = results.poseLandmarks;
  }
  compareLandmarks();
});

const uploadedPose = createPose((results) => {
  uploadedCanvas.width = uploadedVideo.videoWidth;
  uploadedCanvas.height = uploadedVideo.videoHeight;
  uploadedCtx.clearRect(0, 0, uploadedCanvas.width, uploadedCanvas.height);
  if (results.poseLandmarks) {
    drawConnectors(uploadedCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00BFFF', lineWidth: 4 });
    drawLandmarks(uploadedCtx, results.poseLandmarks, { color: '#FFD700', lineWidth: 2 });
    uploadedLandmarks = results.poseLandmarks;
  }
  compareLandmarks();
});

// カメラ起動
navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
  liveVideo.srcObject = stream;
  liveVideo.onloadedmetadata = () => {
    liveVideo.play();
    const camera = new Camera(liveVideo, {
      onFrame: async () => {
        await livePose.send({ image: liveVideo });
      },
      width: 640,
      height: 480
    });
    camera.start();
  };
});

// アップロード動画処理
document.getElementById('uploadInput').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  uploadedVideo.src = url;
  uploadedVideo.onloadedmetadata = () => {
    uploadedVideo.play();
    requestAnimationFrame(processUploadedFrame);
  };
});

// アップロード動画フレーム送信
function processUploadedFrame() {
  if (uploadedVideo.paused || uploadedVideo.ended) return;
  uploadedPose.send({ image: uploadedVideo });
  requestAnimationFrame(processUploadedFrame);
}

// 骨格比較（例：右手首の距離）
function compareLandmarks() {
  if (!liveLandmarks || !uploadedLandmarks) return;

  const liveWrist = liveLandmarks[16];     // 右手首
  const uploadedWrist = uploadedLandmarks[16];

  const dx = liveWrist.x - uploadedWrist.x;
  const dy = liveWrist.y - uploadedWrist.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 0.1) {
    statusText.innerText = "右手の動きが似ています！";
  } else {
    statusText.innerText = "右手の動きが異なります。";
  }
}
