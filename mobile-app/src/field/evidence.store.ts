/** Session-scoped, on-device evidence previews. Not uploaded or linked on the server. */
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';

export type EvidenceKind = 'delivery' | 'receiving' | 'inventory' | 'damage';
export type EvidenceTargetType = 'trip' | 'stop' | 'count' | 'general';
export interface EvidenceTarget { type: EvidenceTargetType; id: string }
export interface EvidenceDraft {
  readonly id: string;
  readonly uri: string;
  readonly base64?: string;
  readonly mimeType?: string;
  readonly kind: EvidenceKind;
  readonly note: string;
  readonly createdAt: string;
  readonly target: EvidenceTarget;
}
interface EvidenceSnapshot { readonly version: number; readonly items: readonly EvidenceDraft[] }
export const MAX_PER_TARGET = 5;
export const MAX_TOTAL_DRAFTS = 20;
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
let ownerGeneration = getAuthSnapshot().generation;
let sequence = 0;
let snapshot: EvidenceSnapshot = Object.freeze({version: 0, items: Object.freeze([] as EvidenceDraft[])});
const listeners = new Set<() => void>();
function publish(items: readonly EvidenceDraft[]) {
  snapshot = Object.freeze({version: snapshot.version + 1, items: Object.freeze([...items])});
  listeners.forEach(listener => listener());
}
function resetOnSessionChange() {
  const next = getAuthSnapshot().generation;
  if (next !== ownerGeneration) {
    ownerGeneration = next;
    sequence = 0;
    publish([]);
  }
}
// All previews are forgotten when the auth session changes, including sign-out or token replacement.
subscribeAuth(resetOnSessionChange);
export function subscribeEvidence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
export function getEvidenceSnapshot(): EvidenceSnapshot { return snapshot; }
export function parseEvidenceTarget(type: unknown, id: unknown): EvidenceTarget {
  if (type === 'trip' || type === 'stop' || type === 'count') {
    if (typeof id === 'string' && uuidPattern.test(id)) return {type, id: id.toLowerCase()};
  }
  return {type: 'general', id: 'general'};
}
export function evidenceFor(target: EvidenceTarget, source = snapshot): readonly EvidenceDraft[] {
  return source.items.filter(item => item.target.type === target.type && item.target.id === target.id);
}
export function addEvidence(input: {uri:string; kind:EvidenceKind; note?:string; target:EvidenceTarget; base64?:string; mimeType?:string}): EvidenceDraft {
  resetOnSessionChange();
  if (!getAuthSnapshot().user) throw new Error('Phiên đăng nhập không còn hợp lệ.');
  if (!/^(file|content):\/\//.test(input.uri)) throw new Error('Ảnh không có đường dẫn thiết bị hợp lệ.');
  if (evidenceFor(input.target).length >= MAX_PER_TARGET) throw new Error('Đã đạt giới hạn 5 ảnh cho mục này.');
  if (snapshot.items.length >= MAX_TOTAL_DRAFTS) throw new Error('Đã đạt giới hạn 20 ảnh nháp trong phiên làm việc.');
  const draft: EvidenceDraft = Object.freeze({
    id: `local-${ownerGeneration}-${++sequence}`,
    uri: input.uri,
    base64: input.base64,
    mimeType: input.mimeType,
    kind: input.kind,
    note: (input.note??'').slice(0,500),
    createdAt: new Date().toISOString(),
    target: {...input.target},
  });
  publish([...snapshot.items, draft]);
  return draft;
}
export function updateEvidenceNote(id:string, note:string):void {
  if (!snapshot.items.some(item => item.id === id)) return;
  publish(snapshot.items.map(item => item.id === id ? Object.freeze({...item, note: note.slice(0,500)}) : item));
}
export function removeEvidence(id:string):void {
  if (snapshot.items.some(item => item.id === id)) publish(snapshot.items.filter(item => item.id !== id));
}
export function clearEvidenceTarget(target:EvidenceTarget):void {
  const keep = snapshot.items.filter(item => item.target.type !== target.type || item.target.id !== target.id);
  if (keep.length !== snapshot.items.length) publish(keep);
}
