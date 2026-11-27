import { getCatalogBaseUrl } from '../config/catalog.ts';
import { clearAuthSessionIfTokenMatches, currentAccessToken } from '../auth/session.ts';
import type { Availability, DeliveryTrip, NamedPlace, OperationsSummary, SalesInput, SalesReport,
  StockBalance, StockCountSummary, WorkAssignment, WorkContext, WorkShift } from './field.types.ts';

export type ApiFailure = 'CONFIGURATION' | 'SESSION' | 'FORBIDDEN' | 'CONFLICT' | 'INVALID' | 'NOT_FOUND'
  | 'NETWORK' | 'TIMEOUT' | 'SERVER' | 'MALFORMED';
export class FieldApiError extends Error {
  constructor(readonly code: ApiFailure, readonly uncertainWrite = false) {
    super(uncertainWrite ? 'Không rõ máy chủ đã nhận thao tác hay chưa. Hãy tải lại trạng thái trước khi tiếp tục.' : ({
      CONFIGURATION: 'Chưa cấu hình địa chỉ API bảo mật.', SESSION: 'Phiên làm việc hết hạn. Vui lòng đăng nhập lại.',
      FORBIDDEN: 'Bạn không được phân quyền thực hiện thao tác này.',
      CONFLICT: 'Dữ liệu đã thay đổi. Hãy tải lại trước khi tiếp tục.',
      INVALID: 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra thông tin.',
      NOT_FOUND: 'Không tìm thấy dữ liệu hoặc dữ liệu không thuộc phạm vi của bạn.',
      NETWORK: 'Không thể kết nối. Kiểm tra mạng, dữ liệu chưa được gửi lại.',
      TIMEOUT: 'Kết nối quá lâu. Hãy kiểm tra mạng rồi tải lại.',
      SERVER: 'Hệ thống tạm thời không khả dụng.', MALFORMED: 'Máy chủ trả về dữ liệu không hợp lệ.',
    } satisfies Record<ApiFailure,string>)[code]);
    this.name = 'FieldApiError';
  }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function isItems(value: unknown): value is {items: unknown[]; total?: unknown} { return object(value) && Array.isArray(value.items); }
function isData(value: unknown): value is {data: unknown} { return object(value) && 'data' in value; }
const qs = (input: Readonly<Record<string, string | number | undefined>>) => {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(input)) if (value !== undefined) params.set(key,String(value));
  return params.toString() ? `?${params}` : '';
};
const validSegment = (value: string): string => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new FieldApiError('INVALID');
  return encodeURIComponent(value);
};

/** All operations are explicit, once-only requests. Especially NEVER retry a POST/PATCH automatically. */
async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let base: string;
  try { base = getCatalogBaseUrl(); } catch { throw new FieldApiError('CONFIGURATION'); }
  const token = currentAccessToken();
  if (!token) throw new FieldApiError('SESSION');
  if (signal?.aborted) throw new FieldApiError('NETWORK');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const target = `${base}${path}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_,reject)=>{
    timer = setTimeout(()=>{
      timedOut = true; controller.abort();
      reject(new FieldApiError('TIMEOUT', method !== 'GET' && !signal?.aborted));
    },12_000);
  });
  const work = async ():Promise<T>=>{
    let response:Response;
    try {
      response = await fetch(target, {
        method, redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new FieldApiError(timedOut ? 'TIMEOUT' : 'NETWORK', method !== 'GET' && !signal?.aborted);
    }
    if (controller.signal.aborted) throw new FieldApiError(timedOut?'TIMEOUT':'NETWORK',method!=='GET'&&!signal?.aborted);
    if (response.status === 401) { clearAuthSessionIfTokenMatches(token); throw new FieldApiError('SESSION'); }
    if (!response.ok) throw new FieldApiError(response.status === 403 ? 'FORBIDDEN'
      : response.status === 404 ? 'NOT_FOUND' : response.status === 409 ? 'CONFLICT'
        : response.status === 400 || response.status === 422 ? 'INVALID' : 'SERVER');
    if (response.status === 204) return undefined as T;
    try {
      if (response.redirected || (response.url && response.url !== target)
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error();
      const result=await response.json() as T;
      if(controller.signal.aborted)throw new Error();
      return result;
    } catch { throw new FieldApiError('MALFORMED', method !== 'GET'); }
  };
  try {return await Promise.race([work(),deadline]);}
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',onAbort);
  }
}

function items<T>(value: unknown): T[] { if (!isItems(value)) throw new FieldApiError('MALFORMED'); return value.items as T[]; }
function data<T>(value: unknown): T { if (!isData(value)) throw new FieldApiError('MALFORMED'); return value.data as T; }
export const fieldApi = {
  workContext: async (date: string, signal?: AbortSignal): Promise<WorkContext> => {
    const result = await call<unknown>(`/sales-reports/work-context${qs({businessDate:date})}`, 'GET', undefined, signal);
    if (!object(result) || !Array.isArray(result.branches) || !Array.isArray(result.assignments)) throw new FieldApiError('MALFORMED');
    return result as unknown as WorkContext;
  },
  assignments: async (from: string, to: string, areaId?: string, signal?: AbortSignal) =>
    items<WorkAssignment>(await call<unknown>(`/scheduling/assignments${qs({from,to,areaId})}`, 'GET', undefined, signal)),
  availability: async (from: string, to: string, signal?: AbortSignal, areaId?:string) =>
    items<Availability>(await call<unknown>(`/scheduling/availability${qs({from,to,areaId})}`, 'GET', undefined, signal)),
  setAvailability: async (businessDate: string, shift: WorkShift, available: boolean) =>
    data<Availability>(await call<unknown>('/scheduling/availability','POST',{businessDate,shift,available})),
  branches: async (businessDate: string, shift?: WorkShift, signal?: AbortSignal) =>
    items<NamedPlace>(await call<unknown>(`/operational-branches${qs({businessDate,shift})}`,'GET',undefined,signal)),
  trips: async (date: string, signal?: AbortSignal) =>
    items<DeliveryTrip>(await call<unknown>(`/distribution/trips${qs({date})}`,'GET',undefined,signal)),
  trip: async (id: string, signal?: AbortSignal) =>
    data<DeliveryTrip>(await call<unknown>(`/distribution/trips/${validSegment(id)}`,'GET',undefined,signal)),
  dispatch: async (id: string) =>
    data<DeliveryTrip>(await call<unknown>(`/distribution/trips/${validSegment(id)}/dispatch`,'POST')),
  receive: async (stopId: string, itemsIn: {ingredientId:string;receivedQuantity:string;damagedQuantity:string}[], note: string|null) =>
    data<{id:string;status:string}>(await call<unknown>(`/distribution/stops/${validSegment(stopId)}/receive`,'POST',{items:itemsIn,note})),
  salesReports: async (date: string, page = 1, signal?: AbortSignal) => {
    const raw = await call<unknown>(`/sales-reports${qs({from:date,to:date,page})}`,'GET',undefined,signal);
    if (!isItems(raw) || typeof raw.total !== 'number') throw new FieldApiError('MALFORMED');
    return {items: raw.items as SalesReport[], total:raw.total, page};
  },
  salesReport: async (id: string, signal?: AbortSignal) =>
    data<SalesReport>(await call<unknown>(`/sales-reports/${validSegment(id)}`,'GET',undefined,signal)),
  createSales: async (payload: SalesInput) => data<SalesReport>(await call<unknown>('/sales-reports','POST',payload)),
  updateSales: async (id: string, payload: SalesInput, expectedVersion: number) =>
    data<SalesReport>(await call<unknown>(`/sales-reports/${validSegment(id)}`,'PATCH',{...payload,expectedVersion})),
  submitSales: async (id: string, expectedVersion: number) =>
    data<SalesReport>(await call<unknown>(`/sales-reports/${validSegment(id)}/submit`,'POST',{expectedVersion})),
  reviewSales: async (id: string, action: 'approve'|'return', expectedVersion:number, revisionNumber:number, reason?:string) =>
    data<SalesReport>(await call<unknown>(`/sales-reports/${validSegment(id)}/${action}`,'POST',{
      expectedVersion, revisionNumber, ...(action === 'return' ? {reason} : {}),
    })),
  counts: async (businessDate: string, signal?: AbortSignal) =>
    items<StockCountSummary>(await call<unknown>(`/shift-stock-counts${qs({businessDate})}`,'GET',undefined,signal)),
  countTemplate: async (branchId:string,businessDate:string,shift:WorkShift,signal?:AbortSignal) =>
    call<{branchId:string;items:{ingredientId:string;code:string;name:string;unit:string;systemQuantity:string}[]}>(
      `/shift-stock-counts/template${qs({branchId,businessDate,shift})}`,'GET',undefined,signal),
  inventory: async (branchId: string, page = 1, signal?: AbortSignal) => {
    const raw=await call<unknown>(`/inventory/balances${qs({branchId,page})}`,'GET',undefined,signal);
    if(!isItems(raw)||typeof raw.total!=='number')throw new FieldApiError('MALFORMED');
    return {items:raw.items as StockBalance[],total:raw.total,page};
  },
  stockCount: async(id:string,signal?:AbortSignal)=>data<{
    id:string;branchId:string;businessDate:string;shift:WorkShift;status:string;note:string|null;returnReason:string|null;
    items:{ingredientId:string;countedQuantity:string;expectedQuantity:string|null;variance:string|null}[];
  }>(await call<unknown>(`/shift-stock-counts/${validSegment(id)}`,'GET',undefined,signal)),
  createCount: async(payload:{branchId:string;businessDate:string;shift:WorkShift;note:string|null;
    items:{ingredientId:string;countedQuantity:string}[]})=>data<{id:string;status:string}>(
    await call<unknown>('/shift-stock-counts','POST',payload)),
  updateCount: async(id:string,payload:{note:string|null;items:{ingredientId:string;countedQuantity:string}[]})=>
    data<{id:string;status:string}>(await call<unknown>(`/shift-stock-counts/${validSegment(id)}`,'PATCH',payload)),
  submitCount: async(id:string)=>data<{id:string;status:string}>(await call<unknown>(
    `/shift-stock-counts/${validSegment(id)}/submit`,'POST')),
  approveCount: async(id:string)=>data<{id:string;status:string}>(await call<unknown>(
    `/shift-stock-counts/${validSegment(id)}/approve`,'POST')),
  returnCount: async(id:string,reason:string)=>data<{id:string;status:string}>(await call<unknown>(
    `/shift-stock-counts/${validSegment(id)}/return`,'POST',{reason})),
  operations: async (businessDate: string, signal?: AbortSignal) =>
    data<OperationsSummary>(await call<unknown>(`/kitchen-planning/operations${qs({businessDate})}`,'GET',undefined,signal)),
  areas: async(signal?:AbortSignal)=>items<NamedPlace>(await call<unknown>('/areas','GET',undefined,signal)),
  areaBranches: async(areaId:string,signal?:AbortSignal)=>items<NamedPlace>(await call<unknown>(
    `/areas/${validSegment(areaId)}/branches`,'GET',undefined,signal)),
  areaUsers: async(areaId:string,signal?:AbortSignal)=>items<{id:string;displayName:string;role:string;workKind:string}>(
    await call<unknown>(`/areas/${validSegment(areaId)}/users`,'GET',undefined,signal)),
  createAssignment: async(payload:{userId:string;branchId:string;businessDate:string;shift:WorkShift})=>
    data<WorkAssignment>(await call<unknown>('/scheduling/assignments','POST',payload)),
  changeAssignment: async(id:string,expectedVersion:number,body:{branchId?:string;status?:'SCHEDULED'|'CANCELLED'})=>
    data<WorkAssignment>(await call<unknown>(`/scheduling/assignments/${validSegment(id)}`,'PATCH',{
      ...body,expectedVersion,
    })),
  plans: async(businessDate:string,signal?:AbortSignal)=>items<{
    id:string;areaId:string;status:string;createdById:string;warehouse:{name:string};area:{name:string};
    lines:{branchId:string;ingredientId:string;quantity:string;branch:{name:string};ingredient:{name:string;unit:string}}[]
  }>(await call<unknown>(`/restock-approval/plans${qs({businessDate})}`,'GET',undefined,signal)),
  plan: async(id:string,signal?:AbortSignal)=>data<{
    id:string;areaId:string;status:string;createdById:string;warehouse:{name:string};area:{name:string};
    lines:{branchId:string;ingredientId:string;quantity:string;branch:{name:string};ingredient:{name:string;unit:string}}[]
  }>(await call<unknown>(`/restock-approval/plans/${validSegment(id)}`,'GET',undefined,signal)),
  reviewPlan: async(id:string,decision:'APPROVED'|'REJECTED',note:string)=>data<unknown>(await call<unknown>(
    `/restock-approval/plans/${validSegment(id)}/review`,'POST',{decision,note:note.trim()||null})),
  discrepancies: async(businessDate:string,signal?:AbortSignal)=>items<{id:string;status:string;classification:string|null;
    stop?:{branch?:{name:string}};branch?:{name:string}}>(await call<unknown>(
    `/delivery-discrepancies/cases${qs({businessDate})}`,'GET',undefined,signal)),
  dashboard: async (businessDate: string, signal?: AbortSignal) =>
    data<unknown>(await call<unknown>(`/dashboard/summary${qs({from:businessDate,to:businessDate})}`,'GET',undefined,signal)),
};
