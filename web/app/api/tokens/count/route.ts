import { NextResponse } from "next/server";
import { peekLaunchCount } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const launchCount = await peekLaunchCount();
  return NextResponse.json(
    { launchCount, ts: Date.now() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
