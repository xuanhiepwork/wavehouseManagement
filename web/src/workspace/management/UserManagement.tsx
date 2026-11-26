import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthSession, UserRole } from '../auth';
import {
    createUser, getUser, listUsers, loadBranchOptions, resetPassword, updateUser,
    type BranchRecord, type Page, type UserChanges, type UserFilters, type UserRecord,
} from './management.api';
import { Pagination } from './management.shared';
import { errorMessage, mayDiscard, timestamp, useManagementActivity, type ActivityProps } from './management.utils';

type Props = ActivityProps & { session: AuthSession };
type Form = { email: string; displayName: string; role: UserRole; branchId: string; isActive: boolean; password: string };
const emptyForm = (): Form => ({ email: '', displayName: '', role: 'STAFF', branchId: '', isActive: true, password: '' });
const emptyFilters = (): UserFilters => ({ q: '', role: '', branchId: '', isActive: '' });
const ROLE_LABELS: Record<UserRole, string> = { ADMIN: 'Quản trị viên', BRANCH_MANAGER: 'Quản lý chi nhánh', STAFF: 'Nhân viên' };

export default function UserManagement({ session, ...activity }: Props) {
    const [result, setResult] = useState<Page<UserRecord>>({ items: [], page: 1, total: 0 });
    const [branches, setBranches] = useState<BranchRecord[]>([]);
    const [filters, setFilters] = useState<UserFilters>(emptyFilters);
    const [appliedFilters, setAppliedFilters] = useState<UserFilters>(emptyFilters);
    const [selected, setSelected] = useState<UserRecord | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [form, setForm] = useState<Form>(emptyForm);
    const [baseline, setBaseline] = useState(JSON.stringify(emptyForm()));
    const [passwordReset, setPasswordReset] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const lock = useRef(false);
    const formDirty = editorOpen && JSON.stringify(form) !== baseline;
    const dirty = formDirty || passwordReset.length > 0;
    const editable = selected?.role !== 'ADMIN';
    useManagementActivity(dirty, busy, activity);

    useEffect(() => {
        let active = true;
        lock.current = true;
        void Promise.allSettled([listUsers(session, 1, emptyFilters()), loadBranchOptions(session)]).then(results => {
            if (!active) return;
            const [users, options] = results;
            if (users.status === 'fulfilled') { setResult(users.value); setAppliedFilters(emptyFilters()); }
            if (options.status === 'fulfilled') setBranches(options.value);
            const failures = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected');
            if (failures.length) setError(failures.map(value => errorMessage(value.reason)).join(' '));
        }).finally(() => { if (active) { lock.current = false; setBusy(false); } });
        return () => { active = false; };
    }, [session]);

    function branchLabel(branchId: string | null): string {
        if (!branchId) return 'Không gán chi nhánh';
        const branch = branches.find(row => row.id === branchId);
        return branch ? `${branch.code} · ${branch.name}${branch.isActive ? '' : ' (ngừng hoạt động)'}` : branchId;
    }
    function adopt(value: UserRecord, preserveReset = false) {
        const next: Form = { email: value.email, displayName: value.displayName, role: value.role,
            branchId: value.branchId ?? '', isActive: value.isActive, password: '' };
        setSelected(value); setForm(next); setBaseline(JSON.stringify(next)); setEditorOpen(true);
        if (!preserveReset) setPasswordReset('');
    }
    async function loadPage(page: number, nextFilters = appliedFilters, refreshOptions = false) {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try {
            const response = await listUsers(session, page, nextFilters);
            setResult(response); setAppliedFilters(nextFilters);
            if (refreshOptions) {
                try { setBranches(await loadBranchOptions(session)); }
                catch (cause) { setError(`Đã tải tài khoản; chưa tải lại được chi nhánh. ${errorMessage(cause)}`); }
            }
        } catch (cause) { setError(errorMessage(cause)); }
        finally { lock.current = false; setBusy(false); }
    }
    async function select(row: UserRecord) {
        if (lock.current || !mayDiscard(dirty)) return;
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try { adopt(await getUser(session, row.id)); }
        catch (cause) { setError(errorMessage(cause)); }
        finally { lock.current = false; setBusy(false); }
    }
    function startNew() {
        if (lock.current || !mayDiscard(dirty)) return;
        const next = emptyForm();
        setSelected(null); setForm(next); setBaseline(JSON.stringify(next)); setPasswordReset(''); setEditorOpen(true); setError(''); setNotice('');
    }
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (lock.current || !editable) return;
        const displayName = form.displayName.trim();
        const email = form.email.trim().toLowerCase();
        if (!displayName || displayName.length > 120 || (form.role !== 'STAFF' && form.role !== 'BRANCH_MANAGER')) {
            setError('Tên hiển thị cần 1–120 ký tự. Chỉ tạo hoặc quản lý tài khoản STAFF và BRANCH_MANAGER.'); return;
        }
        if (!selected && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || form.password.length < 12 || form.password.length > 128)) {
            setError('Email không hợp lệ hoặc mật khẩu chưa đủ 12–128 ký tự.'); return;
        }
        if ((!selected || form.branchId !== selected.branchId) && !branches.some(branch => branch.id === form.branchId && branch.isActive)) {
            setError('Cần chọn một chi nhánh đang hoạt động. Hãy tải lại danh sách nếu trạng thái chi nhánh đã thay đổi.'); return;
        }
        if (selected && selected.isActive !== form.isActive && !window.confirm(
            `${form.isActive ? 'Kích hoạt' : 'Vô hiệu hóa'} tài khoản ${selected.email}? Các phiên đăng nhập hiện tại của tài khoản sẽ bị thu hồi.`)) return;
        const changes: UserChanges = {};
        if (selected) {
            if (displayName !== selected.displayName) changes.displayName = displayName;
            if (form.role !== selected.role) changes.role = form.role;
            if (form.branchId !== selected.branchId) changes.branchId = form.branchId;
            if (form.isActive !== selected.isActive) changes.isActive = form.isActive;
            if (!Object.keys(changes).length) { setNotice('Không có thay đổi tài khoản cần lưu.'); return; }
        }
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try {
            const saved = selected ? await updateUser(session, selected.id, changes) : await createUser(session,
                { email, displayName, role: form.role, branchId: form.branchId, password: form.password });
            adopt(saved, !!selected);
            setNotice(selected ? 'Đã lưu tài khoản. Máy chủ đã thu hồi các phiên đăng nhập cũ của tài khoản này.' : 'Đã tạo tài khoản trên máy chủ.');
            try { setResult(await listUsers(session, selected ? result.page : 1, appliedFilters)); }
            catch (cause) { setError(`Tài khoản đã được lưu; chưa tải lại được danh sách. ${errorMessage(cause)}`); }
        } catch (cause) {
            setError(`${errorMessage(cause)} Nếu kết quả tạo chưa rõ do lỗi mạng, tải lại và tìm theo email trước khi gửi lại.`);
        } finally { lock.current = false; setBusy(false); }
    }
    async function submitReset(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (lock.current || !selected || !editable) return;
        if (passwordReset.length < 12 || passwordReset.length > 128) { setError('Mật khẩu mới cần 12–128 ký tự.'); return; }
        if (!window.confirm(`Đặt lại mật khẩu cho ${selected.email}? Các phiên đăng nhập của tài khoản này sẽ bị thu hồi.`)) return;
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try {
            await resetPassword(session, selected.id, passwordReset);
            setPasswordReset('');
            setNotice('Đã đặt lại mật khẩu và thu hồi các phiên đăng nhập của tài khoản.');
        } catch (cause) { setError(errorMessage(cause)); }
        finally { lock.current = false; setBusy(false); }
    }

    return <section className="wh-management" aria-busy={busy}>
        <div className="wh-heading"><div><p className="wh-eyebrow">QUẢN TRỊ HỆ THỐNG</p><h2>Tài khoản nhân sự</h2></div>
            <button type="button" className="wh-management-primary" disabled={busy} onClick={startNew}>Tạo tài khoản</button></div>
        <p className="wh-intro">Quản lý STAFF và BRANCH_MANAGER. Tài khoản ADMIN chỉ được xem tại đây; quyền quản trị được máy chủ kiểm tra.</p>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {notice && <p className="wh-note" role="status">{notice}</p>}
        <form className="wh-management-filters" onSubmit={event => { event.preventDefault(); void loadPage(1, { ...filters }); }}>
            <label>Tìm tên / email<input value={filters.q} maxLength={120} disabled={busy} placeholder="Nhập tên hoặc email"
                onChange={event => setFilters(previous => ({ ...previous, q: event.target.value }))} /></label>
            <label>Vai trò<select value={filters.role} disabled={busy}
                onChange={event => setFilters(previous => ({ ...previous, role: event.target.value as UserFilters['role'] }))}>
                <option value="">Tất cả</option><option value="STAFF">Nhân viên</option><option value="BRANCH_MANAGER">Quản lý chi nhánh</option><option value="ADMIN">ADMIN (chỉ xem)</option></select></label>
            <label>Chi nhánh<select value={filters.branchId} disabled={busy}
                onChange={event => setFilters(previous => ({ ...previous, branchId: event.target.value }))}>
                <option value="">Tất cả</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}{branch.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select></label>
            <label>Trạng thái<select value={filters.isActive} disabled={busy}
                onChange={event => setFilters(previous => ({ ...previous, isActive: event.target.value as UserFilters['isActive'] }))}>
                <option value="">Tất cả</option><option value="true">Hoạt động</option><option value="false">Vô hiệu hóa</option></select></label>
            <button type="submit" disabled={busy}>Áp dụng bộ lọc</button>
        </form>
        <div className="wh-management-layout"><div className="wh-management-panel">
            <div className="wh-management-toolbar"><strong>Tài khoản trên máy chủ</strong>
                <button type="button" disabled={busy} onClick={() => void loadPage(result.page, appliedFilters, true)}>Tải lại</button></div>
            <div className="wh-management-table-wrap"><table><thead><tr><th>Tên / email</th><th>Vai trò / chi nhánh</th><th>Trạng thái</th><th /></tr></thead>
                <tbody>{result.items.map(row => <tr key={row.id} aria-selected={selected?.id === row.id}>
                    <td><strong>{row.displayName}</strong><span>{row.email}</span></td><td>{ROLE_LABELS[row.role]}<span>{branchLabel(row.branchId)}</span></td>
                    <td><span className={`wh-management-status ${row.isActive ? 'is-active' : ''}`}>{row.isActive ? 'Hoạt động' : 'Vô hiệu hóa'}</span></td>
                    <td><button type="button" disabled={busy} onClick={() => void select(row)}>Chi tiết</button></td>
                </tr>)}</tbody></table></div>
            {!busy && result.items.length === 0 && <p className="wh-management-empty">Không tìm thấy tài khoản phù hợp trên trang này.</p>}
            {busy && <p role="status">Đang xử lý yêu cầu…</p>}
            <Pagination page={result.page} total={result.total} busy={busy} onPage={page => void loadPage(page)} />
        </div><div className="wh-management-panel">
            {editorOpen ? <>
                <form onSubmit={event => void save(event)}>
                    <h3>{selected ? 'Chi tiết tài khoản' : 'Tạo tài khoản'}</h3>
                    {dirty && <p className="wh-management-unsaved">Có thay đổi chưa lưu</p>}
                    {!editable && <p className="wh-note">API nhân sự chỉ cho phép xem tài khoản ADMIN. Chỉnh sửa, vô hiệu hóa và đặt lại mật khẩu ADMIN không được hỗ trợ tại đây.</p>}
                    <fieldset disabled={busy || !editable}>
                        <label>Email<input type="email" value={form.email} maxLength={254} required disabled={!!selected} autoComplete="off"
                            onChange={event => setForm(previous => ({ ...previous, email: event.target.value }))} /></label>
                        <label>Tên hiển thị<input value={form.displayName} maxLength={120} required
                            onChange={event => setForm(previous => ({ ...previous, displayName: event.target.value }))} /></label>
                        <label>Vai trò<select value={form.role} onChange={event => setForm(previous => ({ ...previous, role: event.target.value as UserRole }))}>
                            {!editable && <option value="ADMIN">ADMIN</option>}<option value="STAFF">Nhân viên (STAFF)</option><option value="BRANCH_MANAGER">Quản lý chi nhánh (BRANCH_MANAGER)</option></select></label>
                        <label>Chi nhánh<select value={form.branchId} required onChange={event => setForm(previous => ({ ...previous, branchId: event.target.value }))}>
                            <option value="">Chọn chi nhánh đang hoạt động</option>
                            {form.branchId && !branches.some(branch => branch.id === form.branchId) && <option value={form.branchId} disabled>{form.branchId}</option>}
                            {branches.map(branch => <option key={branch.id} value={branch.id} disabled={!branch.isActive}>{branch.code} · {branch.name}{branch.isActive ? '' : ' (ngừng hoạt động)'}</option>)}
                        </select></label>
                        {!selected && <label>Mật khẩu ban đầu (12–128 ký tự)<input type="password" value={form.password} minLength={12} maxLength={128} required autoComplete="new-password"
                            onChange={event => setForm(previous => ({ ...previous, password: event.target.value }))} /></label>}
                        {selected && <label className="wh-management-checkbox"><input type="checkbox" checked={form.isActive}
                            onChange={event => setForm(previous => ({ ...previous, isActive: event.target.checked }))} />Tài khoản đang hoạt động</label>}
                        {editable && <button className="wh-management-primary" type="submit" disabled={busy || (!!selected && !formDirty)}>{selected ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>}
                    </fieldset>
                </form>
                {selected && <dl className="wh-management-metadata"><dt>ID</dt><dd>{selected.id}</dd><dt>Tạo lúc</dt><dd>{timestamp(selected.createdAt)}</dd>
                    <dt>Cập nhật</dt><dd>{timestamp(selected.updatedAt)}</dd></dl>}
                {selected && editable && <form className="wh-management-reset" onSubmit={event => void submitReset(event)}>
                    <h3>Đặt lại mật khẩu</h3><p>Thay đổi tài khoản hoặc đặt lại mật khẩu sẽ thu hồi các phiên đăng nhập của tài khoản đó.</p>
                    <fieldset disabled={busy}><label>Mật khẩu mới (12–128 ký tự)<input type="password" value={passwordReset} minLength={12} maxLength={128} required autoComplete="new-password"
                        onChange={event => setPasswordReset(event.target.value)} /></label>
                        <button type="submit" disabled={busy || !passwordReset}>Xác nhận đặt lại mật khẩu</button></fieldset>
                </form>}
            </> : <p className="wh-management-empty">Chọn “Chi tiết” để xem tài khoản hoặc tạo STAFF / BRANCH_MANAGER mới.</p>}
        </div></div>
    </section>;
}
