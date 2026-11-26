import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import {
    calculateReceiving, confirmReceipt, createReceipt, getReceivingBranches, getTransferReceiving,
    isBranchId, listPostedTransfers, ReceivingApiError, updateReceipt, validQuantity,
    type BranchOption, type ReceivingDetails, type ReceivingFilter, type ReceivingInput,
    type ReceivingPageResult,
} from './receiving.api';
import './ReceivingPage.css';

type Entry = { received: string; damaged: string; note: string };
type Props = {
    session: AuthSession;
    onUnsavedChange?: (value: boolean) => void;
    onWorkingChange?: (value: boolean) => void;
    initialTransferId?: string | null;
    initialRequest?: number;
};
const statusName = { AWAITING_RECEIVING: 'Chưa xác nhận nhận hàng', DRAFT: 'Biên bản nháp', CONFIRMED: 'Đã xác nhận nhận hàng' };
function message(error: unknown): string { return error instanceof Error ? error.message : 'Không thể hoàn tất yêu cầu.'; }
function showQuantity(value: string): string {
    // Group only the integer part; keep all six decimal places exact.
    const [whole = '0', fraction = ''] = value.split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (trimmed ? ',' + trimmed : '');
}
function showDate(value: string | null): string {
    if (!value) return 'Chưa có';
    return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function localDateTime(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

export default function ReceivingPage({ session, onUnsavedChange, onWorkingChange, initialTransferId, initialRequest = 0 }: Props) {
    const isAdmin = session.user.role === 'ADMIN';
    const [branchId, setBranchId] = useState(session.user.branchId ?? '');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<ReceivingFilter>('ALL');
    const [listing, setListing] = useState<ReceivingPageResult | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const [details, setDetails] = useState<ReceivingDetails | null>(null);
    const [entries, setEntries] = useState<Record<string, Entry>>({});
    const [note, setNote] = useState('');
    const [physicalReceivedAt, setPhysicalReceivedAt] = useState('');
    const [legacyEvidence, setLegacyEvidence] = useState('');
    const [dirty, setDirty] = useState(false);
    const [working, setWorking] = useState(false);
    const [listLoading, setListLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [branchLoading, setBranchLoading] = useState(isAdmin);
    const [listError, setListError] = useState('');
    const [branchError, setBranchError] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [requiresReload, setRequiresReload] = useState(false);
    const [listRevision, setListRevision] = useState(0);
    const [detailRevision, setDetailRevision] = useState(0);
    const writeInFlight = useRef(false);
    const openedFromLink = useRef<string | null>(null);
    const editorSnapshot = JSON.stringify({ branchId, selectedId, entries, note, physicalReceivedAt, legacyEvidence });
    const editorSnapshotRef = useRef(editorSnapshot);
    const sessionRef = useRef(session);
    const dirtyRef = useRef(dirty);
    useEffect(() => { editorSnapshotRef.current = editorSnapshot; }, [editorSnapshot]);
    useEffect(() => { sessionRef.current = session; }, [session]);
    useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
    const pendingReconciliation = requiresReload && Boolean(details) && Boolean(error);

    useEffect(() => {
        const requestKey = `${initialTransferId}:${initialRequest}`;
        if (!initialTransferId || requestKey === openedFromLink.current || writeInFlight.current) return;
        if (dirtyRef.current && !window.confirm('Có biên bản chưa lưu. Bỏ thay đổi để mở phiếu chuyển kho được chọn?')) return;
        const expectedEditor = editorSnapshotRef.current;
        let active = true;
        void getTransferReceiving(sessionRef.current, initialTransferId).then(data => {
            if (!active) return;
            if (editorSnapshotRef.current !== expectedEditor) {
                setError('Biểu mẫu đã thay đổi trong lúc tải liên kết. Dữ liệu đang nhập được giữ; hãy mở lại phiếu từ danh sách khi sẵn sàng.');
                return;
            }
            openedFromLink.current = requestKey;
            // G2: server verifies destination against today's scheduled branch/area.
            setBranchId(data.transfer.destinationBranchId); setSelectedId(initialTransferId); setDetailRevision(value => value + 1);
        }).catch(cause => { if (active) setError(message(cause)); });
        return () => { active = false; };
        // Opening a link is explicit; token-only refresh does not discard this editor.
    }, [initialTransferId, initialRequest, session.user.id]);

    useEffect(() => { onUnsavedChange?.(dirty || pendingReconciliation); }, [dirty, pendingReconciliation, onUnsavedChange]);
    useEffect(() => { onWorkingChange?.(working); }, [working, onWorkingChange]);
    useEffect(() => () => { onUnsavedChange?.(false); onWorkingChange?.(false); }, [onUnsavedChange, onWorkingChange]);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (dirty || working || pendingReconciliation) { event.preventDefault(); event.returnValue = ''; }
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [dirty, working, pendingReconciliation]);

    useEffect(() => {
        let active = true;
        void Promise.resolve().then(() => {
            if (!active) return null;
            setBranchLoading(true);
            return getReceivingBranches(session);
        }).then(items => {
            if (!items) return;
            if (!active) return;
            setBranches(items); setBranchError('');
            // An explicit incoming-transfer link determines its destination; do not race it with a default branch.
            setBranchId(current => items.some(item => item.id === current) ? current : (initialTransferId ? '' : items[0]?.id || ''));
        }).catch(cause => { if (active) setBranchError(message(cause)); })
            .finally(() => { if (active) setBranchLoading(false); });
        return () => { active = false; };
    }, [session, initialTransferId]);

    useEffect(() => {
        let active = true;
        void Promise.resolve().then(() => {
            if (!active) return null;
            setListing(null); setListError('');
            if (!isBranchId(branchId)) { setListLoading(false); return null; }
            setListLoading(true);
            return listPostedTransfers(session, branchId, page, filter);
        }).then(result => {
            if (active && result) setListing(result);
        }).catch(cause => { if (active) setListError(message(cause)); })
            .finally(() => { if (active) setListLoading(false); });
        return () => { active = false; };
    }, [session, branchId, page, filter, listRevision]);

    useEffect(() => {
        let active = true;
        void Promise.resolve().then(() => {
            if (!active) return null;
            setDetails(null); setEntries({}); setNote(''); setPhysicalReceivedAt(''); setLegacyEvidence(''); setDirty(false); setNotice(''); setError('');
            if (!selectedId) { setDetailLoading(false); setRequiresReload(false); return null; }
            setDetailLoading(true); setRequiresReload(true);
            return getTransferReceiving(sessionRef.current, selectedId);
        }).then(data => {
            if (!active || !data) return;
            if (data.transfer.id !== selectedId || data.transfer.destinationBranchId !== branchId) throw new Error('Phiếu không thuộc chi nhánh nhận đã chọn.');
            setDetails(data);
            setEntries(Object.fromEntries((data.receipt?.items ?? data.transfer.items).map(item => {
                const saved = data.receipt?.items.find(line => line.ingredientId === item.ingredientId);
                return [item.ingredientId, { received: saved?.receivedQuantity ?? '', damaged: saved?.damagedQuantity ?? '0', note: saved?.discrepancyReason ?? '' }];
            })));
            setNote(data.receipt?.note ?? ''); setRequiresReload(false);
            setPhysicalReceivedAt(localDateTime(data.receipt?.physicalReceivedAt)); setLegacyEvidence(data.receipt?.legacyEvidence ?? '');
        }).catch(cause => { if (active) setError(message(cause)); })
            .finally(() => { if (active) setDetailLoading(false); });
        return () => { active = false; };
    // Reauthenticating the same account must not replace an unsaved receiving editor.
    }, [session.user.id, selectedId, branchId, detailRevision]);

    const rows = useMemo(() => (details?.receipt?.items ?? details?.transfer.items ?? []).map(item => {
        const entry = entries[item.ingredientId] ?? { received: '', damaged: '0', note: '' };
        let problem = '';
        let calculations: ReturnType<typeof calculateReceiving> | null = null;
        if (!validQuantity(entry.received, item.unit) || !validQuantity(entry.damaged, item.unit)) {
            problem = 'Nhập số không âm, tối đa 6 số lẻ; piece phải nguyên.';
        } else {
            try {
                calculations = calculateReceiving(entry.received, entry.damaged, item.plannedQuantity);
                if (calculations.hasDiscrepancy && !entry.note.trim()) problem = 'Cần giải thích thiếu, thừa hoặc hỏng.';
            } catch (cause) { problem = message(cause); }
        }
        return { ...item, entry, calculations, problem };
    }), [details, entries]);
    const legacyComplete = !details?.transfer.legacyReceivingRequired || (Boolean(legacyEvidence.trim())
        && Number.isFinite(Date.parse(physicalReceivedAt)));
    const complete = rows.length > 0 && rows.every(row => !row.problem) && legacyComplete;
    const readOnly = details?.receipt?.status === 'CONFIRMED' || requiresReload || working || detailLoading ||
        details?.transfer.id !== selectedId || details?.transfer.destinationBranchId !== branchId ||
        !(details?.allowedActions.canCreate || details?.allowedActions.canEdit);
    const canSave = complete && !readOnly && Boolean(details?.allowedActions.canCreate || details?.allowedActions.canEdit);
    const canConfirm = complete && !dirty && !readOnly && Boolean(details?.receipt && details.allowedActions.canConfirm);
    const issueCount = rows.filter(row => row.calculations?.hasDiscrepancy).length;

    function discardAllowed(): boolean {
        return !writeInFlight.current && (!dirty || window.confirm('Có thay đổi chưa lưu. Bỏ thay đổi để mở dữ liệu khác?'));
    }
    function changeScope(action: () => void) {
        if (!discardAllowed()) return;
        setSelectedId(''); setDetails(null); setDirty(false); onUnsavedChange?.(false); action();
    }
    function edit(ingredientId: string, field: keyof Entry, value: string) {
        if (readOnly) return;
        setEntries(current => ({ ...current, [ingredientId]: {
            received: current[ingredientId]?.received ?? '', damaged: current[ingredientId]?.damaged ?? '0',
            note: current[ingredientId]?.note ?? '', [field]: value,
        } }));
        setDirty(true); onUnsavedChange?.(true); setNotice('');
    }
    function acceptSaved(data: ReceivingDetails) {
        if (data.transfer.id !== selectedId || data.transfer.destinationBranchId !== branchId) {
            throw new ReceivingApiError('Phản hồi không khớp phiếu nhận. Tải lại biên bản.', 0, 'INVALID_RESPONSE', true);
        }
        setDetails(data);
        setEntries(Object.fromEntries((data.receipt?.items ?? []).map(item => [item.ingredientId, {
            received: item.receivedQuantity, damaged: item.damagedQuantity, note: item.discrepancyReason ?? '',
        }])));
        setNote(data.receipt?.note ?? ''); setDirty(false); onUnsavedChange?.(false); setRequiresReload(false); setListRevision(value => value + 1);
        setPhysicalReceivedAt(localDateTime(data.receipt?.physicalReceivedAt)); setLegacyEvidence(data.receipt?.legacyEvidence ?? '');
    }
    async function persist(confirm: boolean) {
        if (!details || writeInFlight.current || (confirm ? !canConfirm : !canSave)) return;
        if (details.transfer.legacyReceivingRequired && Date.parse(physicalReceivedAt) > Date.now()) {
            setError('Ngày nhận thực tế không được ở tương lai.');
            return;
        }
        if (confirm && !window.confirm('Xác nhận số thực nhận và số hỏng đã lưu? Biên bản sẽ khóa chỉnh sửa. Thao tác này không thay đổi tồn kho.')) return;
        writeInFlight.current = true; setWorking(true); onWorkingChange?.(true); setError(''); setNotice('');
        try {
            let result: ReceivingDetails;
            if (confirm && details.receipt) {
                result = await confirmReceipt(session, details.receipt.id, details.receipt.version);
            } else {
                const input: ReceivingInput = { note: note.trim(), ...(details.transfer.legacyReceivingRequired ? {
                    physicalReceivedAt: new Date(physicalReceivedAt).toISOString(), legacyEvidence: legacyEvidence.trim(),
                } : {}), items: rows.map(row => ({
                    ingredientId: row.ingredientId, receivedQuantity: row.entry.received,
                    damagedQuantity: row.entry.damaged, discrepancyReason: row.entry.note.trim() || null,
                })) };
                result = details.receipt
                    ? await updateReceipt(session, details.receipt.id, details.receipt.version, input)
                    : await createReceipt(session, details.transfer.id, input);
            }
            acceptSaved(result);
            setNotice(confirm ? 'Đã xác nhận nhận hàng. Tồn kho không thay đổi.' : 'Đã lưu biên bản nháp lên máy chủ.');
        } catch (cause) {
            setError(message(cause));
            if (!(cause instanceof ReceivingApiError) || cause.outcomeUnknown || [401, 403, 404, 409].includes(cause.status)) setRequiresReload(true);
        } finally { writeInFlight.current = false; setWorking(false); onWorkingChange?.(false); }
    }
    function reloadDetails() {
        if (!discardAllowed()) return;
        setDetails(null); setRequiresReload(true); setDirty(false); onUnsavedChange?.(false);
        setDetailRevision(value => value + 1); setListRevision(value => value + 1);
    }
    function exportReport() {
        if (!details) return;
        const report = {
            reportType: 'WAVEHOUSE_TRANSFER_RECEIVING_BACKUP', schemaVersion: 2,
            exportedAt: new Date().toISOString(), adjustsInventory: false,
            persistedToBackend: Boolean(details.receipt) && !dirty && !requiresReload,
            serverDocument: details,
            localDraft: { note, physicalReceivedAt, legacyEvidence, items: rows.map(row => ({ ingredientId: row.ingredientId,
                receivedQuantity: row.entry.received, damagedQuantity: row.entry.damaged,
                discrepancyReason: row.entry.note, calculations: row.calculations })) },
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url;
        link.download = 'wavehouse-nhan-hang-' + details.transfer.code + '.json'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice('Đã xuất bản sao JSON. Việc xuất file không lưu hay xác nhận thay cho thao tác trên máy chủ.');
    }

    return <section className="w3-page">
        <div className="w3-heading">
            <div><p className="w3-eyebrow">WAVEHOUSE / ĐẦU CA</p><h2>Nhận nguyên liệu chuyển kho</h2>
                <p>Kiểm đếm, lưu nháp và xác nhận hàng nhận tại chi nhánh.</p></div>
            <span className="w3-label">GIAO NHẬN</span>
        </div>
        <div className="w3-alert w3-warning" role="note">
            Tồn kho đã được ghi khi phiếu chuyển kho POSTED. Ký nhận chỉ lưu số thực nhận; thiếu và hỏng sẽ được đối soát bằng kiểm kê B6.
            Phiếu POSTED chưa có biên bản không có nghĩa là đã nhận hàng.
        </div>
        <div className="w3-panel w3-controls">
            <div className="w3-field"><label htmlFor="w3-branch">Chi nhánh nhận hàng</label>
                {branches.length ? <select id="w3-branch" value={branchId} disabled={working || branchLoading}
                    onChange={event => changeScope(() => { setBranchId(event.target.value); setPage(1); })}>
                    {branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                </select> : <input id="w3-branch" value={branchId} readOnly={!isAdmin} disabled={working || branchLoading}
                    placeholder="UUID chi nhánh nhận" onChange={event => changeScope(() => { setBranchId(event.target.value); setPage(1); })} />}
            </div>
            <div className="w3-field"><label htmlFor="w3-status">Danh sách</label>
                <select id="w3-status" value={filter} disabled={working}
                    onChange={event => changeScope(() => { setFilter(event.target.value as ReceivingFilter); setPage(1); })}>
                    <option value="ALL">Tất cả phiếu chuyển kho POSTED</option><option value="DRAFT">Biên bản nháp</option>
                    <option value="CONFIRMED">Biên bản đã xác nhận</option>
                </select>
            </div>
            <button type="button" className="w3-button w3-outline" disabled={working || listLoading}
                onClick={() => setListRevision(value => value + 1)}>Tải lại danh sách</button>
        </div>
        {branchError && <p className="w3-alert w3-error" role="alert">{branchError}</p>}
        {!isBranchId(branchId) && <p className="w3-alert w3-error">Chọn chi nhánh hợp lệ trước khi tải phiếu.</p>}
        {listError && <p className="w3-alert w3-error" role="alert">{listError}</p>}
        <div className="w3-panel">
            <div className="w3-panel-heading"><h3>Phiếu giao cho chi nhánh</h3>
                <span>{listLoading ? 'Đang tải…' : (listing?.total ?? 0) + ' phiếu'}</span></div>
            {listLoading ? <p role="status">Đang tải danh sách phiếu…</p> : listing?.items.length ? <div className="w3-transfer-list">
                {listing.items.map(item => <button type="button" key={item.id}
                    className={'w3-transfer-choice' + (selectedId === item.id ? ' is-selected' : '')}
                    disabled={working || detailLoading} aria-pressed={selectedId === item.id}
                    onClick={() => { if (discardAllowed()) {
                        setDetails(null); setRequiresReload(true); setDirty(false); onUnsavedChange?.(false);
                        setSelectedId(item.id); if (selectedId === item.id) setDetailRevision(value => value + 1);
                    } }}>
                    <strong>{item.number}</strong><span>{showDate(item.postedAt)}</span>
                    {item.legacyReceivingRequired && <span>Chuyển kho lịch sử — cần đối chiếu</span>}
                    <span>{item.receipt ? statusName[item.receipt.status] : statusName.AWAITING_RECEIVING}</span>
                </button>)}
            </div> : !listError && <p className="w3-empty">Không có phiếu trong trang và bộ lọc hiện tại.</p>}
            <div className="w3-pagination">
                <button type="button" className="w3-button w3-outline" disabled={working || listLoading || page <= 1}
                    onClick={() => changeScope(() => setPage(value => value - 1))}>Trang trước</button>
                <span>Trang {page}/{listing?.totalPages ?? 1} · 50 phiếu/trang</span>
                <button type="button" className="w3-button w3-outline" disabled={working || listLoading || !listing || page >= listing.totalPages}
                    onClick={() => changeScope(() => setPage(value => value + 1))}>Trang sau</button>
            </div>
        </div>
        {error && <div className="w3-alert w3-error" role="alert">{error}</div>}
        {notice && <div className="w3-alert w3-success" role="status">{notice}</div>}
        {selectedId && <button type="button" className="w3-button w3-outline" disabled={working || detailLoading} onClick={reloadDetails}>Tải lại biên bản từ máy chủ</button>}
        {detailLoading && <p className="w3-panel" role="status">Đang tải biên bản nhận hàng…</p>}
        {details && <>
            <div className="w3-summary">
                <div><span>Phiếu chuyển kho</span><strong>{details.transfer.code}</strong></div>
                <div><span>Nguồn giao</span><strong>{details.transfer.sourceBranch.code} — {details.transfer.sourceBranch.name}</strong></div>
                <div><span>Chi nhánh nhận</span><strong>{details.transfer.destinationBranch.code} — {details.transfer.destinationBranch.name}</strong></div>
                <div><span>Trạng thái nhận</span><strong>{statusName[details.receivingStatus]}</strong><span>Đã hạch toán B5: {showDate(details.transfer.postedAt)}</span></div>
            </div>
            {requiresReload && <p className="w3-alert w3-warning">Tạm khóa thao tác ghi. Xuất JSON nếu cần giữ nội dung đang nhập, sau đó tải lại biên bản để đối chiếu kết quả.</p>}
            {details.transfer.legacyReceivingRequired && <div className="w3-panel w3-notes">
                <h3>Đối chiếu chuyển kho lịch sử</h3>
                <p>ADMIN hoặc quản lý chi nhánh nhận xác minh số thực nhận và hỏng từ chứng từ. Không biết số lượng hoặc chưa rõ hàng đã giao thì giữ chưa xác nhận; không suy từ lượng theo phiếu.</p>
                <label htmlFor="w3-physical-date">Ngày giờ đã nhận thực tế (giờ thiết bị)</label>
                <input id="w3-physical-date" type="datetime-local" step="1" value={physicalReceivedAt} disabled={readOnly}
                    onChange={event => { setPhysicalReceivedAt(event.target.value); setDirty(true); onUnsavedChange?.(true); setNotice(''); }} />
                <label htmlFor="w3-evidence">Tham chiếu chứng từ và nội dung xác minh (bắt buộc)</label>
                <textarea id="w3-evidence" rows={3} maxLength={1000} value={legacyEvidence} disabled={readOnly}
                    onChange={event => { setLegacyEvidence(event.target.value); setDirty(true); onUnsavedChange?.(true); setNotice(''); }} />
                {!legacyComplete && <p className="w3-field-error">Cần bằng chứng và ngày nhận hợp lệ trước khi lưu. Ngày tương lai sẽ bị từ chối khi lưu.</p>}
                <p>Thời điểm xác nhận và người xác nhận được ghi riêng khi khóa biên bản. Đối chiếu lịch sử không thay đổi tồn kho.</p>
            </div>}
            <div className="w3-panel">
                <div className="w3-panel-heading"><div><h3>Kiểm đếm hàng thực nhận</h3>
                    <p>Thực nhận bao gồm hàng hỏng. Nhập 0 nếu không nhận được; để trống nghĩa là chưa kiểm đếm.</p></div>
                    <span className="w3-progress">{rows.filter(row => !row.problem).length}/{rows.length} dòng hợp lệ</span>
                </div>
                <div className="w3-table-wrap"><table className="w3-table w3-receiving-table">
                    <thead><tr><th>Mã / nguyên liệu</th><th>ĐVT</th><th>Theo phiếu</th><th>Thực nhận</th><th>Hỏng</th>
                        <th>Dùng được</th><th>Thiếu</th><th>Thừa</th><th>Giải thích chênh lệch</th></tr></thead>
                    <tbody>{rows.map(row => <tr key={row.ingredientId}>
                        <td><strong>{row.code}</strong><br />{row.name}</td><td>{row.unit}</td>
                        <td className="w3-amount">{showQuantity(row.plannedQuantity)}</td>
                        <td><input aria-label={'Thực nhận ' + row.name} value={row.entry.received} disabled={readOnly}
                            inputMode="decimal" placeholder="Chưa đếm" onChange={event => edit(row.ingredientId, 'received', event.target.value)} /></td>
                        <td><input aria-label={'Hỏng ' + row.name} value={row.entry.damaged} disabled={readOnly}
                            inputMode="decimal" onChange={event => edit(row.ingredientId, 'damaged', event.target.value)} /></td>
                        <td className="w3-amount">{row.calculations ? showQuantity(row.calculations.usableQuantity) : '—'}</td>
                        <td className="w3-amount">{row.calculations ? showQuantity(row.calculations.shortageQuantity) : '—'}</td>
                        <td className="w3-amount">{row.calculations ? showQuantity(row.calculations.overageQuantity) : '—'}</td>
                        <td><input aria-label={'Giải thích ' + row.name} value={row.entry.note} maxLength={300} disabled={readOnly}
                            placeholder={row.calculations?.hasDiscrepancy ? 'Bắt buộc giải thích' : 'Không bắt buộc'} onChange={event => edit(row.ingredientId, 'note', event.target.value)} />
                            {row.problem && !readOnly && <small className="w3-field-error">{row.problem}</small>}</td>
                    </tr>)}</tbody>
                </table></div>
                <p className="w3-footnote">Chênh lệch là thông tin cần đối chiếu, không tự chứng minh lỗi của người giao hoặc người nhận.</p>
            </div>
            <div className="w3-bottom">
                <div className="w3-panel w3-notes"><label htmlFor="w3-note">Ghi chú toàn biên bản</label>
                    <textarea id="w3-note" value={note} maxLength={500} rows={4} disabled={readOnly}
                        onChange={event => { setNote(event.target.value); setDirty(true); onUnsavedChange?.(true); setNotice(''); }} />
                    {dirty && <p>Đang có thay đổi chưa lưu trên máy chủ.</p>}
                    {details.receipt && <p>Biên bản: {details.receipt.id}<br />Phiên bản: {details.receipt.version}<br />
                        Người lập: {details.receipt.createdById}<br />Cập nhật: {showDate(details.receipt.updatedAt)}</p>}
                    {details.receipt?.status === 'CONFIRMED' && <p>Người xác nhận: {details.receipt.receivedById}<br />
                        Xác nhận lúc: {showDate(details.receipt.confirmedAt)}. Biên bản đã khóa chỉnh sửa.</p>}
                </div>
                <div className="w3-panel w3-export">
                    <h3>Lưu và xác nhận</h3>
                    <div className="w3-summary-line"><span>Dòng thiếu / thừa / hỏng</span><strong>{issueCount}</strong></div>
                    {details.receipt?.status !== 'CONFIRMED' && <div className="w3-action-stack">
                        <button type="button" className="w3-button w3-primary" disabled={!canSave} onClick={() => { void persist(false); }}>
                            {working ? 'Đang xử lý…' : details.receipt ? 'Lưu chỉnh sửa' : 'Lưu biên bản nháp'}</button>
                        <button type="button" className="w3-button w3-primary" disabled={!canConfirm} onClick={() => { void persist(true); }}>{details.transfer.legacyReceivingRequired ? 'Xác nhận đối chiếu lịch sử' : 'Xác nhận nhận hàng'}</button>
                        <small>Nhập đủ lượng hợp lệ và giải thích để lưu nháp. Lưu mọi thay đổi trước khi xác nhận.</small>
                    </div>}
                    <button type="button" className="w3-button w3-outline" onClick={exportReport}>Xuất bản sao JSON</button>
                    <p className="w3-warning-text">Lưu nháp và xác nhận đều không cộng hoặc trừ tồn. B6 chỉ chốt sau khi mọi chuyển kho đến đã được xác nhận nhận.</p>
                </div>
            </div>
        </>}
    </section>;
}
