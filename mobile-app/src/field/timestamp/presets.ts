import { type StampStyle } from './stamp.model';

export type StampPresetId = 'delivery' | 'inventory' | 'site';

interface StampPreset {
  readonly id: StampPresetId;
  readonly title: string;
  readonly description: string;
  readonly style: StampStyle;
}

/** Visual layouts only. Never replace or fabricate capture time, GPS or business context. */
export const STAMP_PRESETS: readonly StampPreset[] = Object.freeze([
  {
    id: 'delivery', title: 'Giao nhận', description: 'Logo, người giao và tọa độ rõ ràng',
    style: Object.freeze({
      logo: true, employee: true, coordinates: true, note: true,
      size: 'medium', background: 'burgundy', position: 'bottom',
    } as const),
  },
  {
    id: 'inventory', title: 'Kiểm kê', description: 'Chữ gọn để còn nhiều diện tích ảnh',
    style: Object.freeze({
      logo: true, employee: true, coordinates: true, note: true,
      size: 'small', background: 'dark', position: 'bottom',
    } as const),
  },
  {
    id: 'site', title: 'Hiện trường', description: 'Dấu nổi phía trên, dễ thấy trên ảnh',
    style: Object.freeze({
      logo: true, employee: false, coordinates: true, note: false,
      size: 'large', background: 'cream', position: 'top',
    } as const),
  },
]);

export function isStampPresetId(value: unknown): value is StampPresetId {
  return value === 'delivery' || value === 'inventory' || value === 'site';
}
