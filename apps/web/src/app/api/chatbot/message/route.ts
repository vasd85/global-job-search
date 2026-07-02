import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ error: "chatbot endpoints retired" }, { status: 501 });
}

export function POST() {
  return NextResponse.json({ error: "chatbot endpoints retired" }, { status: 501 });
}
