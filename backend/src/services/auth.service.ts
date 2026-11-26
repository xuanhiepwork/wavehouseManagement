import type { PrismaClient } from '../generated/prisma/client';
import { verifyPassword } from './password.service';

export function createAuthService(prisma: PrismaClient) {
    return {
        async authenticate(email: string, password: string) {
            const normalizedEmail = email.trim().toLowerCase();

            if (
                normalizedEmail.length === 0 ||
                normalizedEmail.length > 254 ||
                password.length === 0
            ) {
                return null;
            }

            const user = await prisma.user.findUnique({
                where: { email: normalizedEmail },
                include: {
                    branch: { select: { isActive: true } },
                    area: { select: { isActive: true } },
                },
            });

            if (!user || !user.isActive) {
                return null;
            }

            if (user.role === 'BRANCH_MANAGER' &&
                !((user.areaId && user.area?.isActive) || (user.branchId && user.branch?.isActive))) {
                return null;
            }
            if (user.role === 'STAFF' && !(
                (user.workKind === 'SALES' && user.areaId && user.area?.isActive) ||
                user.workKind === 'KITCHEN_DELIVERY' ||
                (user.branchId && user.branch?.isActive)
            )) return null;

            const passwordValid = await verifyPassword(
                user.passwordHash,
                password
            );

            if (!passwordValid) {
                return null;
            }

            return {
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                role: user.role,
                branchId: user.branch?.isActive ? user.branchId : null,
                areaId: user.areaId,
                workKind: user.workKind,
            };
        },
    };
}