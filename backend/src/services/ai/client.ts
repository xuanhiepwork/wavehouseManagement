/** Node.js -> private Python AI3 transport. No ORM, writes or retry loops. */
import type { AiForecastRequest, AiForecastResponse, AiPrediction, AiStatus, IngredientUnit } from './types';

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2500;
const statuses = new Set<AiStatus>(['AVAILABLE', 'INSUFFICIENT_DATA', 'MODEL_NOT_CONFIGURED']);
const units = new Set<IngredientUnit>(['g', 'ml', 'piece']);
const quantityPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;

export type AiUnavailableReason =
  | 'NOT_CONFIGURED' | 'INVALID_CONFIG' | 'TIMEOUT' | 'NETWORK'
  | 'SERVICE_UNAVAILABLE' | 'INVALID_RESPONSE';

export class AiUnavailableError extends Error {
  constructor(readonly reason: AiUnavailableReason) {
    super(`AI3 unavailable: ${reason}`);
    this.name = 'AiUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validQuantity(value: unknown): value is string {
  return typeof value === 'string' && quantityPattern.test(value);
}

function readEndpoint(): { endpoint: string; key: string; timeout: number } {
  const origin = process.env.WAVEHOUSE_AI3_ORIGIN?.trim();
  const key = process.env.WAVEHOUSE_AI3_SHARED_KEY ?? '';
  if (!origin || !key) throw new AiUnavailableError('NOT_CONFIGURED');
  if (key.length < 32) throw new AiUnavailableError('INVALID_CONFIG');
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new AiUnavailableError('INVALID_CONFIG'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!((url.protocol === 'https:') || (url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AiUnavailableError('INVALID_CONFIG');
  }
  const rawTimeout = Number(process.env.WAVEHOUSE_AI3_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeout = Number.isInteger(rawTimeout) && rawTimeout >= 250 && rawTimeout <= 15000
    ? rawTimeout : DEFAULT_TIMEOUT_MS;
  return { endpoint: new URL('/internal/ai/v1/forecast', url).toString(), key, timeout };
}

async function boundedResponse(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new AiUnavailableError('INVALID_RESPONSE');
  }
  if (!response.body) throw new AiUnavailableError('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      count += value.byteLength;
      if (count > MAX_RESPONSE_BYTES) throw new AiUnavailableError('INVALID_RESPONSE');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

function parsePrediction(value: unknown, requested: AiForecastRequest): AiPrediction {
  if (!isRecord(value)) throw new AiUnavailableError('INVALID_RESPONSE');
  const item = requested.ingredients.find(row => row.id === value.ingredientId);
  if (!item || !statuses.has(value.status as AiStatus) || value.unit !== item.unit) {
    throw new AiUnavailableError('INVALID_RESPONSE');
  }
  const available = value.status === 'AVAILABLE';
  const demand = value.predictedDemand ?? null;
  const lower = value.uncertaintyLower ?? null;
  const upper = value.uncertaintyUpper ?? null;
  const modelVersion = value.modelVersion ?? null;
  if (available) {
    if (item.unit === null || !validQuantity(demand) || typeof modelVersion !== 'string'
        || modelVersion.length === 0 || modelVersion.length > 120
        || (lower !== null && !validQuantity(lower))
        || (upper !== null && !validQuantity(upper))
        || ((lower === null) !== (upper === null))) {
      throw new AiUnavailableError('INVALID_RESPONSE');
    }
    if (lower !== null && upper !== null &&
        (compareDecimals(lower, demand as string) > 0 || compareDecimals(demand as string, upper) > 0)) {
      throw new AiUnavailableError('INVALID_RESPONSE');
    }
  } else if (demand !== null || lower !== null || upper !== null) {
    throw new AiUnavailableError('INVALID_RESPONSE');
  }
  if (!Array.isArray(value.warnings)) throw new AiUnavailableError('INVALID_RESPONSE');
  const warnings: AiPrediction['warnings'] = value.warnings.slice(0, 30).map((row: unknown) => {
    if (!isRecord(row) || typeof row.code !== 'string' || typeof row.message !== 'string'
        || row.message.length > 500 || !['INFO', 'WARNING', 'ERROR'].includes(String(row.severity))) {
      throw new AiUnavailableError('INVALID_RESPONSE');
    }
    return { code: row.code, severity: row.severity as 'INFO' | 'WARNING' | 'ERROR', message: row.message };
  });
  return {
    ingredientId: String(value.ingredientId), unit: item.unit,
    status: value.status as AiStatus,
    predictedDemand: demand as string | null,
    uncertaintyLower: lower as string | null,
    uncertaintyUpper: upper as string | null,
    modelVersion: modelVersion as string | null, warnings,
  };
}

/** Decimal comparison without converting amounts to floating point. */
function compareDecimals(a: string, b: string): number {
  const [aw = '', af = ''] = a.split('.');
  const [bw = '', bf = ''] = b.split('.');
  if (aw.length !== bw.length) return Math.sign(aw.length - bw.length);
  if (aw !== bw) return aw < bw ? -1 : 1;
  const length = Math.max(af.length, bf.length);
  const x = af.padEnd(length, '0');
  const y = bf.padEnd(length, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

function validateForecast(value: unknown, request: AiForecastRequest): AiForecastResponse {
  if (!isRecord(value) || value.schemaVersion !== 'AI1'
      || value.timezone !== 'Asia/Ho_Chi_Minh'
      || value.advisoryOnly !== true
      || value.branchId !== request.branchId || value.businessDate !== request.businessDate
      || value.shift !== request.shift || !statuses.has(value.status as AiStatus)
      || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
      || !Array.isArray(value.predictions)
      || value.predictions.length !== request.ingredients.length) {
    throw new AiUnavailableError('INVALID_RESPONSE');
  }
  const predictions = value.predictions.map(row => parsePrediction(row, request));
  if (new Set(predictions.map(row => row.ingredientId)).size !== predictions.length) {
    throw new AiUnavailableError('INVALID_RESPONSE');
  }
  return {
    schemaVersion: 'AI1', timezone: 'Asia/Ho_Chi_Minh',
    branchId: request.branchId, businessDate: request.businessDate,
    shift: request.shift, predictions,
    generatedAt: value.generatedAt, status: value.status as AiStatus, advisoryOnly: true,
  };
}

export async function requestAiForecast(request: AiForecastRequest): Promise<AiForecastResponse> {
  const { endpoint, key, timeout } = readEndpoint();
  if (!Array.isArray(request.ingredients) || request.ingredients.length < 1) {
    throw new AiUnavailableError('INVALID_CONFIG');
  }
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    throw new AiUnavailableError('INVALID_CONFIG');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: {
        'Content-Type': 'application/json',
        'X-WaveHouse-AI-Key': key,
      }, body, signal: controller.signal,
    });
    if (!response.ok) throw new AiUnavailableError('SERVICE_UNAVAILABLE');
    let parsed: unknown;
    try { parsed = JSON.parse(await boundedResponse(response)); }
    catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      throw new AiUnavailableError('INVALID_RESPONSE');
    }
    return validateForecast(parsed, request);
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    if (controller.signal.aborted) throw new AiUnavailableError('TIMEOUT');
    throw new AiUnavailableError('NETWORK');
  } finally {
    clearTimeout(timer);
  }
}
