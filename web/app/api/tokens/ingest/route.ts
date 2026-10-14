import { NextResponse } from "next/server";
import { invalidateCatalog, loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  invalidateCatalog();
  const catalog = await loadCatalog(true);
  return NextResponse.json({
    ok: true,
    ingested: true,
    launchCount: catalog.launchCount,
    tokenRows: catalog.tokens.length,
    source: catalog.source,
  });
}

export async function GET() {
  return POST();
}
