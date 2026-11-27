import * as Location from 'expo-location';
import { hasFreshLocation, type CaptureFacts } from './stamp.model';

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  readAt: number;
  address: string | null;
}

function timeoutAfter<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Không lấy được GPS trong thời gian cho phép.')), ms);
    promise.then(value => {clearTimeout(timer);resolve(value);},
      error => {clearTimeout(timer);reject(error);});
  });
}

/** Explicit foreground-only fetch. Never watch, track in background or auto-collect. */
export async function requestOneLocation(): Promise<LocationFix> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Chưa cấp quyền vị trí. Ảnh sẽ không có GPS nếu bạn tiếp tục.');
  const position = await timeoutAfter(Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}),12000);
  const {latitude,longitude,accuracy} = position.coords;
  if (!Number.isFinite(latitude)||!Number.isFinite(longitude)) throw new Error('Tọa độ GPS không hợp lệ.');
  let address: string | null = null;
  try {
    const addresses = await timeoutAfter(Location.reverseGeocodeAsync({latitude,longitude}),7000);
    const a = addresses[0];
    if(a) address = [a.streetNumber,a.street,a.district,a.city,a.region,a.country]
      .filter(part=>typeof part==='string'&&part.trim().length).join(', ') || null;
  } catch { /* Exact coordinates remain; never fabricate an address. */ }
  return {latitude,longitude,accuracyMeters: typeof accuracy==='number'&&Number.isFinite(accuracy) ? accuracy : null,
    readAt:position.timestamp,address};
}

export function lockCaptureFacts(shutterAt:number, fix:LocationFix|null):CaptureFacts {
  if (!fix || !hasFreshLocation(fix.readAt,shutterAt)) {
    return Object.freeze({capturedAt:new Date(shutterAt).toISOString(),latitude:null,longitude:null,
      accuracyMeters:null,locationReadAt:null,address:null});
  }
  return Object.freeze({capturedAt:new Date(shutterAt).toISOString(),
    latitude:fix.latitude,longitude:fix.longitude,accuracyMeters:fix.accuracyMeters,
    locationReadAt:new Date(fix.readAt).toISOString(),address:fix.address});
}
