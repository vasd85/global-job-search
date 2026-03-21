import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  addApiKey,
  getCurrentKeyMeta,
  revokeApiKey,
  ApiKeyValidationError,
  ApiKeyDuplicateError,
} from "@/lib/api-keys/api-key-service";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const apiKey = await getCurrentKeyMeta(db, session.user.id, "anthropic");
    return NextResponse.json({ apiKey });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, apiKey } = body as { provider?: string; apiKey?: string };

  if (!provider || !apiKey) {
    return NextResponse.json({ error: "provider and apiKey are required" }, { status: 400 });
  }

  if (provider !== "anthropic") {
    return NextResponse.json({ error: "Only 'anthropic' provider is supported" }, { status: 400 });
  }

  if (typeof apiKey !== "string" || apiKey.length < 10) {
    return NextResponse.json({ error: "Invalid API key format" }, { status: 400 });
  }

  try {
    const result = await addApiKey(db, session.user.id, provider, apiKey);
    return NextResponse.json({
      success: true,
      apiKey: { id: result.id, maskedHint: result.maskedHint, status: result.status },
      validationStatus: result.validationStatus,
    });
  } catch (error) {
    if (error instanceof ApiKeyDuplicateError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ApiKeyValidationError) {
      return NextResponse.json(
        { error: error.message, validation: error.validation },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { keyId } = body as { keyId?: string };
  if (!keyId) {
    return NextResponse.json({ error: "keyId is required" }, { status: 400 });
  }

  try {
    await revokeApiKey(db, session.user.id, keyId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 },
    );
  }
}
