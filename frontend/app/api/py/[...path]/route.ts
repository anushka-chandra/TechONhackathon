import { NextRequest, NextResponse } from 'next/server'

// Same-origin proxy to the FastAPI backend.
// The browser only ever talks to the Next.js server (this route), which forwards
// the request to FastAPI server-side. This makes the app work from any machine,
// not just one where the backend is reachable at the browser's own localhost.
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000'

async function forward(req: NextRequest, path: string[]) {
  const target = `${BACKEND}/api/${path.join('/')}${req.nextUrl.search}`

  const headers: Record<string, string> = {}
  const contentType = req.headers.get('content-type')
  if (contentType) headers['content-type'] = contentType

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Raw bytes — works for JSON and multipart/form-data (boundary preserved)
    init.body = await req.arrayBuffer()
  }

  try {
    const res = await fetch(target, init)
    const body = await res.arrayBuffer()
    return new NextResponse(body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Backend unreachable at ${BACKEND}`, detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
