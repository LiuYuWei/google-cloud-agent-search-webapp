import { NextRequest, NextResponse } from "next/server";
import { answer } from "@/lib/discoveryEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequestBody = {
  query?: string;
  sessionName?: string;
  userPseudoId?: string;
};

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const userPseudoId = body.userPseudoId?.trim() || crypto.randomUUID();

  try {
    const result = await answer({
      query,
      sessionName: body.sessionName,
      userPseudoId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/chat] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "answer_failed", detail: message },
      { status: 500 },
    );
  }
}
