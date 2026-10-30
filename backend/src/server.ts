import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createApp } from './app';

dotenv.config();

export async function startServer() {
    const port = Number(process.env.PORT ?? 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    const { io, server } = createApp();
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wavehouse_db', {
            serverSelectionTimeoutMS: 10000,
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, () => {
                server.off('error', reject);
                resolve();
            });
        });
    } catch (error) {
        await mongoose.disconnect();
        throw error;
    }
    console.log(`Backend listening on http://localhost:${port}`);
    let closing = false;
    const shutdown = () => {
        if (closing) return;
        closing = true;
        const timeout = setTimeout(() => process.exit(1), 10000);
        timeout.unref();
        io.close(() => {
            void mongoose.disconnect().then(() => {
                clearTimeout(timeout);
            }).catch((error: unknown) => {
                console.error('Shutdown failed:', error);
                process.exitCode = 1;
            });
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return server;
}

if (require.main === module) {
    void startServer().catch((error: unknown) => {
        console.error('Backend startup failed:', error);
        process.exitCode = 1;
    });
}
