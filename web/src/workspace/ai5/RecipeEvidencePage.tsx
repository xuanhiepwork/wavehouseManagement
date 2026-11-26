import { useEffect, useState } from 'react';
import type { AuthSession } from '../auth';
import { listAllBranches, type Branch } from '../ai4/ai4.api';
import { attestEvidence, detailEvidence, listEvidence,
    type EvidenceDetail, type EvidenceSummary } from './ai5.api';
import './RecipeEvidencePage.css';

type Props = { session: AuthSession };
function vnDate(daysBefore = 0): string {
    const value = new Date(Date.now() - daysBefore * 86400000);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value);
    const part = (key: string) => parts.find(row => row.type === key)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Yêu cầu chưa thành công.';
const shifts = { MORNING: 'Ca sáng', AFTERNOON: 'Ca chiều', EVENING: 'Ca tối' };

export default function RecipeEvidencePage({ session }: Props) {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [from, setFrom] = useState(() => vnDate(30));
    const [to, setTo] = useState(() => vnDate());
    const [records, setRecords] = useState<EvidenceSummary[]>([]);
    const [detail, setDetail] = useState<EvidenceDetail | null>(null);
    const [selected, setSelected] = useState<Record<string, string>>({});
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const isAdmin = session.user.role === 'ADMIN';

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        void listAllBranches(session).then(rows => {
            if (!active) return;
            setBranches(rows);
            setBranchId(current => current || rows[0]?.id || '');
        }).catch(cause => { if (active) setError(errorMessage(cause)); });
        return () => { active = false; };
    }, [session, isAdmin]);

    async function loadList() {
        if (!branchId || busy) return;
        setBusy(true); setError(''); setNotice(''); setDetail(null); setSelected({});
        try { setRecords(await listEvidence(session, branchId, from, to)); }
        catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    }
    async function openDetail(id: string) {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try { setDetail(await detailEvidence(session, id)); setSelected({}); setNote(''); }
        catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    }
    async function confirmEvidence() {
        if (!detail || busy) return;
        if (!window.confirm('Bạn xác nhận đã kiểm tra chứng cứ công thức THỰC TẾ dùng trong ca này? Dữ liệu sẽ được lưu bất biến, không thể sửa hoặc xóa.')) return;
        setBusy(true); setError(''); setNotice('');
        try {
            await attestEvidence(session, detail, selected, note);
            setNotice('Đã ghi nhận bằng chứng công thức cho phiên bản báo cáo đã duyệt. Không điều chỉnh tồn kho.');
            setDetail(await detailEvidence(session, detail.reportId));
            setSelected({}); setNote('');
            setRecords(await listEvidence(session, branchId, from, to));
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    }

    if (!isAdmin) return <p role="alert">Chỉ ADMIN có quyền xác nhận bằng chứng công thức.</p>;
    const pending = detail?.lines.filter(line => line.quantity > 0 && !line.evidence) ?? [];
    const hasAny = detail?.lines.some(line => line.quantity > 0 && !!line.evidence) ?? false;
    return <section className="wh-ai5" aria-label="Xác nhận công thức lịch sử cho AI">
        <header><p className="wh-ai5-kicker">AI5 / DATA PROVENANCE</p><h2>Bằng chứng công thức lịch sử</h2></header>
        <div className="wh-ai5-warning" role="note">
            Chỉ xác nhận khi có căn cứ rằng công thức này thực sự được sử dụng trong ca bán. Công thức hiện tại của Catalog
            <strong> không tự động là bằng chứng lịch sử</strong>. Bằng chứng chỉ dành cho dữ liệu huấn luyện AI,
            không cập nhật doanh thu, tồn kho hoặc lượng giao B7.
        </div>
        <div className="wh-ai5-panel">
            <div className="wh-ai5-filters">
                <label>Chi nhánh<select value={branchId} disabled={busy} onChange={event => { setBranchId(event.target.value); setRecords([]); setDetail(null); }}>
                    <option value="">Chọn chi nhánh</option>{branches.map(item => <option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}
                </select></label>
                <label>Từ ngày<input type="date" value={from} disabled={busy} onChange={event => setFrom(event.target.value)} /></label>
                <label>Đến ngày<input type="date" value={to} disabled={busy} onChange={event => setTo(event.target.value)} /></label>
                <button type="button" disabled={busy || !branchId || !from || !to || from > to} onClick={() => { void loadList(); }}>Tải báo cáo đã duyệt</button>
            </div>
            {error && <p className="wh-ai5-error" role="alert">{error}</p>}
            {notice && <p className="wh-ai5-success" role="status">{notice}</p>}
            {busy && <p role="status">Đang xử lý yêu cầu…</p>}
            <div className="wh-ai5-table-wrap"><table><thead><tr><th>Ngày</th><th>Ca</th><th>Đã xác minh</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead>
                <tbody>{records.map(row => <tr key={row.id}>
                    <td>{row.businessDate}</td><td>{shifts[row.shift]}</td>
                    <td>{row.attestedLines}/{row.totalLines} dòng</td>
                    <td>{row.consistent ? 'Báo cáo đã duyệt' : 'Cần đối chiếu revision'}</td>
                    <td><button type="button" disabled={busy || !row.consistent} onClick={() => { void openDetail(row.id); }}>Xem công thức</button></td>
                </tr>)}</tbody></table></div>
            {!records.length && <p className="wh-ai5-muted">Chưa có báo cáo trong khoảng ngày đã tải, hoặc chưa tải danh sách.</p>}
        </div>
        {detail && <div className="wh-ai5-panel">
            <h3>Báo cáo {detail.businessDate} · {shifts[detail.shift]} · revision {detail.revisionNumber}</h3>
            {hasAny && <p className="wh-ai5-warning">Đã có bằng chứng bất biến cho báo cáo này. Không cho ghi đè; xem thông tin hiện tại bên dưới.</p>}
            <div className="wh-ai5-table-wrap"><table><thead><tr><th>Sản phẩm</th><th>Đã bán</th><th>Công thức lịch sử được xác nhận</th></tr></thead>
                <tbody>{detail.lines.map(line => <tr key={line.salesLineId}>
                    <td>{line.productName} · {line.size}</td><td>{line.quantity}</td>
                    <td>{line.evidence ? <span>Đã xác nhận: {line.evidence.recipeId}</span> :
                        <><select aria-label={`Công thức cho ${line.productName} ${line.size}`} disabled={busy || hasAny}
                            value={selected[line.salesLineId] || ''}
                            onChange={event => setSelected(previous => ({ ...previous, [line.salesLineId]: event.target.value }))}>
                            <option value="">Chọn công thức có chứng cứ</option>
                            {line.candidates.map(recipe => <option key={recipe.recipeId} value={recipe.recipeId}>
                                v{recipe.version} · tạo {recipe.createdAt.slice(0, 10)} · {recipe.ingredients.map(i => `${i.name} ${i.quantity}${i.unit}`).join(', ')}
                            </option>)}
                        </select>{!line.candidates.length && <small>Không có công thức phù hợp trước ngày bán.</small>}</>}
                    </td>
                </tr>)}</tbody></table></div>
            {pending.length > 0 && !hasAny && <div className="wh-ai5-attest">
                <label>Chứng cứ đối chiếu (bắt buộc, 10–500 ký tự)
                    <textarea rows={3} maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)}
                        placeholder="Ví dụ: Phiếu công thức phiên bản X và sổ pha chế của ca, đã đối chiếu trực tiếp…" />
                </label>
                <button type="button" disabled={busy || note.trim().length < 10 || pending.some(line => !selected[line.salesLineId])}
                    onClick={() => { void confirmEvidence(); }}>Xác nhận công thức lịch sử (bất biến)</button>
            </div>}
            {!pending.length && <p className="wh-ai5-muted">Không còn dòng bán cần xác nhận bằng chứng.</p>}
        </div>}
    </section>;
}
