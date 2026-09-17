/**
 * Daily AI Coding Challenge & Interactive Boilerplate Generator.
 *
 * Connects fresh AI industry news with practical 15-45 minute micro-projects
 * for Emman to build and push to GitHub every day.
 */
import { hasGemini } from './config.ts';
import { chatCompletion } from './gemini.ts';

export interface StarterBoilerplate {
  filename: string;
  code: string;
  setupCommand: string;
  runCommand: string;
}

export interface CodingChallenge {
  id: string;
  title: string;
  concept: string;
  estMinutes: number;
  stack: string;
  description: string;
  deliverables: string[];
  boilerplate: StarterBoilerplate;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const FALLBACK_CHALLENGES: CodingChallenge[] = [
  {
    id: 'CC-GEMINI-STREAM',
    title: 'Streaming Real-Time Agent with Gemini Flash',
    concept: 'Token streaming & structured function calling with Gemini Flash',
    estMinutes: 20,
    stack: 'TypeScript / Node.js (v18+)',
    description: 'Build a streaming CLI assistant that streams live tokens to stdout and emits a structured JSON tool call when asked for system metrics.',
    deliverables: [
      'Zero-dependency fetch to generativelanguage.googleapis.com streamGenerateContent',
      'ReadableStream chunk parser',
      'CLI interactive prompt loop',
    ],
    boilerplate: {
      filename: 'streaming-agent.ts',
      setupCommand: 'npm install -D tsx typescript @types/node',
      runCommand: 'npx tsx streaming-agent.ts',
      code: `// streaming-agent.ts — Zero-dependency Gemini stream runner
const apiKey = process.env.GEMINI_API_KEY || '';
const model = 'gemini-3.6-flash';

async function streamPrompt(prompt: string) {
  const url = \`https://generativelanguage.googleapis.com/v1beta/models/\${model}:streamGenerateContent?key=\${apiKey}&alt=sse\`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok || !res.body) throw new Error(\`Stream failed: \${res.status}\`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  process.stdout.write('⚡ Agent: ');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) process.stdout.write(text);
        } catch {}
      }
    }
  }
  console.log('\\n');
}

void streamPrompt('Explain the architectural advantages of agentic loops in 2 concise sentences.');`,
    },
  },
  {
    id: 'CC-MULTIMODAL-VISION',
    title: 'Multimodal Image Inspector & Structured JSON Extractor',
    concept: 'Gemini 3.7 Flash multimodal vision analysis with strict JSON schema response',
    estMinutes: 25,
    stack: 'TypeScript / Supabase',
    description: 'Create an image analysis micro-tool that inspects UI screenshots and extracts layout hierarchy, typography specs, and accessibility issues into valid JSON.',
    deliverables: [
      'Base64 image encoding pipeline',
      'Schema-enforced JSON extraction with Gemini',
      'Pretty-printed markdown summary output',
    ],
    boilerplate: {
      filename: 'ui-inspector.ts',
      setupCommand: 'npm install -D tsx typescript @types/node',
      runCommand: 'npx tsx ui-inspector.ts',
      code: `// ui-inspector.ts — Multimodal UI inspection
async function inspectImage(base64Image: string) {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=\${apiKey}\`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: 'Analyze this UI. Return JSON: {"colorPalette": string[], "accessibilityScore": number, "recommendations": string[]}' },
          { inline_data: { mime_type: 'image/png', data: base64Image } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });

  const data = await res.json() as any;
  console.log(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

console.log('UI Inspector ready! Pass base64 data to inspectImage().');`,
    },
  },
];

export async function generateDailyCodingChallenge(aiNewsTitles: string[] = []): Promise<CodingChallenge> {
  const newsContext = aiNewsTitles.length > 0 ? aiNewsTitles.join(' | ') : 'Gemini 2.5/3.7, Agentic AI, Function Calling, Autonomous Workflows';

  if (hasGemini()) {
    try {
      const prompt = `You are a Principal AI Engineer and coding coach for Emman, a skilled TypeScript/Node.js/Python developer.
Based on today's AI headlines: "${newsContext}".
Design 1 practical, high-leverage 15-30 minute coding micro-project/experiment that Emman can build today to push to his GitHub commit streak.

Requirements:
- Stack: TypeScript / Node.js (or lightweight Python)
- Practical & runnable (e.g. lightweight AI agent, tool-calling script, streaming utility, memory buffer, vector search, or API bridge)
- Include a complete, working starter boilerplate script with zero missing imports.

Format as STRICT JSON (no markdown fences):
{
  "id": "CC-TODAY",
  "title": "Short catchy title",
  "concept": "1-sentence underlying AI concept",
  "estMinutes": 25,
  "stack": "TypeScript / Node.js",
  "description": "2-sentence clear overview of what to build and why it matters.",
  "deliverables": ["Deliverable 1", "Deliverable 2", "Deliverable 3"],
  "boilerplate": {
    "filename": "script.ts",
    "setupCommand": "npm install -D tsx typescript @types/node",
    "runCommand": "npx tsx script.ts",
    "code": "// Complete runnable code here..."
  }
}`;

      const res = await chatCompletion([
        { role: 'system', content: 'You are an elite coding coach. Respond ONLY with valid JSON.' },
        { role: 'user', content: prompt },
      ]);

      const clean = res.replace(/```json/gi, '').replace(/```/gi, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as CodingChallenge;
        if (parsed.title && parsed.boilerplate?.code) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('AI coding challenge generation failed, using curated fallback:', e);
    }
  }

  const index = new Date().getDate() % FALLBACK_CHALLENGES.length;
  return FALLBACK_CHALLENGES[index];
}

export function formatCodingChallengeCard(challenge: CodingChallenge): string {
  const deliverables = challenge.deliverables.map((d) => `  ▫️ ${escapeHtml(d)}`).join('\n');
  return [
    `⚡ <b>Daily AI Coding Micro-Project</b>`,
    `<b>${escapeHtml(challenge.title)}</b>`,
    `<i>${escapeHtml(challenge.concept)}</i>`,
    '',
    `⏱ <b>Time:</b> ~<code>${challenge.estMinutes} mins</code> · 🛠 <b>Stack:</b> <code>${escapeHtml(challenge.stack)}</code>`,
    '',
    `📝 <b>Objective:</b>`,
    `${escapeHtml(challenge.description)}`,
    '',
    `🎯 <b>Key Deliverables:</b>`,
    deliverables,
    '',
    `💡 <i>Tap below to generate starter boilerplate or scaffold to GitHub!</i>`,
  ].join('\n');
}

export function formatBoilerplateCard(challenge: CodingChallenge): string {
  const b = challenge.boilerplate;
  return [
    `🚀 <b>Starter Boilerplate: <code>${escapeHtml(b.filename)}</code></b>`,
    '',
    `📦 <b>Setup:</b>`,
    `<code>${escapeHtml(b.setupCommand)}</code>`,
    '',
    `💻 <b>Source Code:</b>`,
    `<pre><code class="language-typescript">${escapeHtml(b.code)}</code></pre>`,
    '',
    `▶️ <b>Run:</b>`,
    `<code>${escapeHtml(b.runCommand)}</code>`,
    '',
    `<i>Push your solution to GitHub today to extend your contribution streak, sir!</i>`,
  ].join('\n');
}
