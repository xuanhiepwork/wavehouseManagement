import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { RequestError } from '../validation/ingredient.validation';

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    let status = 500;
    let message = 'Internal server error';
    if (error instanceof RequestError) {
        status = error.status;
        message = error.message;
    } else if (error?.code === 11000) {
        status = 409;
        message = 'Ingredient code already exists';
    } else if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
        status = 400;
        message = 'Invalid request';
    } else if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
        // Preserve existing parser/client-error responses, including malformed JSON.
        status = error.status;
        message = 'Invalid request';
    }
    if (status === 500) console.error(error);
    res.status(status).json({ error: message });
};
