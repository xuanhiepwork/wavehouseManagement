import { getCatalogBaseUrl } from '../config/catalog.ts';
import { clearAuthSessionIfTokenMatches, currentAccessToken } from '../auth/session.ts';
import type { EvidenceDraft, EvidenceTarget, EvidenceKind } from './evidence.store';

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const kinds: Record<string, EvidenceKind[]> = {
  trip: ['delivery'], stop: ['receiving', 'damage'], count: ['inventory', 'damage'],
};
export interface UploadedEvidence {
  id: string;
  targetType: 'TRIP' | 'STOP' | 'COUNT';
  targetId: string;
  kind: 'DELIVERY' | 'RECEIVING' | 'INVENTORY' | 'DAMAGE';
  note: string | null;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  createdById: string;
  sha256?: string;
  deviceCapturedAt?: string | null;
  locationReadAt?: string | null;
  gpsLatitude?: string | null;
  gpsLongitude?: string | null;
  gpsAccuracyMeters?: string | null;
  locationAddress?: string | null;
}
export interface EvidenceVerification {
  attachmentId: string;
  integrity: 'MATCH' | 'MISMATCH';
  storedSha256: string;
  serverReceivedAt: string;
  deviceReported: null | {
    capturedAt: string;
    locationReadAt: string | null;
    latitude: string | null;
    longitude: string | null;
    accuracyMeters: string | null;
    address: string | null;
  };
  assurance: 'STORED_BYTES_ONLY';
}

function context(target: EvidenceTarget): string {
  if (!kinds[target.type] || !uuidPattern.test(target.id)) throw new Error('Hay mo Camera tu phieu nghiep vu hop le.');
  return `${target.type}/${target.id}`;
}
function base(): string {
  try { return getCatalogBaseUrl(); }
  catch { throw new Error('Chua cau hinh Backend HTTPS.'); }
}
function bearer(): string {
  const token = currentAccessToken();
  if (!token) throw new Error('Phien dang nhap da ket thuc.');
  return token;
}
async function jsonRequest<T>(path: string, method: 'GET' | 'POST', body?: object): Promise<T> {
  const token = bearer();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const url = `${base()}/evidence/${path}`;
    const response = await fetch(url, {
      method, signal: controller.signal, redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) {
      clearAuthSessionIfTokenMatches(token);
      throw new Error('Phien dang nhap khong con hop le.');
    }
    if (!response.ok) {
      if (response.status === 403) throw new Error('Ban khong co quyen luu/xem anh cua phieu nay.');
      if (response.status === 409) throw new Error('Phieu da thay doi, khong the luu them anh. Hay tai lai phieu.');
      if (response.status === 413) throw new Error('Anh qua lon. Gioi han moi anh la 2 MB.');
      throw new Error(response.status >= 500 ? 'Backend minh chung tam thoi khong san sang.' : 'Khong the xu ly anh minh chung.');
    }
    if (response.redirected || (response.url && response.url !== url) ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error('Phan hoi Backend khong hop le.');
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Qua thoi gian ket noi. Vui long thu lai.');
    if (error instanceof Error && error.message.startsWith('Network request failed')) {
      throw new Error('Khong ket noi duoc Backend. Kiem tra Cloudflare Tunnel.');
    }
    throw error;
  } finally { clearTimeout(timeout); }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function parseItem(value: unknown, target: EvidenceTarget): UploadedEvidence {
  if (!isRecord(value) || typeof value.id !== 'string' || !uuidPattern.test(value.id) ||
      value.targetType !== target.type.toUpperCase() || value.targetId !== target.id ||
      typeof value.byteSize !== 'number' || value.byteSize <= 0 || value.byteSize > 2_097_152 ||
      typeof value.mimeType !== 'string' || !['image/jpeg','image/png','image/webp'].includes(value.mimeType) ||
      typeof value.createdAt !== 'string' || typeof value.createdById !== 'string' ||
      !['DELIVERY','RECEIVING','INVENTORY','DAMAGE'].includes(String(value.kind)) ||
      (value.note !== null && typeof value.note !== 'string')) {
    throw new Error('Backend tra ve thong tin anh khong hop le.');
  }
  return value as unknown as UploadedEvidence;
}
export async function listSavedEvidence(target: EvidenceTarget): Promise<UploadedEvidence[]> {
  const data: unknown = await jsonRequest(context(target), 'GET');
  if (!isRecord(data) || !Array.isArray(data.items) || data.items.length > 5) {
    throw new Error('Danh sach minh chung khong hop le.');
  }
  return data.items.map(item => parseItem(item, target));
}
export async function uploadEvidence(target: EvidenceTarget, draft: EvidenceDraft): Promise<UploadedEvidence> {
  const path = context(target);
  if (target.type !== draft.target.type || target.id !== draft.target.id ||
      !kinds[target.type].includes(draft.kind)) throw new Error('Anh khong thuoc phieu hien tai.');
  if (!draft.base64 || !draft.mimeType || !['image/jpeg','image/png','image/webp'].includes(draft.mimeType)) {
    throw new Error('Anh chua co du lieu tai len. Hay chup/chon lai anh.');
  }
  if (draft.base64.length > 2_800_000) throw new Error('Anh lon hon 2 MB. Vui long chon anh nho hon.');
  const payload: unknown = await jsonRequest(path, 'POST', {
    kind: draft.kind, note: draft.note, mimeType: draft.mimeType, dataBase64: draft.base64,
    ...(draft.captureFacts ? {capture: draft.captureFacts} : {}),
  });
  if (!isRecord(payload)) throw new Error('Backend khong xac nhan luu anh.');
  return parseItem(payload.data, target);
}
/** Private authenticated check of bytes stored by the server; not a proof of capture location. */
export async function verifySavedEvidence(target: EvidenceTarget, attachmentId: string): Promise<EvidenceVerification> {
  if (!uuidPattern.test(attachmentId)) throw new Error('Ma anh khong hop le.');
  const response: unknown = await jsonRequest(`${context(target)}/${attachmentId}/verify`, 'GET');
  const value = isRecord(response) ? response.data : null;
  if (!isRecord(value) || value.attachmentId !== attachmentId ||
      !['MATCH','MISMATCH'].includes(String(value.integrity)) ||
      value.assurance !== 'STORED_BYTES_ONLY' ||
      typeof value.storedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.storedSha256) ||
      typeof value.serverReceivedAt !== 'string' ||
      (value.deviceReported !== null && !isRecord(value.deviceReported))) {
    throw new Error('Phan hoi xac minh khong hop le.');
  }
  return value as unknown as EvidenceVerification;
}
export function savedImageSource(target: EvidenceTarget, image: UploadedEvidence):
  {uri:string;headers:{Authorization:string}} | null {
  const token = currentAccessToken();
  if (!token) return null;
  return { uri: `${base()}/evidence/${context(target)}/${image.id}/image`,
    headers: { Authorization: `Bearer ${token}` } };
}
