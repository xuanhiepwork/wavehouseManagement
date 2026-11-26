import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { fetchAI4View, listAllBranches, type AI4Input, type Branch } from './ai4.api';
import {
    formatQuantity, nextBusinessDateVN, SHIFT_LABEL, sourceLabel,
    type AI4View, type Shift
} from './ai4.logic';
import { vietnameseWarning } from './warnings.vi';
import './AIAdvisoryPage.css';

type Props = { session: AuthSession };
const SHIFTS: Shift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const STATES: Record<AI4View['state'], string> = {
    ML_AVAILABLE: 'AI2 đang cung cấp dự báo nhu cầu',
    ML_PARTIAL: 'Một phần dùng AI2, phần còn lại dùng B7',
    B7_FALLBACK: 'Dùng dự báo quy tắc B7',
    NOT_CONNECTED: 'Backend chưa nối AI3 — đang hiển thị B7',
    INVALID_OVERLAY: 'Kết quả AI3 không hợp lệ — đã trở về B7',
};
function viewError(error: unknown): string {
    return error instanceof Error ? error.message : 'Không thể tải dữ liệu dự báo.';
}
export default function AIAdvisoryPage({ session }: Props) {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchError, setBranchError] = useState('');
    const [loadingBranches, setLoadingBranches] = useState(true);
    const [source, setSource] = useState('');
    const [destinations, setDestinations] = useState<string[]>([]);
    const [businessDate, setBusinessDate] = useState(nextBusinessDateVN);
    const [shift, setShift] = useState<Shift>('MORNING');
    const [view, setView] = useState<AI4View | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadedAt, setLoadedAt] = useState('');
    const [filter, setFilter] = useState('');
    const currentRequest = useRef<AbortController | null>(null);
    const canView = session.user.role === 'ADMIN';

    useEffect(() => {
        if (!canView) { setLoadingBranches(false); return; }
        const controller = new AbortController();
        setLoadingBranches(true);
        setBranchError('');
        void listAllBranches(session, controller.signal)
            .then(setBranches)
            .catch(err => { if (!controller.signal.aborted) setBranchError(viewError(err)); })
            .finally(() => { if (!controller.signal.aborted) setLoadingBranches(false); });
        return () => controller.abort();
    }, [session.token, session.user.role, canView]);

    useEffect(() => () => { currentRequest.current?.abort(); }, []);

    function invalidate() {
        currentRequest.current?.abort();
        currentRequest.current = null;
        setLoading(false);
        setView(null);
        setError('');
        setLoadedAt('');
    }
    function changeSource(next: string) {
        invalidate();
        setSource(next);
        setDestinations(items => items.filter(id => id !== next));
    }
    function toggleBranch(id: string) {
        if (loading) return;
        invalidate();
        setDestinations(current => current.includes(id)
            ? current.filter(value => value !== id)
            : current.length < 10 ? [...current, id] : current);
    }
    async function load(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loading) return;
        const input: AI4Input = {
            sourceBranchId: source, destinationBranchIds: destinations, businessDate, shift,
        };
        const controller = new AbortController();
        currentRequest.current?.abort();
        currentRequest.current = controller;
        setView(null);
        setError('');
        setLoading(true);
        try {
            const data = await fetchAI4View(session, input, controller.signal);
            if (!controller.signal.aborted) {
                setView(data);
                setLoadedAt(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
            }
        } catch (caught) {
            if (!controller.signal.aborted) setError(viewError(caught));
        } finally {
            if (currentRequest.current === controller) {
                currentRequest.current = null;
                setLoading(false);
            }
        }
    }
    const visible = useMemo(() => {
        if (!view) return [];
        const text = filter.trim().toLocaleLowerCase('vi');
        return !text ? view.rows : view.rows.filter(row =>
            [row.destinationBranchCode, row.destinationBranchName, row.ingredientCode,
            row.ingredientName, row.unit, row.source].some(item => item.toLocaleLowerCase('vi').includes(text)));
    }, [view, filter]);
    const mlCount = view?.rows.filter(row => row.source === 'AI2_ML').length ?? 0;
    const b7Count = (view?.rows.length ?? 0) - mlCount;

    if (!canView) {
        return <section className="wh-ai4"><p className="wh-ai4-alert" role="alert">Chỉ ADMIN có quyền xem kế hoạch dự báo toàn hệ thống.</p></section>;
    }
    return (
        <section className="wh-ai4" aria-label="AI4: So sánh dự báo AI và B7">
            <header className="wh-ai4-heading">
                <div><p className="wh-ai4-kicker">AI4 / RESTOCK INTELLIGENCE</p><h2>Dự báo nhu cầu nguyên liệu</h2>
                    <p>So sánh nhu cầu dự kiến từ AI2 và B7. Chỉ là thông tin hỗ trợ; lượng giao hàng vẫn do B7 đề xuất.</p></div>
                <span className="wh-ai4-tag">Chỉ đọc · ADMIN</span>
            </header>
            <form className="wh-ai4-card wh-ai4-form" onSubmit={event => { void load(event); }}>
                <div className="wh-ai4-fields">
                    <label>Kho nguồn
                        <select required value={source} disabled={loading || loadingBranches} onChange={event => changeSource(event.target.value)}>
                            <option value="">Chọn kho nguồn</option>
                            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                        </select>
                    </label>
                    <label>Ngày cần nguyên liệu
                        <input required type="date" value={businessDate} disabled={loading} onChange={event => { invalidate(); setBusinessDate(event.target.value); }} />
                    </label>
                    <label>Ca dự báo
                        <select value={shift} disabled={loading} onChange={event => { invalidate(); setShift(event.target.value as Shift); }}>
                            {SHIFTS.map(value => <option key={value} value={value}>{SHIFT_LABEL[value]}</option>)}
                        </select>
                    </label>
                </div>
                <fieldset className="wh-ai4-destinations" disabled={loading || loadingBranches}>
                    <legend>Chi nhánh nhận hàng (chọn từ 1 đến 10)</legend>
                    <div className="wh-ai4-branch-grid">
                        {branches.filter(branch => branch.id !== source).map(branch => (
                            <label key={branch.id} className="wh-ai4-choice">
                                <input type="checkbox" checked={destinations.includes(branch.id)}
                                    disabled={!destinations.includes(branch.id) && destinations.length >= 10}
                                    onChange={() => toggleBranch(branch.id)} />
                                <span>{branch.code} — {branch.name}</span>
                            </label>
                        ))}
                    </div>
                    {!loadingBranches && branches.length === 0 && !branchError && <p>Chưa có danh sách chi nhánh từ API.</p>}
                </fieldset>
                {branchError && <p className="wh-ai4-alert" role="alert">{branchError}</p>}
                <div className="wh-ai4-actions">
                    <button type="submit" className="wh-ai4-primary" disabled={loading || loadingBranches || Boolean(branchError) || !source || destinations.length === 0}>
                        {loading ? 'Đang tải dự báo…' : 'Xem so sánh AI2 / B7'}
                    </button>
                    {view && <span className="wh-ai4-muted">Tải lúc: {loadedAt} (giờ Việt Nam)</span>}
                </div>
            </form>
            {error && <div className="wh-ai4-alert" role="alert">{error}</div>}
            {!view && !error && !loading && <div className="wh-ai4-card wh-ai4-empty">Chọn ngày, ca, kho nguồn và chi nhánh nhận rồi tải dự báo từ Backend. Không hiển thị dữ liệu minh họa.</div>}
            {view && <>
                <div className="wh-ai4-card wh-ai4-summary">
                    <div><p className="wh-ai4-kicker">TRẠNG THÁI DỰ BÁO</p><h3>{STATES[view.state]}</h3><p className="wh-ai4-muted">{view.businessDate} · {SHIFT_LABEL[view.shift]} · nguồn: {view.sourceBranchCode || view.sourceBranchName}</p></div>
                    <div className="wh-ai4-metrics"><div><strong>{mlCount}</strong><span>Dòng AI2 · ML</span></div><div><strong>{b7Count}</strong><span>Dòng B7</span></div><div><strong>{view.rows.length}</strong><span>Tổng dòng</span></div></div>
                </div>
                <div className="wh-ai4-info" role="note"><strong>Chú ý:</strong> Dự báo là nhu cầu nguyên liệu lý thuyết, không phải tiêu hao đã đo. Các cột <b>Giao B7</b> vẫn dùng lượng giao của B7, kể cả khi AI2 đưa ra mức nhu cầu khác. Không có thao tác tạo hoặc POST chứng từ tại màn hình này.</div>
                {view.warnings.length > 0 && <div className="wh-ai4-card"><h3>Cảnh báo nguồn dữ liệu</h3><ul className="wh-ai4-warnings">{view.warnings.map((warning, index) => <li key={`${index}-${warning.slice(0, 30)}`}>{vietnameseWarning(warning)}</li>)}</ul></div>}
                <div className="wh-ai4-card">
                    <div className="wh-ai4-table-header"><h3>So sánh theo nguyên liệu và chi nhánh</h3><label>Tìm nguyên liệu / chi nhánh<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Mã hoặc tên…" /></label></div>
                    <div className="wh-ai4-scroll"><table className="wh-ai4-table"><thead><tr>
                        <th>Chi nhánh</th><th>Nguyên liệu</th><th>Nguồn dự báo</th><th>Nhu cầu B7</th><th>Nhu cầu sử dụng</th><th>Khoảng bất định ML</th><th>Đề xuất giao B7</th><th>Phiên bản / lý do</th>
                    </tr></thead><tbody>{visible.map(row => <tr key={`${row.destinationBranchId}/${row.ingredientId}`}>
                        <td>{row.destinationBranchCode || row.destinationBranchName}</td>
                        <td><strong>{row.ingredientCode ? `${row.ingredientCode} · ` : ''}{row.ingredientName}</strong><small>{row.unit}</small></td>
                        <td><span className={`wh-ai4-origin ${row.source === 'AI2_ML' ? 'is-ml' : ''}`}>{sourceLabel(row.source)}</span></td>
                        <td className="wh-ai4-num">{formatQuantity(row.predictedConsumption)} {row.unit}</td>
                        <td className="wh-ai4-num"><strong>{formatQuantity(row.effectiveDemand)}</strong> {row.unit}</td>
                        <td className="wh-ai4-num">{row.uncertaintyLower !== null && row.uncertaintyUpper !== null
                            ? `${formatQuantity(row.uncertaintyLower)} – ${formatQuantity(row.uncertaintyUpper)} ${row.unit}` : 'Chưa có khoảng'}</td>
                        <td className="wh-ai4-num">{formatQuantity(row.proposedDeliveryQuantity)} {row.unit}</td>
                        <td><small>{row.modelVersion || row.reason || 'Nguồn dự phòng B7'}</small>
                            {row.forecastMethod && <small>B7: {row.forecastMethod}{row.historySamples !== null ? ` · ${row.historySamples} mẫu` : ''}</small>}</td>
                    </tr>)}</tbody></table></div>
                    {visible.length === 0 && <p className="wh-ai4-empty">Không có dòng phù hợp. Thử xóa bộ lọc hoặc chọn nguồn/chi nhánh khác.</p>}
                </div>
                <p className="wh-ai4-footnote">Khoảng bất định do mô hình AI2 cung cấp nếu có; không phải bảo đảm thống kê nếu mô hình chưa được đánh giá trong QA. B7 không cung cấp khoảng bất định ML.</p>
            </>}
        </section>
    );
}
