import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { apiRequest } from '../api';
import './AreaManagement.css';

type Area = { id: string; code: string; name: string; isActive: boolean };
type Branch = { id: string; code: string; name: string; isActive: boolean };
type User = { id: string; email: string; displayName: string; role: string; branchId: string | null; isActive: boolean };
type AreaUser = { id: string; displayName: string; role: string; workKind: string };
const ROLES = { STAFF: 'Nhân viên', BRANCH_MANAGER: 'Quản lý khu vực' };

export default function AreaManagement({ session }: { session: AuthSession }) {
    const [areas, setAreas] = useState<Area[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [areaId, setAreaId] = useState('');
    const [areaBranches, setAreaBranches] = useState<Branch[]>([]);
    const [areaUsers, setAreaUsers] = useState<AreaUser[]>([]);
    const [code, setCode] = useState(''); const [name, setName] = useState('');
    const [branchId, setBranchId] = useState(''); const [userId, setUserId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(''); const [message, setMessage] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const refresh = useCallback(() => setRefreshKey(n => n + 1), []);
    useEffect(() => {
        let live = true;
        // Only the first page is used for the assignment dropdown; expand API pagination before scaling beyond 50.
        void Promise.all([
            apiRequest<{ items: Area[] }>(session, '/areas'),
            apiRequest<{ items: Branch[] }>(session, '/branches?page=1'),
            apiRequest<{ items: User[] }>(session, '/users?page=1'),
        ]).then(([a,b,u]) => {
            if (!live) return;
            setAreas(a.items); setBranches(b.items); setUsers(u.items);
            setAreaId(old => a.items.some(row => row.id === old) ? old : a.items[0]?.id ?? '');
            setBranchId(old => b.items.some(row => row.id === old) ? old : b.items[0]?.id ?? '');
            setUserId(old => u.items.some(row => row.id === old) ? old : u.items.find(row => row.role !== 'ADMIN')?.id ?? '');
        }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu quản trị.'); });
        return () => { live = false; };
    }, [session, refreshKey]);
    useEffect(() => {
        if (!areaId) return;
        let live = true;
        void Promise.all([
            apiRequest<{ items: Branch[] }>(session, `/areas/${areaId}/branches`),
            apiRequest<{ items: AreaUser[] }>(session, `/areas/${areaId}/users`),
        ]).then(([b,u]) => { if (live) { setAreaBranches(b.items); setAreaUsers(u.items); } })
            .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết khu vực.'); });
        return () => { live = false; };
    }, [session, areaId, refreshKey]);

    async function submit(path: string, body: unknown, callback?: () => void) {
        if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            await apiRequest(session, path, { method: 'POST', body });
            setMessage('Đã cập nhật dữ liệu khu vực trên máy chủ.'); callback?.(); refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể cập nhật.');
        } finally { setBusy(false); }
    }
    function createArea(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); void submit('/areas', { code: code.trim().toUpperCase(), name: name.trim() }, () => { setCode(''); setName(''); });
    }
    function assignBranch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (!areaId || !branchId) return;
        void submit(`/areas/${areaId}/branches`, { branchId });
    }
    function assignUser(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (!areaId || !userId) return;
        void submit(`/areas/${areaId}/users`, { userId, workKind: 'SALES' });
    }
    function markCentralStaff(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (!userId) return;
        if (!window.confirm('Chuyển nhân viên sang nhóm Kho bếp / Giao hàng trung tâm? Nhân viên không còn thuộc khu vực bán hàng.')) return;
        void submit('/areas/central-staff', { userId });
    }
    return <section className="wh-area-admin">
        <div className="wh-heading"><div><p className="wh-eyebrow">QUẢN TRỊ / CƠ CẤU VẬN HÀNH</p><h2>Khu vực và nhân sự</h2></div>
            <button type="button" onClick={refresh} disabled={busy}>Tải mới nhất</button></div>
        <p className="wh-intro">Mỗi quầy thuộc một khu vực. Nhân viên bán hàng thuộc khu vực và được phân công quầy theo từng ca, không cố định một quầy.</p>
        {error && <p className="wh-area-error" role="alert">{error} Nếu kết nối bị gián đoạn, hãy tải lại dữ liệu trước khi gửi tiếp.</p>}
        {message && <p className="wh-area-success" role="status">{message}</p>}
        <div className="wh-area-grid">
            <form className="wh-area-panel" onSubmit={createArea}>
                <h3>Tạo khu vực</h3>
                <label>Mã khu vực<input value={code} onChange={event => setCode(event.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" placeholder="KV1" /></label>
                <label>Tên khu vực<input value={name} onChange={event => setName(event.target.value)} required maxLength={150} placeholder="Quận 3 & Quận 10" /></label>
                <button type="submit" disabled={busy}>Tạo khu vực</button>
            </form>
            <div className="wh-area-panel">
                <h3>Chọn khu vực quản lý</h3>
                <label>Khu vực<select value={areaId} onChange={event => setAreaId(event.target.value)}>
                    {areas.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                </select></label>
                <p>{areas.length} khu vực được ghi nhận.</p>
                <p className="wh-area-hint">Chuyển quầy/nhân viên từ khu vực khác sẽ bị chặn; cần quy trình điều chuyển kèm lịch sử trong đợt nâng cấp tiếp theo.</p>
            </div>
            <form className="wh-area-panel" onSubmit={assignBranch}>
                <h3>Gán quầy vào khu vực</h3>
                <label>Quầy<select value={branchId} onChange={event => setBranchId(event.target.value)} required>
                    <option value="">Chọn quầy</option>{branches.filter(x => x.isActive).map(item => <option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}
                </select></label>
                <button disabled={busy || !areaId} type="submit">Gán quầy</button>
                <h4>Quầy trong khu vực</h4>
                {areaBranches.length ? <ul>{areaBranches.map(row => <li key={row.id}>{row.code} — {row.name}</li>)}</ul> : <p>Chưa có quầy.</p>}
            </form>
            <form className="wh-area-panel" onSubmit={assignUser}>
                <h3>Gán nhân viên/quản lý</h3>
                <label>Nhân sự<select value={userId} onChange={event => setUserId(event.target.value)} required>
                    <option value="">Chọn nhân sự</option>{users.filter(x => x.isActive && x.role !== 'ADMIN').map(item => <option value={item.id} key={item.id}>{item.displayName} — {ROLES[item.role as keyof typeof ROLES] ?? item.role}</option>)}
                </select></label>
                <button disabled={busy || !areaId} type="submit">Gán nhân sự bán hàng vào khu vực</button>
                <h4>Nhân sự thuộc khu vực</h4>
                {areaUsers.length ? <ul>{areaUsers.map(row => <li key={row.id}>{row.displayName} — {row.role === 'BRANCH_MANAGER' ? 'Quản lý' : row.workKind}</li>)}</ul> : <p>Chưa có nhân sự.</p>}
            </form>
            <form className="wh-area-panel" onSubmit={markCentralStaff}>
                <h3>Nhóm kho bếp / giao hàng trung tâm</h3>
                <p>Nhân viên thuộc kho trung tâm không phải nhân viên bán hàng tại một quầy cố định.</p>
                <label>Nhân viên STAFF<select value={userId} onChange={event => setUserId(event.target.value)}>
                    <option value="">Chọn nhân viên</option>
                    {users.filter(x => x.isActive && x.role === 'STAFF').map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select></label>
                <button disabled={busy || !userId} type="submit">Chuyển sang nhóm kho/giao hàng</button>
                <p className="wh-area-hint">Tài khoản hiện còn dùng branchId trong một số API cũ. Chuyển nhóm công việc tại đây chưa tự động mở quyền cho tất cả nghiệp vụ kho; lớp quyền kho sẽ được cập nhật đồng bộ trong đợt tiếp theo.</p>
            </form>
        </div>
    </section>;
}
