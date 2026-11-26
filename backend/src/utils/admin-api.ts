export const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readBody(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

export function onlyKeys(
    body: Record<string, unknown>,
    allowed: readonly string[]
): boolean {
    return Object.keys(body).every(key => allowed.includes(key));
}

export function prismaErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return null;
    }

    return typeof error.code === 'string' ? error.code : null;
}

export function readPage(value: unknown): number | null {
    if (value === undefined) return 1;

    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const page = Number(value);

    return Number.isSafeInteger(page) && page <= 10000
        ? page
        : null;
}