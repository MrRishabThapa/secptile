import { NextResponse } from "next/server";
import { linkedinStatus } from "@/lib/linkedin/linkedin";

export async function GET() {
  return NextResponse.json(await linkedinStatus());
}
