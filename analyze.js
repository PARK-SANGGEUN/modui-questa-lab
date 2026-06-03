export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { prompt, system } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
  try {
    const sysInstruction = system || '너는 고등학교 학생부종합전형, 교과세특, 탐구보고서 설계에 특화된 한국어 상담 코치다. 대학별 학생부종합전형 평가 기준을 정확히 이해하고, 학생의 진로와 학년에 맞는 탐구를 설계한다. 자연스럽고 실천적으로 답하며, 과도한 AI 표현은 쓰지 않는다.';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: sysInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4096 }
        })
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
