// aiAdvice.js
// AIアドバイス生成モジュール（DOM操作・イベントは含まない）
// export: getAdviceFromGemini(referencePose, targetPose)

async function loadApiKeyModule() {
  // 候補ファイル名を順に試す（大文字小文字の差に対応）
  const candidates = ['./apiKey.js', './apiKEY.js', './ApiKey.js'];
  for (const path of candidates) {
    try {
      const m = await import(path);
      if (m && m.GEMINI_API_KEY) return m.GEMINI_API_KEY;
    } catch (e) {
      // 読み込み失敗は無視して次へ
    }
  }
  return null;
}

export async function getAdviceFromGemini(referencePose, targetPose) {
  const GEMINI_API_KEY = await loadApiKeyModule();
  if (!GEMINI_API_KEY) {
    throw new Error('APIキーが見つかりません。リポジトリに apiKey.js（GEMINI_API_KEY を export）を配置するか、サーバ側で秘匿化してください。');
  }

  // ランドマーク差分の簡易集計
  const diffs = [];
  const len = Math.max(referencePose?.length || 0, targetPose?.length || 0);
  for (let i = 0; i < len; i++) {
    const r = referencePose?.[i] || null;
    const t = targetPose?.[i] || null;
    if (!r || !t) continue;
    diffs.push({ id: i, dx: Number((t.x - r.x).toFixed(4)), dy: Number((t.y - r.y).toFixed(4)) });
  }

  const prompt = `
以下はお手本動作と比較対象の動作の骨格ランドマークの座標差分データです。
このデータをもとに、フォーム改善のための簡潔なアドバイスを日本語で1〜2文で出してください。
データ: ${JSON.stringify(diffs)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  };

  try {
    const maxRetries = 3;
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.status === 429) {
          throw new Error('Too Many Requests');
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Gemini API エラー: ${res.status} ${res.statusText} ${text}`);
        }

        const data = await res.json();
        // APIレスポンスの形によってはここを調整
        const advice = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return advice || 'アドバイスが取得できませんでした。';

      } catch (err) {
        attempt++;
        const isRetryable = err.message.includes('Too Many Requests') || err.message.includes('503');

        if (attempt <= maxRetries && isRetryable) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
          console.warn(`Gemini API リトライ待機中 (${attempt}/${maxRetries}): ${delay}ms...`);
          // 呼び出し元に進捗を通知できないため、ここでは待機のみ
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // リトライ上限またはリトライ不可エラー
        if (err.message.includes('Too Many Requests')) {
          throw new Error('現在アクセスが集中しておりアドバイスを生成できませんでした。しばらく時間を置いてから再度お試しください。');
        }
        throw err;
      }
    }
  } catch (err) {
    throw new Error(`AIアドバイス生成中にエラーが発生しました: ${err.message}`);
  }
}
