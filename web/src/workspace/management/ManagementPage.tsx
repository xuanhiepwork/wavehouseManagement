import type { AuthSession } from '../auth';
import BranchManagement from './BranchManagement';
import UserManagement from './UserManagement';
import type { ActivityProps } from './management.utils';
import './ManagementPage.css';

type Props = ActivityProps & { session: AuthSession; mode: 'branches' | 'users' };

export default function ManagementPage({ session, mode, ...activity }: Props) {
    if (session.user.role !== 'ADMIN') return <section className="wh-section-page"><h2>Quản trị hệ thống</h2>
        <p role="alert">Chỉ ADMIN được truy cập quản lý chi nhánh và tài khoản. Máy chủ kiểm tra quyền cho mọi yêu cầu.</p></section>;
    return mode === 'branches' ? <BranchManagement session={session} {...activity} /> : <UserManagement session={session} {...activity} />;
}
