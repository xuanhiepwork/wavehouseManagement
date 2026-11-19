import { useEffect, useMemo, useState } from 'react';
import type { AuthSession } from '../auth';
import {
    deltaQuantity,
    getReceivingBranches,
    getTransferDetails,
    lessOrEqual,
    listPostedTransfers,
    validQuantity,
    type BranchOption,
    type TransferDetails,
    type TransferSummary,
} from './receiving.api';
import './ReceivingPage.css';

type ReceivedLine = { received: string; damaged: string; note: string };
const STATUS = 'POSTED';

function formatQuantity(value: string): string {
    const n = Number(value);
    return Number.isFinite(n)
        ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(n)
        : value;
}
function formatDate(value: string | null): string {
    if (!value) return 'Không có thời điểm';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
    }).format(date);
}
function message(error: unknown): string {
    return error instanceof Error ? error.message : 'Có lỗi không xác định. Vui lòng thử tải lại.';
}
function transferFilename(id: string): string {
    return `wavehouse-doi-chieu-nhan-hang-${id.slice(0, 8)}.json`;
}

export default function ReceivingPage({ session }: { session: AuthSession }) {
    const isAdmin = session.user.role === 'ADMIN';
    const [branchId, setBranchId] = useState(session.user.branchId ?? '');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [transfers, setTransfers] = useState<TransferSummary[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [transfer, setTransfer] = useState<TransferDetails | null>(null);
    const [entries, setEntries] = useState<Record<string, ReceivedLine>>({});
    const [overallNote, setOverallNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        void getReceivingBranches(session).then(list => {
            if (!active) return;
            setBranches(list);
            setBranchId(previous => previous || list[0]?.id || '');
        }).catch(cause => {
            if (active) setError(message(cause));
        });
        return () => { active = false; };
    }, [session, isAdmin]);

    useEffect(() => {
        setTransfers([]);
        setSelectedId('');
        setTransfer(null);
        setEntries({});
        setOverallNote('');
        if (!branchId) return;
        let active = true;
        setBusy(true);
        setError('');
        setNotice('');
        void listPostedTransfers(session, branchId).then(result => {
            if (active) setTransfers(result);
        }).catch(cause => {
            if (active) setError(message(cause));
        }).finally(() => {
            if (active) setBusy(false);
        });
        return () => { active = false; };
    }, [session, branchId, version]);

    useEffect(() => {
        setTransfer(null);
        setEntries({});
        setOverallNote('');
        if (!selectedId) return;
        let active = true;
        setError('');
        setNotice('');
        setLoadingDetail(true);
        void getTransferDetails(session, selectedId).then(detail => {
            if (!active) return;
            if (detail.status !== STATUS || detail.destinationBranchId !== branchId) {
                setError('Phiếu không thuộc chi nhánh nhận hoặc chưa ở trạng thái POSTED.');
                return;
            }
            setTransfer(detail);
            setEntries(Object.fromEntries(detail.items.map(item => [item.ingredientId, {
                received: '', damaged: '0', note: '',
            }])));
        }).catch(cause => {
            if (active) setError(message(cause));
        }).finally(() => {
            if (active) setLoadingDetail(false);
        });
        return () => { active = false; };
    }, [session, selectedId, branchId]);

    const review = useMemo(() => {
        if (!transfer) return { counted: 0, total: 0, issues: 0, complete: false };
        let counted = 0;
        let issues = 0;
        let complete = true;
        for (const item of transfer.items) {
            const entry = entries[item.ingredientId];
            const good = entry && validQuantity(entry.received, item.unit)
                && validQuantity(entry.damaged, item.unit)
                && lessOrEqual(entry.damaged, entry.received);
            if (!good) { complete = false; continue; }
            counted++;
            const delta = deltaQuantity(entry.received, item.plannedQuantity);
            const issue = delta !== '0' || Number(entry.damaged) > 0;
            if (issue) {
                issues++;
                if (entry.note.trim().length < 3) complete = false;
            }
        }
        return { counted, total: transfer.items.length, issues, complete: complete && counted > 0 };
    }, [transfer, entries]);

    function update(id: string, field: keyof ReceivedLine, value: string) {
        setEntries(current => ({
            ...current, [id]: {
                received: current[id]?.received ?? '',
                damaged: current[id]?.damaged ?? '0',
                note: current[id]?.note ?? '',
                [field]: value,
            }
        }));
        setNotice('');
    }

    function exportReport() {
        if (!transfer || !review.complete) return;
        const report = {
            reportType: 'WAVEHOUSE_RECEIVING_RECONCILIATION_DRAFT',
            schemaVersion: 1,
            source: 'website-W3-local-export',
            persistedToBackend: false,
            adjustsInventory: false,
            transferId: transfer.id,
            transferNumber: transfer.number,
            sourceBranchId: transfer.sourceBranchId,
            destinationBranchId: transfer.destinationBranchId,
            recordedAt: new Date().toISOString(),
            receiverUserId: session.user.id,
            receiverRole: session.user.role,
            note: overallNote.trim(),
            lines: transfer.items.map(item => {
                const received = entries[item.ingredientId];
                return {
                    ingredientId: item.ingredientId,
                    ingredientCode: item.code,
                    ingredientName: item.name,
                    unit: item.unit,
                    expectedQuantity: item.plannedQuantity,
                    receivedQuantity: received.received,
                    damagedQuantity: received.damaged,
                    variance: deltaQuantity(received.received, item.plannedQuantity),
                    discrepancyNote: received.note.trim(),
                };
            }),
        };
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = transferFilename(transfer.id);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setNotice('Đã xuất biên bản ra tệp trên máy. Chưa có dữ liệu nào được lưu lên Backend.');
    }

    return (
        <section className="w3-page">
            <div className="w3-heading">
                <div><p className="w3-eyebrow">WAVEHOUSE / ĐẦU CA</p><h2>Đối chiếu nhận nguyên liệu</h2>
                    <p>So sánh số lượng kho đã chuyển với số lượng nhân viên quầy kiểm đếm khi nhận hàng.</p></div>
                <span className="w3-label">GIAO DIỆN W3</span>
            </div>
            <div className="w3-alert w3-warning" role="note">
                <strong>Chưa xác nhận thực nhận trên máy chủ.</strong> B5 có thể đã cập nhật tồn ngay khi phiếu chuyển kho được duyệt.
                Màn hình W3 chỉ <strong>đọc phiếu POSTED và xuất biên bản đối chiếu cục bộ</strong>; không ghi nhận hàng, không điều chỉnh số dư.
                Cần bổ sung API xác nhận giao nhận riêng trước khi đưa vào vận hành chính thức.
            </div>
            <div className="w3-panel w3-controls">
                <div className="w3-field">
                    <label htmlFor="w3-branch">Chi nhánh nhận hàng</label>
                    {isAdmin && branches.length > 0 ? (
                        <select id="w3-branch" value={branchId} disabled={busy || loadingDetail} onChange={event => setBranchId(event.target.value)}>
                            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                        </select>
                    ) : isAdmin ? (
                        <input id="w3-branch" value={branchId} placeholder="UUID chi nhánh" disabled={busy || loadingDetail} onChange={event => setBranchId(event.target.value)} />
                    ) : (
                        <input id="w3-branch" value={branchId} readOnly aria-label="Chi nhánh theo tài khoản" />
                    )}
                </div>
                <div className="w3-field">
                    <label htmlFor="w3-transfer">Phiếu chuyển kho đã xác nhận (POSTED)</label>
                    <select id="w3-transfer" value={selectedId} disabled={busy || loadingDetail || transfers.length === 0} onChange={event => setSelectedId(event.target.value)}>
                        <option value="">{busy ? 'Đang tải phiếu…' : transfers.length === 0 ? 'Chưa có phiếu phù hợp' : 'Chọn phiếu nhận hàng'}</option>
                        {transfers.map(item => <option key={item.id} value={item.id}>{item.number} — {formatDate(item.postedAt)}</option>)}
                    </select>
                </div>
                <button className="w3-button w3-outline" type="button" disabled={busy || loadingDetail} onClick={() => setVersion(n => n + 1)}>↻ Tải lại</button>
            </div>
            {error && <div className="w3-alert w3-error" role="alert">{error}</div>}
            {notice && <div className="w3-alert w3-success" role="status">{notice}</div>}
            {!isAdmin && !session.user.branchId && <div className="w3-alert w3-error">Tài khoản chưa gắn chi nhánh; cần quản trị viên kiểm tra phân quyền.</div>}
            {branchId && !busy && transfers.length === 0 && !error && <div className="w3-panel w3-empty">Chưa tìm thấy phiếu chuyển kho POSTED cho chi nhánh này trong danh sách API trả về.</div>}
            {loadingDetail && <div className="w3-panel w3-empty">Đang tải chi tiết phiếu chuyển kho…</div>}
            {transfer && (
                <>
                    <div className="w3-summary">
                        <div><span>Mã phiếu</span><strong>{transfer.number}</strong></div>
                        <div><span>Kho / chi nhánh nguồn</span><strong className="w3-id">{transfer.sourceBranchId}</strong></div>
                        <div><span>Chi nhánh nhận</span><strong className="w3-id">{transfer.destinationBranchId}</strong></div>
                        <div><span>Thời điểm ghi nhận B5</span><strong>{formatDate(transfer.postedAt)}</strong></div>
                    </div>
                    <div className="w3-panel">
                        <div className="w3-panel-heading"><div><h3>Kiểm đếm hàng thực nhận</h3><p>Nhập <b>0</b> nếu không nhận được; để trống nghĩa là chưa kiểm. Nếu thiếu/thừa hoặc hỏng, phải ghi rõ lý do.</p></div>
                            <span className="w3-progress">Đã đếm {review.counted}/{review.total}</span></div>
                        <div className="w3-table-wrap">
                            <table className="w3-table">
                                <thead><tr><th>Mã</th><th>Nguyên liệu</th><th>ĐVT</th><th>Số giao theo phiếu</th><th>Thực nhận</th><th>Hỏng / lỗi</th><th>Thiếu / thừa</th><th>Ghi chú</th></tr></thead>
                                <tbody>
                                    {transfer.items.map(item => {
                                        const entry = entries[item.ingredientId] ?? { received: '', damaged: '0', note: '' };
                                        const valid = entry.received === '' || (validQuantity(entry.received, item.unit) && validQuantity(entry.damaged, item.unit) && lessOrEqual(entry.damaged, entry.received));
                                        const counted = validQuantity(entry.received, item.unit);
                                        const delta = counted ? deltaQuantity(entry.received, item.plannedQuantity) : '';
                                        const issue = counted && (delta !== '0' || Number(entry.damaged) > 0);
                                        return (
                                            <tr key={item.ingredientId}>
                                                <td className="w3-code">{item.code || '—'}</td>
                                                <td><strong>{item.name}</strong></td>
                                                <td>{item.unit}</td>
                                                <td className="w3-amount">{formatQuantity(item.plannedQuantity)}</td>
                                                <td><input aria-label={`Thực nhận ${item.name}`} className={!valid ? 'w3-invalid' : ''} value={entry.received} placeholder="Chưa đếm" inputMode="decimal" onChange={event => update(item.ingredientId, 'received', event.target.value)} /></td>
                                                <td><input aria-label={`Hàng hỏng ${item.name}`} value={entry.damaged} inputMode="decimal" onChange={event => update(item.ingredientId, 'damaged', event.target.value)} /></td>
                                                <td className={`w3-amount ${issue ? 'w3-issue' : ''}`}>{delta || '—'}</td>
                                                <td><input aria-label={`Ghi chú ${item.name}`} value={entry.note} maxLength={300} placeholder={issue ? 'Bắt buộc khi có chênh lệch' : 'Không bắt buộc'} onChange={event => update(item.ingredientId, 'note', event.target.value)} /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <p className="w3-footnote">Giá trị chênh lệch = thực nhận − số lượng trên phiếu B5. Chênh lệch này không tự chứng minh lỗi của người giao hay người nhận.</p>
                    </div>
                    <div className="w3-bottom">
                        <div className="w3-panel w3-notes"><label htmlFor="w3-note">Ghi chú toàn phiếu</label>
                            <textarea id="w3-note" value={overallNote} rows={5} maxLength={500} placeholder="Hàng đóng gói sai, giao thiếu, hư hại khi vận chuyển, ảnh/chứng từ đối chiếu…" onChange={event => setOverallNote(event.target.value)} />
                            <p>Biên bản chỉ được lưu khi bạn tải tệp về. Thay đổi trong trang sẽ mất nếu tải lại.</p>
                        </div>
                        <div className="w3-panel w3-export">
                            <h3>Kết quả đối chiếu</h3>
                            <div className="w3-summary-line"><span>Nguyên liệu đã kiểm</span><strong>{review.counted}/{review.total}</strong></div>
                            <div className="w3-summary-line"><span>Dòng có chênh lệch / hỏng</span><strong>{review.issues}</strong></div>
                            <button className="w3-button w3-primary" type="button" disabled={!review.complete} onClick={exportReport}>Xuất biên bản đối chiếu (.json)</button>
                            {!review.complete && <small>Hãy nhập đủ số thực nhận, số hỏng hợp lệ và lý do cho các dòng bất thường.</small>}
                            <p className="w3-warning-text">Không có nút “Đã nhận đủ” trên Backend ở W3. Biên bản này chưa có giá trị xác nhận giao nhận trong cơ sở dữ liệu.</p>
                        </div>
                    </div>
                </>
            )}
        </section>
    );
}
