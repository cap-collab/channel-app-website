import { NextRequest, NextResponse } from 'next/server';
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from 'livekit-server-sdk';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { ROOM_NAME } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

// Admin "start room recording now" — a manual SAFETY-NET capture. If an admin sees
// a live show going wrong (e.g. the primary track-composite recording looks dead),
// they click this and we start a ROOM-COMPOSITE egress recording the whole room to
// a separate, safe R2 path (recordings-manual/). Room-composite captures the mixed
// room audio — it needs no track SID, so it CANNOT bind to the wrong DJ; it records
// whatever is audible. It is completely independent of the DJ broadcast flow, the
// primary recording, HLS, and the transition sweep — its own egress, own path,
// started + stopped only by its own id here. It captures from the click forward
// (it cannot recover audio from before it was started).
//
// This is a guaranteed insurance file; nothing else consumes it. If the primary
// recording turns out dead, the manual file is in R2 to swap into the archive.

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || 'channel-broadcast';
const r2Endpoint = r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '';
const r2PublicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

async function requireAdmin(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token && token === process.env.CRON_SECRET) return true;
  if (!token) return false;
  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) return false;
  try {
    const decoded = await auth.verifyIdToken(token);
    const role = (await db.collection('users').doc(decoded.uid).get()).data()?.role;
    return role === 'admin' || role === 'broadcaster';
  } catch {
    return false;
  }
}

// POST { action: 'start' | 'stop', egressId?, room? }
export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!livekitHost || !apiKey || !apiSecret) {
    return NextResponse.json({ error: 'LiveKit not configured' }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const action = body.action as string | undefined;
  const room = (body.room as string | undefined) || ROOM_NAME;
  const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

  if (action === 'stop') {
    const egressId = body.egressId as string | undefined;
    if (!egressId) return NextResponse.json({ error: 'egressId required to stop' }, { status: 400 });
    try {
      await egressClient.stopEgress(egressId);
      return NextResponse.json({ ok: true, stopped: egressId });
    } catch (e) {
      return NextResponse.json({ error: `stop failed: ${(e as Error).message}` }, { status: 500 });
    }
  }

  // default: start
  if (!r2AccessKey || !r2SecretKey) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 });
  }
  try {
    const s3Upload = new S3Upload({
      accessKey: r2AccessKey,
      secret: r2SecretKey,
      bucket: r2Bucket,
      region: 'auto',
      endpoint: r2Endpoint,
      forcePathStyle: true,
    });
    // Distinct, safe path — never collides with the primary recordings/ path and
    // is never consumed by webhook/faststart/normalize/archive logic.
    const mp4Output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `recordings-manual/${room}-{time}.mp4`,
      output: { case: 's3', value: s3Upload },
    });
    // Room-composite: whole-room mix, no track SID → cannot bind wrong.
    const egress = await egressClient.startRoomCompositeEgress(
      room,
      { file: mp4Output },
      { audioOnly: true },
    );
    console.log(`🎙️ MANUAL room recording started: egress ${egress.egressId} → recordings-manual/${room}-*.mp4`);
    return NextResponse.json({
      ok: true,
      egressId: egress.egressId,
      room,
      note: 'Room-composite backup recording started (captures from now forward). Stop it with { action: "stop", egressId }.',
      // Best-effort predicted URL (final {time} is server-filled; the webhook/logs carry the real one).
      pathPrefix: `${r2PublicUrl}/recordings-manual/`,
    });
  } catch (e) {
    console.error('[manual-recording] start failed:', e);
    return NextResponse.json({ error: `start failed: ${(e as Error).message}` }, { status: 500 });
  }
}

// GET — list active manual recordings so the admin UI can show a Stop button.
export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!livekitHost || !apiKey || !apiSecret) {
    return NextResponse.json({ error: 'LiveKit not configured' }, { status: 500 });
  }
  try {
    const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
    const list = await egressClient.listEgress({ roomName: ROOM_NAME, active: true });
    // Identify the manual ones by their file output path prefix.
    const manual = list
      .filter((e) => {
        const v = (e.request?.value ?? {}) as { fileOutputs?: { filepath?: string }[] };
        return v.fileOutputs?.some((f) => f.filepath?.startsWith('recordings-manual/'));
      })
      .map((e) => ({ egressId: e.egressId, status: e.status }));
    return NextResponse.json({ active: manual });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
