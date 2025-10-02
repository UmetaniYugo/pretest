import { getAdviceFromGemini } from './aiAdvice.js';

// 比較・アドバイス生成処理（例：動画再生終了時やボタン押下時に呼び出す）
async function processComparison(referencePose, targetPose) {
  const adviceArea = document.getElementById("adviceArea");
  adviceArea.innerText = "AIによるアドバイス生成中...";
  const advice = await getAdviceFromGemini(referencePose, targetPose);
  adviceArea.innerText = advice;
}

// 例: 比較ボタンなどのイベントハンドラで呼び出す
// document.getElementById("compareBtn").onclick = () => {
//   processComparison(referencePose, targetPose);
// };
