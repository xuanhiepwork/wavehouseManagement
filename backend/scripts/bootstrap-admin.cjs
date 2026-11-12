
const { createPrismaRuntime } = require('../dist/db/prisma.js');
const { hashPassword } = require('../dist/services/password.service.js');
const { loadPostgresEnvironment } = require('../dist/config/postgres.js');

let runtime;

async function main() {
    if (
        process.env.NODE_ENV !== 'development' ||
        process.env.CATALOG_POSTGRES_TARGET !== 'aiven'
    ) {
        throw new Error('Bootstrap only allowed in Aiven development mode');
    }

    const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '')
        .trim()
        .toLowerCase();

    const displayName = (process.env.BOOTSTRAP_ADMIN_NAME || '').trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

    if (
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new Error('Invalid admin email');
    }

    if (!displayName || displayName.length > 120) {
        throw new Error('Invalid admin display name');
    }

    if (password.length < 12 || password.length > 128) {
        throw new Error('Admin password must contain 12-128 characters');
    }

    loadPostgresEnvironment();
    runtime = createPrismaRuntime();
    await runtime.connect();

    const passwordHash = await hashPassword(password);

    const admin = await runtime.client.$transaction(
        async (tx) => {
            const userCount = await tx.user.count();

            if (userCount !== 0) {
                throw new Error(
                    'Bootstrap refused: users table is not empty'
                );
            }

            return tx.user.create({
                data: {
                    email,
                    displayName,
                    passwordHash,
                    role: 'ADMIN',
                    branchId: null,
                    isActive: true,
                },
                select: {
                    id: true,
                    email: true,
                    role: true,
                },
            });
        },
        { isolationLevel: 'Serializable' }
    );

    console.log('ADMIN BOOTSTRAP SUCCESS');
    console.log('Email:', admin.email);
    console.log('Role:', admin.role);
}

main()
    .catch((error) => {
        console.error('BOOTSTRAP FAILED:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (runtime) {
            await runtime.close().catch(() => { });
        }
    });
