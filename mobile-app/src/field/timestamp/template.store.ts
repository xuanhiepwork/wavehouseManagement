import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_STAMP, type StampStyle } from './stamp.model';
import { isStampPresetId, type StampPresetId } from './presets';

/** Device-local preferences, deliberately excluding account token, photo, GPS and employee name. */
export interface CameraTemplate {
  readonly config: StampStyle;
  readonly logoDataUri: string | null;
  readonly presetId: StampPresetId | null;
}

const STORAGE_PREFIX = '@doclap/camera-template/v1/';
/** Avoid large data: URIs in storage; user-selected logo is resized to a small PNG first. */
export const MAX_LOGO_DATA_URI_CHARS = 250_000;
const USER_ID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

function storageKey(userId: string): string {
  if (!USER_ID_RE.test(userId)) throw new Error('Không có tài khoản hợp lệ để lưu mẫu.');
  return `${STORAGE_PREFIX}${userId.toLowerCase()}`;
}

function validStyle(value: unknown): value is StampStyle {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.logo === 'boolean' && typeof v.employee === 'boolean' &&
    typeof v.coordinates === 'boolean' && typeof v.note === 'boolean' &&
    (v.size === 'small' || v.size === 'medium' || v.size === 'large') &&
    (v.background === 'dark' || v.background === 'burgundy' || v.background === 'cream') &&
    (v.position === 'top' || v.position === 'bottom');
}

export async function loadCameraTemplate(userId: string): Promise<CameraTemplate | null> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw || raw.length > 280_000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const v = parsed as Record<string, unknown>;
  if (v.version !== 1 || !validStyle(v.config)) return null;
  const logo = v.logoDataUri;
  const validLogo = logo === null || (typeof logo === 'string' && logo.length <= MAX_LOGO_DATA_URI_CHARS && PNG_RE.test(logo));
  if (!validLogo) return null;
  if (v.presetId !== null && !isStampPresetId(v.presetId)) return null;
  return { config: { ...v.config }, logoDataUri: logo as string | null, presetId: v.presetId as StampPresetId | null };
}

export async function saveCameraTemplate(userId: string, template: CameraTemplate): Promise<void> {
  if (!validStyle(template.config)) throw new Error('Mẫu đóng dấu không hợp lệ.');
  if (template.logoDataUri && (template.logoDataUri.length > MAX_LOGO_DATA_URI_CHARS || !PNG_RE.test(template.logoDataUri))) {
    throw new Error('Logo quá lớn hoặc không đúng định dạng PNG.');
  }
  if (template.presetId !== null && !isStampPresetId(template.presetId)) {
    throw new Error('Mẫu được chọn không hợp lệ.');
  }
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify({
    version: 1, config: template.config, logoDataUri: template.logoDataUri, presetId: template.presetId,
  }));
}

export async function deleteCameraTemplate(userId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(userId));
}

export function newDefaultCameraTemplate(): CameraTemplate {
  return { config: { ...DEFAULT_STAMP }, logoDataUri: null, presetId: null };
}
