/** Phase D.3: a photo's capture facts are immutable after shutter. */
export interface CaptureFacts {
  readonly capturedAt: string; // UTC ISO sampled at shutter
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyMeters: number | null;
  readonly locationReadAt: string | null;
  readonly address: string | null;
}

export interface StampStyle {
  readonly logo: boolean;
  readonly employee: boolean;
  readonly coordinates: boolean;
  readonly note: boolean;
  readonly size: 'small' | 'medium' | 'large';
  readonly background: 'burgundy' | 'dark' | 'cream';
  readonly position: 'top' | 'bottom';
}
export const DEFAULT_STAMP: StampStyle = Object.freeze({
  logo: true, employee: false, coordinates: false, note: true,
  size: 'medium', background: 'dark', position: 'bottom',
});

export function formatCaptureTime(iso: string): {time:string;date:string} {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return {time:'--:--:--',date:'Không xác định'};
  const format = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('vi-VN', {...opts,timeZone:'Asia/Ho_Chi_Minh'}).format(date);
  return {time:format({hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}),
    date:format({day:'2-digit',month:'2-digit',year:'numeric'})};
}
export function coordinatesLabel(facts: CaptureFacts): string {
  if (facts.latitude === null || facts.longitude === null) return 'Không có tọa độ GPS';
  return `${facts.latitude.toFixed(5)}, ${facts.longitude.toFixed(5)}`;
}
export function locationLabel(facts: CaptureFacts): string {
  if (facts.latitude === null || facts.longitude === null) return 'CHƯA XÁC ĐỊNH VỊ TRÍ';
  return facts.address?.trim() || `GPS ${coordinatesLabel(facts)}`;
}
export function hasFreshLocation(timestamp: number, now: number): boolean {
  return Number.isFinite(timestamp) && timestamp <= now + 5000 && now - timestamp <= 30000;
}
