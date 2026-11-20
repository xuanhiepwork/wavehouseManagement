import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { AuthSession } from '../auth';
import { listCounts, loadBranchList, type BranchItem, type ShiftCount } from '../shift/shift-count.api';
import { formatVnd, importDraft, reviewDraft, type SalesDraft } from '../sales/sales-report';
import { loadBalances, displayQuantity, type BalanceResult, type ForecastPlan } from '../warehouse/warehouse.api';
import { countSummary, dateIsValid, dateOnly, salesSummary, shiftName } from './dashboard.logic';
import './AreaDashboard.css';

type NavTarget = 'shift' | 'reconciliation' | 'planning' | 'inventory';
type Props = {
    session: AuthSession;
    forecastPlan: ForecastPlan | null;
    salesDraft: SalesDraft;
    importedReports: SalesDraft[];
    onImportedReportsChange: (next: SalesDraft[]) => void;
    onNavigate: (target: NavTarget) => void;
};

const LIMIT_BRANCHES = 12;
const MAX_FILES = 30;
const MAX_FILE_BYTES = 500_000;

function readableDate(value: string): string {
    if (!dateIsValid(value)) return value;
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}
function numberText(value: number | null): string {
    return value === null ? 'Chưa có dữ liệu' : new Intl.NumberFormat('vi-VN').format(value);
}
function signedMoney(value: number | null): string {
    if (value === null) return 'Chưa có dữ liệu';
    if (value === 0) return 'Khớp';
    return `${value > 0 ? 'Dư' : 'Thiếu'} ${formatVnd(Math.abs(value))}`;
}
function shiftStatus(status: string): string {
    if (status === 'APPROVED') return 'Đã duyệt';
    if (status === 'SUBMITTED') return 'Chờ duyệt';
    if (status === 'RETURNED') return 'Trả sửa';
    return 'Bản nháp';
}
function trimError(reason: unknown): string {
    return reason instanceof Error ? reason.message : 'Không tải được dữ liệu.';
}

export default function AreaDashboard({ session, forecastPlan, salesDraft, importedReports, onImportedReportsChange, onNavigate }: Props) {
    const isAdmin = session.user.role === 'ADMIN';
    const initialEnd = dateOnly(new Date());
    const [dateTo, setDateTo] = useState(initialEnd);
    const [dateFrom, setDateFrom] = useState(() => {
        const date = new Date();
        date.setDate(date.getDate() - 13);
        return dateOnly(date);
    });
    const [selectedBranch, setSelectedBranch] = useState(isAdmin ? '' : (session.user.branchId ?? ''));
    const [branches, setBranches] = useState<BranchItem[]>([]);
    const [branchesReady, setBranchesReady] = useState(!isAdmin);
    const [branchError, setBranchError] = useState('');
    const [counts, setCounts] = useState<ShiftCount[]>([]);
    const [loadingCounts, setLoadingCounts] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [partialWarning, setPartialWarning] = useState('');
    const [loadedAt, setLoadedAt] = useState('');
    const [balanceResult, setBalanceResult] = useState<BalanceResult | null>(null);
    const [balanceError, setBalanceError] = useState('');
    const [reload, setReload] = useState(0);
    const [importError, setImportError] = useState('');
    const [importNotice, setImportNotice] = useState('');

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        void loadBranchList(session).then(items => {
            if (!active) return;
            setBranches(items);
            setBranchesReady(true);
            setBranchError(items.length > LIMIT_BRANCHES ? `Chỉ lấy tối đa ${LIMIT_BRANCHES} chi nhánh khi xem tất cả; chọn một chi nhánh để xem riêng.` : '');
        }).catch(reason => {
            if (!active) return;
            setBranchesReady(true);
            setBranchError(trimError(reason));
        });
        return () => { active = false; };
    }, [isAdmin, session]);

    useEffect(() => {
        if (!branchesReady) return;
        const chosenIds = isAdmin
            ? selectedBranch ? [selectedBranch] : branches.slice(0, LIMIT_BRANCHES).map(branch => branch.id)
            : session.user.branchId ? [session.user.branchId] : [];
        if (!chosenIds.length) {
            setCounts([]);
            setLoadError(isAdmin ? 'Không có chi nhánh để tải. Kiểm tra API B2.' : 'Tài khoản quản lý chưa được gán chi nhánh.');
            setLoadedAt('');
            return;
        }
        let active = true;
        setLoadingCounts(true);
        setLoadError('');
        setPartialWarning('');
        setCounts([]);
        setLoadedAt('');
        void Promise.allSettled(chosenIds.map(id => listCounts(session, id))).then(results => {
            if (!active) return;
            const gathered: ShiftCount[] = [];
            const failures: string[] = [];
            results.forEach((result, i) => {
                if (result.status === 'fulfilled') gathered.push(...result.value);
                else failures.push(`${chosenIds[i]}: ${trimError(result.reason)}`);
            });
            setCounts(gathered);
            setLoadedAt(new Date().toLocaleString('vi-VN'));
            if (failures.length) setLoadError(`Không tải được ${failures.length}/${chosenIds.length} chi nhánh: ${failures.join(' | ')}`);
            if (isAdmin && !selectedBranch && branches.length > LIMIT_BRANCHES) {
                setPartialWarning(`Chỉ tải ${LIMIT_BRANCHES}/${branches.length} chi nhánh. Hãy chọn từng chi nhánh để kiểm tra.`);
            }
        }).finally(() => { if (active) setLoadingCounts(false); });
        return () => { active = false; };
    }, [branchesReady, branches, isAdmin, reload, selectedBranch, session]);

    useEffect(() => {
        const branch = isAdmin ? selectedBranch : (session.user.branchId ?? '');
        if (!branch) { setBalanceResult(null); setBalanceError(''); return; }
        let active = true;
        setBalanceResult(null);
        setBalanceError('');
        void loadBalances(session, branch).then(data => {
            if (active) setBalanceResult(data);
        }).catch(reason => {
            if (active) setBalanceError(trimError(reason));
        });
        return () => { active = false; };
    }, [isAdmin, selectedBranch, session, reload]);

    const datesValid = dateIsValid(dateFrom) && dateIsValid(dateTo) && dateFrom <= dateTo;
    const dateSpanDays = datesValid ? Math.floor((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) : -1;
    const dateWindowAllowed = datesValid && dateSpanDays <= 92;
    const summary = useMemo(() => dateWindowAllowed ? countSummary(counts, dateFrom, dateTo, selectedBranch) : null, [counts, dateFrom, dateTo, selectedBranch, dateWindowAllowed]);

    const matchingDrafts = useMemo(() => {
        // Current W4 edit takes priority if imported file has the same branch/day/shift.
        const validCurrent = reviewDraft(salesDraft).length === 0;
        const currentKey = `${salesDraft.branchId}:${salesDraft.businessDate}:${salesDraft.shift}`;
        const files = importedReports.filter(item => !(validCurrent && `${item.branchId}:${item.businessDate}:${item.shift}` === currentKey));
        return validCurrent ? [salesDraft, ...files] : files;
    }, [salesDraft, importedReports]);
    const finance = useMemo(() => dateWindowAllowed ? salesSummary(matchingDrafts, dateFrom, dateTo, selectedBranch) : null, [matchingDrafts, dateFrom, dateTo, selectedBranch, dateWindowAllowed]);

    const todayRows = useMemo(() => {
        if (!summary) return [];
        return summary.daily.slice(-12);
    }, [summary]);
    const latestCounts = useMemo(() => counts
        .filter(item => dateWindowAllowed && item.businessDate >= dateFrom && item.businessDate <= dateTo && (!selectedBranch || selectedBranch === item.branchId))
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.shift.localeCompare(a.shift))
        .slice(0, 12), [counts, dateFrom, dateTo, selectedBranch, dateWindowAllowed]);
    const branchMap = useMemo(() => new Map(branches.map(branch => [branch.id, `${branch.code} — ${branch.name}`])), [branches]);
    const planMatchesScope = Boolean(forecastPlan && dateWindowAllowed && forecastPlan.businessDate >= dateFrom && forecastPlan.businessDate <= dateTo);
    const planRows = planMatchesScope ? (forecastPlan?.recommendations ?? []).filter(row => !selectedBranch || row.destinationBranchId === selectedBranch) : [];
    const zeroBalanceRows = balanceResult?.items.filter(item => Number(item.quantity) === 0) ?? [];
    const planGapRows = planRows.filter(row => Number(row.unfulfilledQuantity) > 0);
    const weakSamples = planRows.filter(row => row.forecastMethod !== 'MATCHED_DAY_AND_SHIFT');

    async function importFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        setImportError('');
        setImportNotice('');
        if (!files.length) return;
        if (files.length + importedReports.length > MAX_FILES) {
            setImportError(`Chỉ giữ tối đa ${MAX_FILES} bản nháp trong phiên.`);
            return;
        }
        const result: SalesDraft[] = [];
        try {
            for (const file of files) {
                if (file.size > MAX_FILE_BYTES || !file.name.toLowerCase().endsWith('.json')) throw new Error(`File ${file.name} không phải JSON hợp lệ hoặc lớn hơn 500 KB.`);
                const document: unknown = JSON.parse(await file.text()) as unknown;
                const draft = importDraft(document);
                if (reviewDraft(draft).length) throw new Error(`Báo cáo ${file.name} chưa đủ dữ liệu; hãy hoàn thiện trên W4 trước khi tổng hợp.`);
                if (!isAdmin && draft.branchId !== session.user.branchId) throw new Error(`File ${file.name} không thuộc chi nhánh được phân quyền.`);
                result.push(draft);
            }
            const next = [...importedReports];
            for (const item of result) {
                const key = `${item.branchId}:${item.businessDate}:${item.shift}`;
                const at = next.findIndex(report => `${report.branchId}:${report.businessDate}:${report.shift}` === key);
                if (at >= 0) next[at] = item;
                else next.push(item);
            }
            if (next.length > MAX_FILES) throw new Error(`Vượt giới hạn ${MAX_FILES} báo cáo trong phiên.`);
            onImportedReportsChange(next);
            setImportNotice(`Đã nạp ${result.length} bản nháp W4. Dữ liệu chỉ ở phiên trình duyệt, chưa được duyệt và chưa lưu Aiven.`);
        } catch (reason) {
            setImportError(trimError(reason));
        }
    }

    if (session.user.role === 'STAFF') return <p className="w6-notice">Chỉ quản lý được xem dashboard khu vực.</p>;

    return (
        <section className="w6-root">
            <div className="w6-head">
                <div><div className="w6-eyebrow">BÁO CÁO VẬN HÀNH · W6</div><h2>Dashboard quản lý khu vực</h2><p>Đối chiếu kiểm kê cuối ca, báo cáo bán hàng nháp và kế hoạch bổ sung nguyên liệu.</p></div>
                <span className="w6-mode">{isAdmin ? 'TOÀN HỆ THỐNG / CHI NHÁNH' : 'CHI NHÁNH ĐƯỢC GÁN'}</span>
            </div>
            <div className="w6-note" role="note"><strong>Giới hạn dữ liệu:</strong> phiếu B6 là dữ liệu API nhưng có thể chỉ được tải một trang; doanh thu W4 chỉ là bản nháp trong phiên / file JSON nhập tay, không phải sổ thu chính thức. Không suy diễn sai lệch là hành vi gian lận hoặc lượng nguyên liệu tiêu thụ thực tế.</div>
            <div className="w6-panel w6-filters">
                <label>Chi nhánh
                    {isAdmin ? (
                        <select value={selectedBranch} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedBranch(event.target.value)} disabled={!branchesReady || loadingCounts}>
                            <option value="">Tất cả chi nhánh đã tải (tối đa 12)</option>
                            {branches.map(branch => <option value={branch.id} key={branch.id}>{branch.code} — {branch.name}</option>)}
                        </select>
                    ) : <input readOnly value={session.user.branchId ?? ''} aria-label="Chi nhánh của quản lý" />}
                </label>
                <label>Từ ngày<input type="date" value={dateFrom} onChange={(event: ChangeEvent<HTMLInputElement>) => setDateFrom(event.target.value)} /></label>
                <label>Đến ngày<input type="date" value={dateTo} onChange={(event: ChangeEvent<HTMLInputElement>) => setDateTo(event.target.value)} /></label>
                <button type="button" className="w6-button" onClick={() => setReload(value => value + 1)} disabled={loadingCounts}>{loadingCounts ? 'Đang tải…' : 'Làm mới B6'}</button>
            </div>
            {!dateWindowAllowed && <div className="w6-error" role="alert">Chọn khoảng ngày hợp lệ, tối đa 93 ngày kể cả ngày đầu và cuối.</div>}
            {branchError && <div className="w6-error" role="alert">Chi nhánh: {branchError}</div>}
            {loadError && <div className="w6-error" role="alert">{loadError}</div>}
            {partialWarning && <div className="w6-error" role="note">{partialWarning}</div>}
            <p className="w6-source">{loadingCounts ? 'Đang đọc B6…' : loadedAt ? `B6 tải lúc: ${loadedAt}. Danh sách có thể chưa đủ nếu Backend phân trang.` : 'Chưa có kết quả B6.'}</p>
            <div className="w6-kpis">
                <article className="w6-kpi"><span>Phiếu kiểm kê đọc được</span><strong>{summary ? numberText(summary.total) : '—'}</strong><small>Trong khoảng ngày đã chọn, không suy ra đủ ca</small></article>
                <article className="w6-kpi"><span>Đã duyệt</span><strong>{summary ? numberText(summary.approved) : '—'}</strong><small>Phiếu có trạng thái APPROVED</small></article>
                <article className="w6-kpi"><span>Chờ quản lý duyệt</span><strong>{summary ? numberText(summary.submitted) : '—'}</strong><small>Phiếu có trạng thái SUBMITTED</small></article>
                <article className="w6-kpi"><span>Doanh thu W4 nháp</span><strong>{finance ? formatVnd(finance.netExpected) : '—'}</strong><small>{finance?.rows.length ?? 0} báo cáo hợp lệ, chưa đồng bộ</small></article>
            </div>
            <div className="w6-grid">
                <section className="w6-panel">
                    <div className="w6-panel-head"><h3>Kiểm kê theo trạng thái</h3><button type="button" onClick={() => onNavigate('shift')}>Mở kiểm kê →</button></div>
                    {summary && summary.total > 0 ? (
                        <>
                            <div className="w6-status-bar" role="img" aria-label={`Đã duyệt ${summary.approved}, chờ duyệt ${summary.submitted}, trả sửa ${summary.returned}, nháp ${summary.draft}`}>
                                <span className="w6-approved" style={{ width: `${100 * summary.approved / summary.total}%` }} />
                                <span className="w6-submitted" style={{ width: `${100 * summary.submitted / summary.total}%` }} />
                                <span className="w6-returned" style={{ width: `${100 * summary.returned / summary.total}%` }} />
                                <span className="w6-draft" style={{ width: `${100 * summary.draft / summary.total}%` }} />
                            </div>
                            <div className="w6-legend"><span>● Duyệt: {summary.approved}</span><span>● Chờ: {summary.submitted}</span><span>● Trả sửa: {summary.returned}</span><span>● Nháp: {summary.draft}</span></div>
                            <h4>Những ngày có phiếu trong kết quả</h4>
                            <div className="w6-daily">
                                {todayRows.map(row => <div className="w6-day" key={row.date}>
                                    <span>{readableDate(row.date)}</span>
                                    <div className="w6-day-track"><div className="w6-day-bar" style={{ width: `${100 * row.total / Math.max(...todayRows.map(item => item.total), 1)}%` }} /></div>
                                    <strong>{row.total}</strong>
                                </div>)}
                            </div>
                        </>
                    ) : <p className="w6-empty">{loadingCounts ? 'Đang tải dữ liệu kiểm kê…' : 'Không có phiếu phù hợp trong dữ liệu đã tải.'}</p>}
                </section>
                <section className="w6-panel">
                    <div className="w6-panel-head"><h3>Đối soát doanh thu W4</h3><button type="button" onClick={() => onNavigate('reconciliation')}>Mở đối soát →</button></div>
                    <p className="w6-small">Chỉ sử dụng bản nháp đang chỉnh sửa hoặc JSON do W4 xuất. Báo cáo chưa được quản lý phê duyệt.</p>
                    <label className="w6-upload">Nhập các file báo cáo W4 đã xuất JSON
                        <input type="file" accept=".json,application/json" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { void importFiles(event); }} />
                    </label>
                    {importError && <p className="w6-error" role="alert">{importError}</p>}
                    {importNotice && <p className="w6-success" role="status">{importNotice}</p>}
                    <div className="w6-finance-list">
                        <div><span>Số ly bán có đủ dữ liệu</span><strong>{numberText(finance?.cups ?? null)}</strong></div>
                        <div><span>Tiền ghi nhận theo kênh</span><strong>{formatVnd(finance?.recordedReceipts ?? null)}</strong></div>
                        <div><span>Chênh lệch doanh thu</span><strong>{signedMoney(finance?.salesDifference ?? null)}</strong></div>
                        <div><span>Chênh lệch kiểm tiền mặt</span><strong>{signedMoney(finance?.cashDifference ?? null)}</strong></div>
                    </div>
                    <p className="w6-small">{importedReports.length} bản nháp JSON trong phiên. {finance?.skipped ? `${finance.skipped} bản trùng/không hợp lệ được loại khỏi tổng hợp.` : 'Không có báo cáo trùng trong khoảng lọc.'}</p>
                    {!!importedReports.length && <button className="w6-text-button" type="button" onClick={() => { onImportedReportsChange([]); setImportNotice('Đã xóa báo cáo JSON khỏi phiên hiện tại.'); }}>Xóa dữ liệu JSON đã nhập khỏi phiên</button>}
                </section>
            </div>
            <div className="w6-grid">
                <section className="w6-panel">
                    <div className="w6-panel-head"><h3>Phiếu kiểm kê gần đây</h3><button type="button" onClick={() => onNavigate('shift')}>Xem chi tiết →</button></div>
                    {latestCounts.length ? <div className="w6-table-scroll"><table className="w6-table"><thead><tr><th>Ngày</th><th>Chi nhánh</th><th>Ca</th><th>Trạng thái</th></tr></thead><tbody>{latestCounts.map(item => <tr key={item.id}><td>{readableDate(item.businessDate)}</td><td>{branchMap.get(item.branchId) ?? (item.branchId === session.user.branchId ? 'Chi nhánh đang đăng nhập' : item.branchId)}</td><td>{shiftName(item.shift)}</td><td><span className={`w6-tag w6-${item.status.toLowerCase()}`}>{shiftStatus(item.status)}</span></td></tr>)}</tbody></table></div> : <p className="w6-empty">Chưa có phiếu nào trong khoảng đã chọn.</p>}
                </section>
                <section className="w6-panel">
                    <div className="w6-panel-head"><h3>Kế hoạch bổ sung nguyên liệu B7</h3>{isAdmin && <button type="button" onClick={() => onNavigate('planning')}>Mở đề xuất →</button>}</div>
                    {!isAdmin ? <p className="w6-empty">Dự báo toàn hệ thống chỉ dành cho ADMIN.</p> : !forecastPlan ? <p className="w6-empty">Chưa tải kế hoạch B7 trong phiên. Mở “Đề xuất bổ sung” để chọn kho nguồn, chi nhánh nhận, ngày và ca.</p> : !planMatchesScope ? <p className="w6-empty">Kế hoạch B7 đã tải không nằm trong khoảng ngày đang lọc. Hãy đổi khoảng ngày hoặc tải kế hoạch mới.</p> : <>
                        <p className="w6-small">Kế hoạch {readableDate(forecastPlan.businessDate)} · {shiftName(forecastPlan.shift)} · Tải lúc {new Date(forecastPlan.fetchedAt).toLocaleString('vi-VN')}.</p>
                        <div className="w6-finance-list"><div><span>Dòng nguyên liệu được đề xuất</span><strong>{planRows.length}</strong></div><div><span>Dòng kho không đủ cấp</span><strong>{planGapRows.length}</strong></div><div><span>Dòng dùng ước tính ít mẫu</span><strong>{weakSamples.length}</strong></div></div>
                        <p className="w6-small">Không cộng số lượng nguyên liệu khác đơn vị. Dự báo cần kho xác minh trước khi giao.</p>
                    </>}
                </section>
            </div>
            <section className="w6-panel">
                <div className="w6-panel-head"><h3>Đối chiếu tồn kho B3</h3><button type="button" onClick={() => onNavigate('inventory')}>Mở bảng tồn kho →</button></div>
                <p className="w6-small">Chỉ đọc số dư nguyên liệu của một chi nhánh; không cộng gram, ml và đơn vị piece vào cùng một tổng.</p>
                {isAdmin && !selectedBranch ? <p className="w6-empty">Chọn một chi nhánh ở bộ lọc để xem tồn kho B3. Không cộng dồn tồn của cả chuỗi.</p> : balanceError ? <p className="w6-error" role="alert">Không tải được B3: {balanceError}</p> : !balanceResult ? <p className="w6-empty">Đang tải số dư B3 hoặc chưa có dữ liệu.</p> : <>
                    <div className="w6-balance-stats"><div><span>Số dòng nguyên liệu đã đọc</span><strong>{balanceResult.items.length}</strong></div><div><span>Dòng có số dư bằng 0</span><strong>{zeroBalanceRows.length}</strong></div></div>
                    {balanceResult.paginationWarning && <p className="w6-small">⚠ {balanceResult.paginationWarning}</p>}
                    {zeroBalanceRows.length ? <div className="w6-table-scroll"><table className="w6-table"><thead><tr><th>Mã nguyên liệu</th><th>Tên nguyên liệu</th><th>Số dư</th></tr></thead><tbody>{zeroBalanceRows.slice(0, 8).map(item => <tr key={item.ingredientId}><td>{item.code || '—'}</td><td>{item.name}</td><td>{displayQuantity(item.quantity)} {item.unit}</td></tr>)}</tbody></table></div> : <p className="w6-small">Không có dòng tồn bằng 0 trong kết quả được trả về. Chưa thể khẳng định không có thiếu hàng nếu API phân trang hoặc không trả những nguyên liệu chưa có dòng số dư.</p>}
                </>}
            </section>
            <section className="w6-panel">
                <h3>Báo cáo doanh thu đã nhập trong phiên</h3>
                {!finance?.rows.length ? <p className="w6-empty">Chưa có báo cáo W4 đầy đủ trong khoảng ngày/chi nhánh đã chọn.</p> : <div className="w6-table-scroll"><table className="w6-table"><thead><tr><th>Ngày</th><th>Chi nhánh</th><th>Ca</th><th>Số ly</th><th>Doanh thu nháp</th><th>Chênh lệch bán hàng</th><th>Chênh lệch tiền mặt</th></tr></thead><tbody>{finance.rows.map(row => <tr key={row.key}><td>{readableDate(row.businessDate)}</td><td>{branchMap.get(row.branchId) ?? (row.branchName || row.branchId)}</td><td>{shiftName(row.shift)}</td><td>{numberText(row.soldCups)}</td><td>{formatVnd(row.netExpected)}</td><td>{signedMoney(row.salesDifference)}</td><td>{signedMoney(row.cashDifference)}</td></tr>)}</tbody></table></div>}
                <p className="w6-small">Chênh lệch là tín hiệu cần kiểm tra chứng từ, không phải kết luận sai phạm. Để so sánh định lượng pha chế cần dữ liệu số ly bán, công thức nguyên liệu và biến động tồn trong ca; W6 chưa có đủ dữ liệu này.</p>
            </section>
        </section>
    );
}
