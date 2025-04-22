const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');

let pose = new Pose({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults(onResults);

navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
  video.srcObject = stream;
  video.onloadedmetadata = () => {
    video.play();
    const camera = new Camera(video, {
      onFrame: async () => {
        await pose.send({ image: video });
      },
      width: 640,
      height: 480
    });
    camera.start();
  };
});

function onResults(results) {
  console.log("onResultsが起動");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
  drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });

  // 右手の動作を解析
  if (results.poseLandmarks) {
    const wrist = results.poseLandmarks[16];  // 右手首
    const shoulder = results.poseLandmarks[12]; // 右肩
    const elbow = results.poseLandmarks[14]; // 右ひじ

    if (wrist.y < shoulder.y && elbow.y < shoulder.y) {
      statusText.innerText = "投げる準備！";
    } else if (wrist.x > shoulder.x + 0.1) {
      statusText.innerText = "投げた！";
    } else {
      statusText.innerText = "待機中…";
    }
  }
}
