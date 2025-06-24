<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>動画骨格比較アプリ</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .video-container {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .video-section {
            flex: 1;
            min-width: 400px;
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .video-section h3 {
            margin-top: 0;
            color: #333;
        }
        .file-input {
            margin-bottom: 10px;
            padding: 10px;
            border: 2px dashed #ccc;
            border-radius: 5px;
            text-align: center;
        }
        .file-input input {
            margin: 5px 0;
        }
        video {
            width: 100%;
            max-width: 400px;
            height: auto;
            border-radius: 5px;
        }
        canvas {
            width: 100%;
            max-width: 400px;
            height: auto;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        .controls {
            margin: 20px 0;
            text-align: center;
        }
        .controls button {
            padding: 10px 20px;
            margin: 5px;
            border: none;
            border-radius: 5px;
            background-color: #007bff;
            color: white;
            cursor: pointer;
            font-size: 16px;
        }
        .controls button:hover {
            background-color: #0056b3;
        }
        .controls button:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
        .advice-section {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-top: 20px;
        }
        .advice-area {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            border-left: 4px solid #007bff;
            white-space: pre-line;
            min-height: 100px;
            font-size: 14px;
            line-height: 1.5;
        }
        .good-advice {
            border-left-color: #28a745;
            background-color: #d4edda;
        }
        .warning-advice {
            border-left-color: #ffc107;
            background-color: #fff3cd;
        }
        .error-advice {
            border-left-color: #dc3545;
            background-color: #f8d7da;
        }
        .sync-status {
            text-align: center;
            margin: 10px 0;
            font-weight: bold;
        }
        .status-ready { color: #28a745; }
        .status-waiting { color: #ffc107; }
        .status-error { color: #dc3545; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎬 動画骨格比較アプリ</h1>
        <p>手本動画とあなたの動画をアップロードして、動きを比較・分析します</p>
    </div>

    <div class="video-container">
        <div class="video-section">
            <h3>📚 手本動画（参考）</h3>
            <div class="file-input">
                <input type="file" id="video1Input" accept="video/*">
                <br><small>手本となる動画をアップロード</small>
            </div>
            <video id="video1" controls muted></video>
            <canvas id="canvas1"></canvas>
        </div>

        <div class="video-section">
            <h3>🎯 あなたの動画</h3>
            <div class="file-input">
                <input type="file" id="video2Input" accept="video/*">
                <br><small>比較したい動画をアップロード</small>
            </div>
            <video id="video2" controls muted></video>
            <canvas id="canvas2"></canvas>
        </div>
    </div>

    <div class="controls">
        <button id="playBtn">▶️ 同時再生</button>
        <button id="pauseBtn">⏸️ 一時停止</button>
        <button id="resetBtn">🔄 最初から</button>
        <button id="syncBtn">🔗 同期調整</button>
    </div>

    <div class="sync-status" id="syncStatus">動画をアップロードしてください</div>

    <div class="advice-section">
        <h3>💡 リアルタイム分析・アドバイス</h3>
        <div class="advice-area" id="adviceArea">
            両方の動画をアップロードして再生すると、リアルタイムで動きの比較分析が表示されます。
            
            分析項目：
            • 腕の角度差
            • 肩の高さ
            • 頭の位置
            • 全体的な姿勢バランス
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js"></script>

    <script>
        const video1 = document.getElementById('video1');
        const video2 = document.getElementById('video2');
        const canvas1 = document.getElementById('canvas1');
        const canvas2 = document.getElementById('canvas2');
        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');
        const adviceArea = document.getElementById('adviceArea');
        const syncStatus = document.getElementById('syncStatus');

        let referencePose = null;
        let isProcessing = false;
        let bothVideosLoaded = false;

        // MediaPipe Pose設定
        const pose1 = new Pose({
            locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });
        const pose2 = new Pose({
            locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });

        // Pose設定を最適化
        const poseOptions = {
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        };

        pose1.setOptions(poseOptions);
        pose2.setOptions(poseOptions);

        // 結果処理
        pose1.onResults(results => {
            drawResults(results, ctx1, canvas1, '#00FF00');
            if (results.poseLandmarks) {
                referencePose = results.poseLandmarks;
            }
        });

        pose2.onResults(results => {
            drawResults(results, ctx2, canvas2, '#FF6B6B');
            if (results.poseLandmarks && referencePose) {
                showComparisonAdvice(referencePose, results.poseLandmarks);
            }
        });

        // ファイルアップロード処理
        document.getElementById('video1Input').addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
                video1.src = URL.createObjectURL(file);
                video1.load();
                updateSyncStatus();
            }
        });

        document.getElementById('video2Input').addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
                video2.src = URL.createObjectURL(file);
                video2.load();
                updateSyncStatus();
            }
        });

        // 動画読み込み完了の監視
        video1.addEventListener('loadedmetadata', updateSyncStatus);
        video2.addEventListener('loadedmetadata', updateSyncStatus);

        // コントロールボタン
        document.getElementById('playBtn').addEventListener('click', () => {
            if (bothVideosLoaded) {
                video1.play();
                video2.play();
                startProcessing();
            }
        });

        document.getElementById('pauseBtn').addEventListener('click', () => {
            video1.pause();
            video2.pause();
        });

        document.getElementById('resetBtn').addEventListener('click', () => {
            video1.currentTime = 0;
            video2.currentTime = 0;
            clearAdvice();
        });

        document.getElementById('syncBtn').addEventListener('click', () => {
            // より精密な同期調整
            const timeDiff = Math.abs(video1.currentTime - video2.currentTime);
            if (timeDiff > 0.1) {
                const avgTime = (video1.currentTime + video2.currentTime) / 2;
                video1.currentTime = avgTime;
                video2.currentTime = avgTime;
                syncStatus.textContent = `同期調整完了 (差: ${timeDiff.toFixed(2)}秒)`;
            }
        });

        function updateSyncStatus() {
            const video1Ready = video1.readyState >= 2;
            const video2Ready = video2.readyState >= 2;
            
            if (video1Ready && video2Ready) {
                bothVideosLoaded = true;
                syncStatus.textContent = '✅ 両方の動画準備完了 - 再生ボタンを押してください';
                syncStatus.className = 'sync-status status-ready';
            } else if (video1Ready || video2Ready) {
                syncStatus.textContent = '⏳ もう一つの動画をアップロードしてください';
                syncStatus.className = 'sync-status status-waiting';
            } else {
                syncStatus.textContent = '📁 動画をアップロードしてください';
                syncStatus.className = 'sync-status status-waiting';
            }
        }

        function startProcessing() {
            if (isProcessing) return;
            isProcessing = true;

            async function processFrame() {
                if (!isProcessing || (video1.paused && video2.paused) || (video1.ended && video2.ended)) {
                    isProcessing = false;
                    return;
                }

                if (!video1.paused && !video1.ended) {
                    await pose1.send({image: video1});
                }
                if (!video2.paused && !video2.ended) {
                    await pose2.send({image: video2});
                }

                requestAnimationFrame(processFrame);
            }
            processFrame();
        }

        function drawResults(results, ctx, canvas, color = '#00FF00') {
            if (!results.image) return;

            canvas.width = results.image.width;
            canvas.height = results.image.height;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

            if (results.poseLandmarks) {
                drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
                    color: color,
                    lineWidth: 3
                });
                drawLandmarks(ctx, results.poseLandmarks, {
                    color: color,
                    lineWidth: 2,
                    radius: 3
                });
            }
        }

        function showComparisonAdvice(reference, current) {
            // 角度計算関数（改良版）
            function calcAngle(A, B, C) {
                const AB = {x: A.x - B.x, y: A.y - B.y, z: A.z - B.z};
                const CB = {x: C.x - B.x, y: C.y - B.y, z: C.z - B.z};
                
                const dot = AB.x * CB.x + AB.y * CB.y + AB.z * CB.z;
                const magAB = Math.sqrt(AB.x*AB.x + AB.y*AB.y + AB.z*AB.z);
                const magCB = Math.sqrt(CB.x*CB.x + CB.y*CB.y + CB.z*CB.z);
                
                if (magAB === 0 || magCB === 0) return 0;
                
                const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
                return Math.acos(cosTheta) * 180 / Math.PI;
            }

            // 距離計算関数
            function calcDistance(A, B) {
                return Math.sqrt(
                    Math.pow(A.x - B.x, 2) + 
                    Math.pow(A.y - B.y, 2) + 
                    Math.pow(A.z - B.z, 2)
                );
            }

            let advices = [];
            let score = 100; // 100点満点のスコア

            // 右腕の角度比較（肩12, 肘14, 手首16）
            try {
                const refRightAngle = calcAngle(reference[12], reference[14], reference[16]);
                const curRightAngle = calcAngle(current[12], current[14], current[16]);
                const diffRight = Math.abs(curRightAngle - refRightAngle);
                
                if (diffRight > 20) {
                    advices.push(`❌ 右腕の角度が大きく違います (${diffRight.toFixed(1)}度差)`);
                    score -= 15;
                } else if (diffRight > 10) {
                    advices.push(`⚠️ 右腕の角度を少し調整してください (${diffRight.toFixed(1)}度差)`);
                    score -= 5;
                }
            } catch (e) {
                advices.push('⚠️ 右腕の検出が不安定です');
            }

            // 左腕の角度比較（肩11, 肘13, 手首15）
            try {
                const refLeftAngle = calcAngle(reference[11], reference[13], reference[15]);
                const curLeftAngle = calcAngle(current[11], current[13], current[15]);
                const diffLeft = Math.abs(curLeftAngle - refLeftAngle);
                
                if (diffLeft > 20) {
                    advices.push(`❌ 左腕の角度が大きく違います (${diffLeft.toFixed(1)}度差)`);
                    score -= 15;
                } else if (diffLeft > 10) {
                    advices.push(`⚠️ 左腕の角度を少し調整してください (${diffLeft.toFixed(1)}度差)`);
                    score -= 5;
                }
            } catch (e) {
                advices.push('⚠️ 左腕の検出が不安定です');
            }

            // 肩の高さ比較
            const shoulderDiff = Math.abs((current[12].y - current[11].y) - (reference[12].y - reference[11].y));
            if (shoulderDiff > 0.05) {
                advices.push(`⚠️ 肩の高さバランスを確認してください`);
                score -= 10;
            }

            // 頭の位置比較（鼻の位置で判断）
            const headDiff = Math.abs(current[0].y - reference[0].y);
            if (headDiff > 0.08) {
                advices.push(`⚠️ 頭の高さが手本と違います`);
                score -= 5;
            }

            // 全体的な姿勢バランス（重心計算）
            const refCenterY = (reference[11].y + reference[12].y) / 2;
            const curCenterY = (current[11].y + current[12].y) / 2;
            const centerDiff = Math.abs(curCenterY - refCenterY);
            
            if (centerDiff > 0.1) {
                advices.push(`⚠️ 全体的な姿勢バランスを確認してください`);
                score -= 8;
            }

            // スコアに基づいてクラス設定
            let adviceClass = 'advice-area';
            let scoreText = '';
            
            if (score >= 90) {
                adviceClass += ' good-advice';
                scoreText = `🌟 素晴らしい！ (スコア: ${score}/100)`;
            } else if (score >= 70) {
                adviceClass += ' warning-advice';
                scoreText = `👍 良い調子です (スコア: ${score}/100)`;
            } else {
                adviceClass += ' error-advice';
                scoreText = `💪 改善の余地があります (スコア: ${score}/100)`;
            }

            adviceArea.className = adviceClass;

            if (advices.length === 0) {
                adviceArea.textContent = `✨ 完璧です！手本とほぼ同じ動きができています！\n${scoreText}`;
            } else {
                adviceArea.textContent = `${scoreText}\n\n改善点:\n${advices.join('\n')}`;
            }
        }

        function clearAdvice() {
            adviceArea.className = 'advice-area';
            adviceArea.textContent = 'リセットしました。再生ボタンを押して分析を開始してください。';
        }

        // 初期化
        updateSyncStatus();
    </script>
</body>
</html>
