const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const ctx1 = canvas1.getContext('2d');
const ctx2 = canvas2.getContext('2d');
const adviceArea1 = document.getElementById('adviceArea1');
const adviceArea2 = document.getElementById('adviceArea2');

const pose1 = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
const pose2 = new Pose({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });

pose1.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose2.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose1.onResults(results => drawPose(results, ctx1, canvas1, adviceArea1));
pose2.onResults(results => drawPose(results, ctx2, canvas2, adviceArea2));

document.getElementById('video1Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video1.src = URL.createObjectURL(file);
    video1.load();
    video1.play();
  }
});

document.getElementById('video2Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video2.src = URL.createObjectURL(file);
    video2.load();
    video2.play();
  }
});

video1.addEventListener('play', () => startProcessing(video1, pose1));
video2.addEventListener('play', () => startProcessing(video2, pose2));

function startProcessing(video, pose) {
  const process = () => {
    if (video.paused || video.ended) return;
    pose.send({ image: video });
    requestAnimationFrame(process);
  };
  process();
}

function drawPose(results, ctx, canvas, adviceArea) {
  if (!results.poseLandmarks) return;

  canvas.width = results.image.width;
  canvas.height = results.image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
  drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });

  // 右腕の高さアドバイス
  const rShoulder = results.poseLandmarks[12];
  const rElbow = results.poseLandmarks[14];
  const rWrist = results.poseLandmarks[16];

  if (rWrist && rElbow && rShoulder) {
    if (rWrist.y < rShoulder.y) {
      adviceArea.innerText = "右腕が上がっています（投球動作の可能性あり）";
    } else {
      adviceArea.innerText = "右腕が下がっています。";
    }
  } else {
    adviceArea.innerText = "姿勢を検出できません。";
  }
}
