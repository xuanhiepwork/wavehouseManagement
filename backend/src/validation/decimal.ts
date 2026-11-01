import { RequestError } from './ingredient.validation';

// Parse decimal notation without a floating-point multiplication or rounding.
export function decimalInput(value: unknown, scale: number): string {
    const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };
    const numeric = typeof value === 'number';
    if (numeric && (!Number.isFinite(value) || value < 0 || Object.is(value, -0)
        || value > Number.MAX_SAFE_INTEGER)) return invalid();
    if (!numeric && typeof value !== 'string') return invalid();
    const text = String(value);
    if (text.length > 100) return invalid();
    // Strings are plain unsigned decimals; JSON numbers may stringify in exponent notation.
    const match = numeric
        ? /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)
        : /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return invalid();
    const whole = match[1]!;
    const fraction = match[2] ?? '';
    const exponent = Number(match[3] ?? 0);
    const point = whole.length + exponent;
    const digits = whole + fraction;
    const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
        : point >= digits.length ? digits + '0'.repeat(point - digits.length)
            : `${digits.slice(0, point)}.${digits.slice(point)}`;
    const [integer = '0', fractional = ''] = expanded.split('.');
    const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
    // Even trailing fractional zeroes must fit the declared input scale.
    if (normalizedInteger.length > 18 - scale || fractional.length > scale) return invalid();
    const trimmed = fractional.replace(/0+$/, '');
    const result = normalizedInteger + (trimmed ? `.${trimmed}` : '');
    if (numeric) {
        // Scaled units must remain within the exact integer range of a JSON number.
        const units = BigInt(normalizedInteger + fractional.padEnd(scale, '0'));
        if (units > BigInt(Number.MAX_SAFE_INTEGER) || Number(result) !== value) return invalid();
    }
    return result;
}
