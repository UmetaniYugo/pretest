import { getAdviceFromGemini } from './aiAdvice.js';

const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const adviceArea = document.getElementById('adviceArea');
const compareBtn = document.getElementById('compareBtn');

let referencePoseFrames = [];
let targetPoseFrames = [];

// MediaPipe Poseインスタンス
const pose1 = new window.Pose({locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${file}`});
pose1.setOptions({modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
const pose2 = new window.Pose({locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${file}`});
pose2.setOptions({modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});

function drawPose(results, ctx, canvas, video) {
  if (!results.poseLandmarks) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  window.drawConnectors(ctx, results.poseLandmarks, window.POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
  window.drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
}

function processVideo(video, pose, frameArray, canvas) {
  const ctx = canvas.getContext('2d');
  let lastTime = -1;
  pose.onResults(results => {
    drawPose(results, ctx, canvas, video);
    if (results.poseLandmarks) {
      if (frameArray.length === 0 || Math.abs(video.currentTime - lastTime) > 1) {
        frameArray.push({landmarks: JSON.parse(JSON.stringify(results.poseLandmarks)), time: video.currentTime});
        lastTime = video.currentTime;
      }
    }
  });

  function process() {
    if (video.paused || video.ended || video.readyState < 2) return;
    pose.send({image: video});
    requestAnimationFrame(process);
  }
  process();
}

// ファイル選択・動画読込
document.getElementById('video1Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video1.src = URL.createObjectURL(file);
    referencePoseFrames = [];
    video1.style.display = 'block';
    canvas1.style.display = 'block';
    video1.load();
  }
});
document.getElementById('video2Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    video2.src = URL.createObjectURL(file);
    targetPoseFrames = [];
    video2.style.display = 'block';
    canvas2.style.display = 'block';
    video2.load();
  }
});

// 再生イベントで骨格抽出開始
video1.addEventListener('play', () => processVideo(video1, pose1, referencePoseFrames, canvas1));
video2.addEventListener('play', () => processVideo(video2, pose2, targetPoseFrames, canvas2));

// compareボタンでAIアドバイス
compareBtn.addEventListener('click', async () => {
  adviceArea.innerText = "AIによるアドバイス生成中...";
  if (referencePoseFrames.length === 0 || targetPoseFrames.length === 0) {
    adviceArea.innerText = "両方の動画を再生してください";
    return;
  }
  const refLm = referencePoseFrames[referencePoseFrames.length-1].landmarks;
  const tarLm = targetPoseFrames[targetPoseFrames.length-1].landmarks;
  const advice = await getAdviceFromGemini(refLm, tarLm);
  adviceArea.innerText = advice;
});
