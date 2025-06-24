const video1 = document.getElementById('video1');
const video2 = document.getElementById('video2');
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');
const ctx1 = canvas1.getContext('2d');
const ctx2 = canvas2.getContext('2d');
const adviceArea = document.getElementById('adviceArea');

let referencePose = null;  // 手本動画の最新骨格データを保持

// Mediapipe Poseインスタンス2つ作成
const pose1 = new Pose({locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
const pose2 = new Pose({locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});

pose1.setOptions({modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
pose2.setOptions({modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});

pose1.onResults(results => {
  drawResults(results, ctx1, canvas1);
  if(results.poseLandmarks){
    referencePose = results.poseLandmarks;  // 手本動画の骨格情報を常に最新化
  }
});

pose2.onResults(results => {
  drawResults(results, ctx2, canvas2);
  if(results.poseLandmarks && referencePose){
    showComparisonAdvice(referencePose, results.poseLandmarks);
  }
});

// ファイルアップロード時の動画設定
document.getElementById('video1Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if(file){
    video1.src = URL.createObjectURL(file);
    video1.load();
  }
});
document.getElementById('video2Input').addEventListener('change', e => {
  const file = e.target.files[0];
  if(file){
    video2.src = URL.createObjectURL(file);
    video2.load();
  }
});

// 動画再生時にPose推定を開始
video1.addEventListener('play', () => startProcessing(video1, pose1));
video2.addEventListener('play', () => startProcessing(video2, pose2));

// 動画同時自動再生
function tryAutoPlayBoth() {
  if(video1.readyState >= 2 && video2.readyState >= 2){
    video1.play();
    video2.play();
  } else {
    setTimeout(tryAutoPlayBoth, 200);
  }
}
tryAutoPlayBoth();

function startProcessing(video, pose){
  async function processFrame(){
    if(video.paused || video.ended) return;
    await pose.send({image: video});
    requestAnimationFrame(processFrame);
  }
  processFrame();
}

function drawResults(results, ctx, canvas){
  if(!results.image) return;
  canvas.width = results.image.width;
  canvas.height = results.image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if(results.poseLandmarks){
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
    drawLandmarks(ctx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2});
  }
}

function showComparisonAdvice(reference, current){
  // ここでランドマーク同士の比較をしてアドバイス作成
  // 例として肩・肘・手首の角度差で判断

  // 角度計算関数（3点の角度）
  function calcAngle(A, B, C){
    const AB = {x: A.x - B.x, y: A.y - B.y};
    const CB = {x: C.x - B.x, y: C.y - B.y};
    const dot = AB.x * CB.x + AB.y * CB.y;
    const magAB = Math.sqrt(AB.x*AB.x + AB.y*AB.y);
    const magCB = Math.sqrt(CB.x*CB.x + CB.y*CB.y);
    const cosTheta = dot / (magAB * magCB);
    let angle = Math.acos(Math.min(Math.max(cosTheta, -1), 1)); // 0〜πラジアン
    return angle * 180 / Math.PI;  // 度数に変換
  }

  // アドバイス内容初期化
  let advices = [];

  // 右腕の角度比較（肩12,肘14,手首16）
  const refRightAngle = calcAngle(reference[12], reference[14], reference[16]);
  const curRightAngle = calcAngle(current[12], current[14], current[16]);
  const diffRight = curRightAngle - refRightAngle;
  if(Math.abs(diffRight) > 15){
    advices.push(`右腕の角度が手本と${diffRight > 0 ? '大きく' : '小さく'}違います (${diffRight.toFixed(1)}度)`);
  }

  // 左腕の角度比較（肩11,肘13,手首15）
  const refLeftAngle = calcAngle(reference[11], reference[13], reference[15]);
  const curLeftAngle = calcAngle(current[11], current[13], current[15]);
  const diffLeft = curLeftAngle - refLeftAngle;
  if(Math.abs(diffLeft) > 15){
    advices.push(`左腕の角度が手本と${diffLeft > 0 ? '大きく' : '小さく'}違います (${diffLeft.toFixed(1)}度)`);
  }

  // 肩の高さ比較（右肩 y座標 12, 左肩 11）
  const diffShoulderRight = current[12].y - reference[12].y;
  if(Math.abs(diffShoulderRight) > 0.1){
    advices.push(`右肩の高さが手本と${diffShoulderRight > 0 ? '低く' : '高く'}違います`);
  }
  const diffShoulderLeft = current[11].y - reference[11].y;
  if(Math.abs(diffShoulderLeft) > 0.1){
    advices.push(`左肩の高さが手本と${diffShoulderLeft > 0 ? '低く' : '高く'}違います`);
  }

  // 頭の位置比較 (鼻0のy座標)
  const diffHead = current[0].y - reference[0].y;
  if(Math.abs(diffHead) > 0.1){
    advices.push(`頭の位置が手本と${diffHead > 0 ? '低く' : '高く'}違います`);
  }

  if(advices.length === 0){
    adviceArea.innerText = "手本とほぼ同じ動きです！";
  } else {
    adviceArea.innerText = advices.join('\n');
  }
}
