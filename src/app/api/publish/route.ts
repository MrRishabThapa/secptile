import { NextResponse } from "next/server";
import { PublishError, publishInputSchema, publishPost } from "@/lib/blog/blog";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = publishInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid publish payload." },
      { status: 400 },
    );
  }

  try {
    const result = await publishPost(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PublishError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/publish] unexpected error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while saving the post." },
      { status: 500 },
    );
  }
}
