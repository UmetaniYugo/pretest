// aiAdvice.js
// Gemini API（Google Generative Language）を使ってフォームアドバイスを生成する関数
import { GEMINI_API_KEY } from './apiKey.js';

export async function getAdviceFromGemini(referencePose, targetPose) {
  // 比較するランドマークデータの差分を計算
  const diffs = [];
  for (let i = 0; i < referencePose.length; i++) {
    if (!referencePose[i] || !targetPose[i]) continue;
    diffs.push({
      id: i,
      ref_x: referencePose[i].x,
      ref_y: referencePose[i].y,
      tar_x: targetPose[i].x,
      tar_y: targetPose[i].y,
      dx: targetPose[i].x - referencePose[i].x,
      dy: targetPose[i].y - referencePose[i].y
    });
  }

  // Gemini API用プロンプト文（日本語で依頼）
  const prompt = `
    以下はお手本動作と比較対象の動作の骨格ランドマークの座標差分データです。
    このデータをもとに、フォーム改善のためのアドバイスを日本語で1～2文で出してください。
    データ: ${JSON.stringify(diffs)}
  `;

  // Gemini API呼び出し
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        contents: [{role: "user", parts: [{text: prompt}]}]
      })
    });
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }
    const result = await response.json();
    // 返ってきたアドバイス文（API仕様によりパース方法が変わる場合あり）
    const advice = result?.candidates?.[0]?.content?.parts?.[0]?.text || "アドバイス生成に失敗しました";
    return advice;
  } catch (err) {
    return `AIアドバイス生成エラー: ${err.message}`;
  }
}
