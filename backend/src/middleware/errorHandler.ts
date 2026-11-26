import type { ErrorRequestHandler } from 'express';
import { RequestError } from '../validation/request-error';

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    let status = 500;
    let message = 'Internal server error';
    if (error instanceof RequestError) {
        status = error.status;
        message = error.message;
    } else if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
        // Preserve existing parser/client-error responses, including malformed JSON.
        status = error.status;
        message = 'Invalid request';
    }
    if (status === 500) console.error('Request failed: Internal server error');
    res.status(status).json({ error: message });
};
