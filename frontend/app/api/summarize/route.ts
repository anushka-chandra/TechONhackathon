import { NextRequest, NextResponse } from 'next/server'

// Simple client-side-safe smart truncation as fallback
function smartTruncate(text: string): string {
  // Strip filler words to surface the meaningful ones
  const fillers = new Set([
    'a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','need','dare','ought',
    'used','for','with','to','of','in','on','at','by','from',
    'and','or','but','so','yet','nor','as','if','then','that',
    'this','these','those','it','its','we','our','i','my',
  ])
  const words = text.split(/\s+/).filter(w => !fillers.has(w.toLowerCase()))
  const key = words.slice(0, 6).join(' ')
  return key.length > 3 ? key : text.split(/\s+/).slice(0, 6).join(' ')
}

export async function POST(req: NextRequest) {
  const { text } = await req.json()

  if (!text?.trim()) {
    return NextResponse.json({ summary: 'Untitled session', method: 'empty' })
  }

  // Try the FastAPI + HuggingFace backend first (server-to-server — no CORS)
  try {
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000'
    const res = await fetch(`${backendUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),   // 8s timeout
    })
    if (res.ok) {
      const data = await res.json()
      return NextResponse.json(data)
    }
  } catch {
    // backend unreachable — fall through to local summarization
  }

  // Local fallback: intelligent word extraction
  return NextResponse.json({
    summary: smartTruncate(text),
    method: 'local_fallback',
  })
}
