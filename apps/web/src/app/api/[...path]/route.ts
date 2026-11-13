import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const backendBase = process.env.QNETWARD_BACKEND_URL ?? process.env.NETWATCHER_BACKEND_URL ?? "http://127.0.0.1:8080";

async function forward(request: NextRequest, path: string[]) {
  const target = new URL(`/api/${path.join("/")}`, backendBase);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  // The backend checks Origin itself only on direct calls; through this proxy
  // it learns the browser's origin from this header, to send people back to
  // the same site after a payment. It's matched against the allowed origins.
  const origin = request.headers.get("origin");
  headers.delete("host");
  headers.delete("origin");
  headers.delete("x-qnetward-origin");
  if (origin) headers.set("x-qnetward-origin", origin);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
    // When the browser goes away, so does the backend request. This matters for
    // the live event stream, which would otherwise hold a slot until its next
    // heartbeat.
    signal: request.signal,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(target, init);
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}
