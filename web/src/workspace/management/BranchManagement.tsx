import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { createBranch, getBranch, listBranches, updateBranch, type BranchRecord, type Page } from './management.api';
import { errorMessage, mayDiscard, Pagination, timestamp, useManagementActivity, type ActivityProps } from './management.shared';

type Props = ActivityProps & { session: AuthSession };
type Form = { code: string; name: string; isActive: boolean };
const emptyForm = (): Form => ({ code: '', name: '', isActive: true });

export default function BranchManagement({ session, ...activity }: Props) {
    const [result, setResult] = useState<Page<BranchRecord>>({ items: [], page: 1, total: 0 });
    const [selected, setSelected] = useState<BranchRecord | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [form, setForm] = useState<Form>(emptyForm);
    const [baseline, setBaseline] = useState(JSON.stringify(emptyForm()));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const lock = useRef(false);
    const dirty = editorOpen && JSON.stringify(form) !== baseline;
    useManagementActivity(dirty, busy, activity);

    useEffect(() => {
        let active = true;
        lock.current = true; setBusy(true);
        void listBranches(session, 1).then(value => { if (active) setResult(value); })
            .catch(cause => { if (active) setError(errorMessage(cause)); })
            .finally(() => { if (active) { lock.current = false; setBusy(false); } });
        return () => { active = false; };
    }, [session]);

    function adopt(value: BranchRecord) {
        const next = { code: value.code, name: value.name, isActive: value.isActive };
        setSelected(value); setForm(next); setBaseline(JSON.stringify(next)); setEditorOpen(true);
    }
    async function loadPage(page: number) {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { setResult(await listBranches(session, page)); }
        catch (cause) { setError(errorMessage(cause)); }
        finally { lock.current = false; setBusy(false); }
    }
    async function select(row: BranchRecord) {
        if (lock.current || !mayDiscard(dirty)) return;
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try { adopt(await getBranch(session, row.id)); }
        catch (cause) { setError(errorMessage(cause)); }
        finally { lock.current = false; setBusy(false); }
    }
    function startNew() {
        if (lock.current || !mayDiscard(dirty)) return;
        const next = emptyForm();
        setSelected(null); setForm(next); setBaseline(JSON.stringify(next)); setEditorOpen(true); setError(''); setNotice('');
    }
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (lock.current) return;
        const code = form.code.trim().toUpperCase();
        const name = form.name.trim();
        if (!name || name.length > 150 || (!selected && !/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code))) {
            setError('Tên chi nhánh cần 1–150 ký tự; mã cần 2–32 ký tự A–Z, số, _ hoặc -, bắt đầu bằng chữ hoặc số.'); return;
        }
        if (selected && selected.isActive !== form.isActive && !window.confirm(
            `${form.isActive ? 'Kích hoạt' : 'Ngừng hoạt động'} chi nhánh ${selected.code}? Việc này có thể ảnh hưởng đến các thao tác nghiệp vụ tại chi nhánh.`)) return;
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try {
            const saved = selected ? await updateBranch(session, selected.id, { name, isActive: form.isActive }) :
                await createBranch(session, { code, name });
            adopt(saved);
            setNotice('Đã lưu chi nhánh trên máy chủ.');
            try { setResult(await listBranches(session, selected ? result.page : 1)); }
            catch (cause) { setError(`Chi nhánh đã được lưu; chưa tải lại được danh sách. ${errorMessage(cause)}`); }
        } catch (cause) {
            setError(`${errorMessage(cause)} Nếu kết quả tạo chưa rõ do lỗi mạng, tải lại danh sách để tìm theo mã trước khi gửi lại.`);
        } finally { lock.current = false; setBusy(false); }
    }

    return <section className="wh-management" aria-busy={busy}>
        <div className="wh-heading"><div><p className="wh-eyebrow">QUẢN TRỊ HỆ THỐNG</p><h2>Chi nhánh</h2></div>
            <button type="button" className="wh-management-primary" disabled={busy} onClick={startNew}>Tạo chi nhánh</button></div>
        <p className="wh-intro">Danh sách và trạng thái chi nhánh từ máy chủ. Mã chi nhánh được giữ cố định sau khi tạo.</p>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {notice && <p className="wh-note" role="status">{notice}</p>}
        <div className="wh-management-layout"><div className="wh-management-panel">
            <div className="wh-management-toolbar"><strong>Danh sách chi nhánh</strong>
                <button type="button" disabled={busy} onClick={() => void loadPage(result.page)}>Tải lại</button></div>
            <div className="wh-management-table-wrap"><table><thead><tr><th>Mã / tên chi nhánh</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                <tbody>{result.items.map(row => <tr key={row.id} aria-selected={selected?.id === row.id}>
                    <td><strong>{row.code}</strong><span>{row.name}</span></td>
                    <td><span className={`wh-management-status ${row.isActive ? 'is-active' : ''}`}>{row.isActive ? 'Hoạt động' : 'Ngừng hoạt động'}</span></td>
                    <td><button type="button" disabled={busy} onClick={() => void select(row)}>Chi tiết</button></td>
                </tr>)}</tbody></table></div>
            {!busy && result.items.length === 0 && <p className="wh-management-empty">Không có chi nhánh trong trang này.</p>}
            {busy && <p role="status">Đang xử lý yêu cầu…</p>}
            <Pagination page={result.page} total={result.total} busy={busy} onPage={page => void loadPage(page)} />
        </div><div className="wh-management-panel">
            {editorOpen ? <form onSubmit={event => void save(event)}>
                <h3>{selected ? 'Chi tiết chi nhánh' : 'Tạo chi nhánh'}</h3>
                {dirty && <p className="wh-management-unsaved">Có thay đổi chưa lưu</p>}
                <fieldset disabled={busy}>
                    <label>Mã chi nhánh<input value={form.code} maxLength={32} required disabled={!!selected}
                        onChange={event => setForm(previous => ({ ...previous, code: event.target.value }))} /></label>
                    <label>Tên chi nhánh<input value={form.name} maxLength={150} required
                        onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} /></label>
                    {selected && <label className="wh-management-checkbox"><input type="checkbox" checked={form.isActive}
                        onChange={event => setForm(previous => ({ ...previous, isActive: event.target.checked }))} />Đang hoạt động</label>}
                    <button className="wh-management-primary" type="submit" disabled={busy || (!!selected && !dirty)}>{selected ? 'Lưu thay đổi' : 'Tạo chi nhánh'}</button>
                </fieldset>
                {selected && <dl className="wh-management-metadata"><dt>ID</dt><dd>{selected.id}</dd><dt>Tạo lúc</dt><dd>{timestamp(selected.createdAt)}</dd>
                    <dt>Cập nhật</dt><dd>{timestamp(selected.updatedAt)}</dd></dl>}
            </form> : <p className="wh-management-empty">Chọn “Chi tiết” để xem hoặc chỉnh sửa chi nhánh, hoặc tạo chi nhánh mới.</p>}
        </div></div>
    </section>;
}
