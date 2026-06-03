export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: '너는 고등학교 학생부종합전형, 교과세특, 탐구보고서 설계에 특화된 한국어 상담 코치다. AI라는 표현을 쓰지 말고 탐구 분석 엔진처럼 자연스럽고 실천적으로 답한다.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const data = await response.json();
    return res.status(200).json({ result: data.choices?.[0]?.message?.content || '' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
