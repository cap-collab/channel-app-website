import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/metadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const shows = await getAllShows();
    return NextResponse.json({ shows });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
