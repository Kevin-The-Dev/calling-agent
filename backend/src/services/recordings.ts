/**
 * Recording storage.
 *
 * Audio goes to the private `call-recordings` bucket; the `recordings` row is
 * the pointer plus metadata. The bucket is never public — these are recordings
 * of real people saying their address and what they earn — so the dashboard
 * plays them through short-lived signed URLs minted here, not through a URL
 * that would work for anyone who ever saw it.
 */
import type { Env } from '../lib/env.js';
import { databaseError } from '../lib/errors.js';
import { getServiceClient } from './supabase.js';

export const RECORDINGS_BUCKET = 'call-recordings';

/** Storage extensions we are willing to write, keyed by the MIME type sent. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/** Strips codec parameters: "audio/webm;codecs=opus" → "audio/webm". */
export function normalizeMimeType(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(';')[0]?.trim().toLowerCase();
  if (!base || !(base in EXTENSION_BY_MIME)) return null;
  return base;
}

export interface StoreRecordingInput {
  callId: string;
  audio: ArrayBuffer;
  mimeType: string;
  durationSeconds: number | null;
  channels?: 'prospect' | 'agent' | 'mixed';
}

export interface StoredRecording {
  id: string;
  storagePath: string;
  sizeBytes: number;
}

/**
 * Uploads the audio and records where it went.
 *
 * The path is date-partitioned so a retention sweep can delete by prefix rather
 * than walking every object: {yyyy}/{mm}/{call_id}/{channels}.{ext}
 */
export async function storeRecording(
  env: Env,
  input: StoreRecordingInput,
): Promise<StoredRecording> {
  const db = getServiceClient(env);
  const channels = input.channels ?? 'prospect';

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const extension = EXTENSION_BY_MIME[input.mimeType] ?? 'webm';
  const storagePath = `${year}/${month}/${input.callId}/${channels}.${extension}`;

  const { error: uploadError } = await db.storage
    .from(RECORDINGS_BUCKET)
    .upload(storagePath, input.audio, {
      contentType: input.mimeType,
      // A retried upload for the same call replaces rather than duplicates.
      upsert: true,
    });

  if (uploadError) {
    throw databaseError('Could not store the recording', { message: uploadError.message });
  }

  // Upsert on (call_id, channels) so a retry updates the existing row instead
  // of leaving an orphaned 'pending' beside a 'complete'.
  const { data: existing } = await db
    .from('recordings')
    .select('id')
    .eq('call_id', input.callId)
    .eq('channels', channels)
    .maybeSingle();

  const row = {
    call_id: input.callId,
    storage_path: storagePath,
    mime_type: input.mimeType,
    duration_seconds: input.durationSeconds,
    size_bytes: input.audio.byteLength,
    channels,
    upload_status: 'complete' as const,
  };

  const query = existing
    ? db.from('recordings').update(row).eq('id', existing.id as string).select('id').single()
    : db.from('recordings').insert(row).select('id').single();

  const { data, error } = await query;

  if (error || !data) {
    throw databaseError('Could not record where the audio was stored', {
      message: error?.message,
    });
  }

  return {
    id: data.id as string,
    storagePath,
    sizeBytes: input.audio.byteLength,
  };
}

/**
 * Mints a playback URL that expires.
 *
 * Short-lived on purpose: a signed URL is a bearer token for a person's voice,
 * and a long-lived one leaks the moment it lands in a log or a shared link.
 */
export async function signRecordingUrl(
  env: Env,
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data, error } = await getServiceClient(env)
    .storage.from(RECORDINGS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) return null;
  return data.signedUrl;
}
