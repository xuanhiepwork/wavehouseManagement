import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { createTransferDraft, findTransferByCode, type StockDocument } from '../stock-documents/stock-documents.api';
import { buildDispatchDraft, type DispatchLine } from './delivery-draft';
import { isQuantity, isUuid, quantityScaled, validBusinessDate, type ForecastPlan } from './warehouse.api';

type Props = {
    session: AuthSession; plan: ForecastPlan | null; quantities: Record<string, string>; selected: Record<string, boolean>;
    deliveryTime: string; assignedTo: string; note: string;
    onWorkingChange?: (value: boolean) => void; onDirtyChange?: (value: boolean) => void;
    onOpenTransfer?: (id: string) => void;
};
type TransferInput = Parameters<typeof createTransferDraft>[1];
type BatchRow = { input: TransferInput; destinationLabel: string; state: 'READY' | 'UNKNOWN' | 'SAVED'; id?: string; status?: string };
type Batch = { version: 1; userId: string; createdAt: string; businessDate: string; shift: string; rows: BatchRow[] };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Không thể hoàn tất yêu cầu.';
const keyFor = (id: string) => `wavehouse.dispatch-batch.${id}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
function canonicalQuantity(value: string): string {
    const scaled = quantityScaled(value);
    const fraction = String(scaled % 1000000n).padStart(6, '0').replace(/0+$/, '');
    return `${scaled / 1000000n}${fraction ? `.${fraction}` : ''}`;
}
function parseBatchRow(value: unknown): BatchRow {
    if (!object(value) || !object(value.input) || typeof value.destinationLabel !== 'string' || value.destinationLabel.length > 200 ||
        (value.state !== 'READY' && value.state !== 'UNKNOWN' && value.state !== 'SAVED')) throw new Error();
    const input = value.input;
    if (typeof input.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(input.code) ||
        !uuid(input.sourceBranchId) || !uuid(input.destinationBranchId) || input.sourceBranchId.toLowerCase() === input.destinationBranchId.toLowerCase() ||
        (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.length > 500)) ||
        !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new Error();
    const seen = new Set<string>();
    const items = input.items.map((line: unknown) => {
        if (!object(line) || !uuid(line.ingredientId) || typeof line.quantity !== 'string' || line.quantity.length > 32 ||
            !isQuantity(line.quantity) || quantityScaled(line.quantity) <= 0n) throw new Error();
        const ingredientId = line.ingredientId.toLowerCase();
        if (seen.has(ingredientId)) throw new Error();
        seen.add(ingredientId);
        return { ingredientId, quantity: canonicalQuantity(line.quantity) };
    });
    const row: BatchRow = { destinationLabel: value.destinationLabel, state: 'UNKNOWN',
        input: { code: input.code, sourceBranchId: input.sourceBranchId.toLowerCase(), destinationBranchId: input.destinationBranchId.toLowerCase(),
            note: typeof input.note === 'string' ? input.note : null, items } };
    if (value.state === 'SAVED') {
        if (!uuid(value.id) || (value.status !== 'DRAFT' && value.status !== 'POSTED' && value.status !== 'CANCELLED')) throw new Error();
        row.state = 'SAVED'; row.id = value.id.toLowerCase(); row.status = value.status;
    }
    return row;
}

function readBatch(userId: string): { batch: Batch | null; error: string } {
    try {
        const raw = sessionStorage.getItem(keyFor(userId));
        if (!raw) return { batch: null, error: '' };
        if (raw.length > 1000000) throw new Error();
        const value: unknown = JSON.parse(raw);
        if (!object(value) || value.version !== 1 || value.userId !== userId || typeof value.createdAt !== 'string' || value.createdAt.length > 40 ||
            Number.isNaN(Date.parse(value.createdAt)) || typeof value.businessDate !== 'string' || !validBusinessDate(value.businessDate) ||
            (value.shift !== 'MORNING' && value.shift !== 'AFTERNOON' && value.shift !== 'EVENING') ||
            !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 10) throw new Error();
        const rows = value.rows.map(parseBatchRow);
        if (new Set(rows.map(row => row.input.code)).size !== rows.length ||
            new Set(rows.map(row => row.input.destinationBranchId)).size !== rows.length ||
            rows.some(row => row.input.sourceBranchId !== rows[0].input.sourceBranchId)) throw new Error();
        // A tab could have closed while a READY request was in flight. Reconcile every unresolved code before sending again.
        return { batch: { version: 1, userId, createdAt: value.createdAt, businessDate: value.businessDate, shift: value.shift, rows }, error: '' };
    } catch { return { batch: null, error: 'Không đọc được bộ mã phiếu đã lưu trên trình duyệt. Không tạo bộ phiếu mới trước khi đối chiếu danh sách chuyển kho; hãy tải lại hoặc xử lý bộ nhớ trình duyệt.' }; }
}
function matches(document: StockDocument, input: TransferInput): boolean {
    const lines = document.items;
    return document.code === input.code && document.sourceBranchId === input.sourceBranchId && document.destinationBranchId === input.destinationBranchId
        && Boolean(lines && lines.length === input.items.length && input.items.every(line => lines.some(saved => saved.ingredientId === line.ingredientId
            && quantityScaled(saved.quantity) === quantityScaled(line.quantity))));
}

/** Persist operation codes before POST; an ambiguous response requires a read-only recovery. */
export default function DispatchTransfersPanel(props: Props) {
    const { session, plan, quantities, selected, deliveryTime, assignedTo, note, onWorkingChange, onDirtyChange, onOpenTransfer } = props;
    const [initial] = useState(() => readBatch(session.user.id));
    const [batch, setBatch] = useState<Batch | null>(initial.batch);
    const [error, setError] = useState(initial.error);
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const batchRef = useRef(batch);
    useEffect(() => { batchRef.current = batch; }, [batch]);
    const preview = useMemo(() => {
        if (!plan) return { groups: [] as [string, DispatchLine[]][], error: 'Tải và kiểm tra đề xuất B7 trước khi bắt đầu bộ phiếu mới. Bộ mã đã lưu vẫn có thể được đối chiếu mà không cần tải lại kế hoạch.' };
        try {
            const draft = JSON.parse(buildDispatchDraft(plan, quantities, selected, { deliveryTime, assignedTo, note })) as { lines: DispatchLine[] };
            const grouped = new Map<string, DispatchLine[]>();
            for (const line of draft.lines) grouped.set(line.destinationBranchId, [...(grouped.get(line.destinationBranchId) ?? []), line]);
            if ([...grouped.values()].some(lines => lines.length > 50)) throw new Error('Mỗi phiếu B5 có tối đa 50 nguyên liệu. Hãy thu hẹp danh sách trước khi tạo.');
            return { groups: [...grouped.entries()], error: '' };
        } catch (cause) { return { groups: [] as [string, DispatchLine[]][], error: message(cause) }; }
    }, [plan, quantities, selected, deliveryTime, assignedTo, note]);
    const unresolved = Boolean(batch?.rows.some(row => row.state !== 'SAVED'));
    useEffect(() => { onDirtyChange?.(unresolved); }, [unresolved, onDirtyChange]);
    useEffect(() => { onWorkingChange?.(busy); }, [busy, onWorkingChange]);
    useEffect(() => () => { onDirtyChange?.(false); onWorkingChange?.(false); }, [onDirtyChange, onWorkingChange]);

    function store(next: Batch) {
        // If storage is unavailable, stop before making another mutation.
        sessionStorage.setItem(keyFor(session.user.id), JSON.stringify(next));
        batchRef.current = next; setBatch(next);
    }
    function record(index: number, row: BatchRow) {
        const current = batchRef.current;
        if (!current) throw new Error('Thiếu bộ mã phiếu đang xử lý.');
        const next = { ...current, rows: current.rows.map((existing, i) => i === index ? row : existing) };
        // Keep the result in memory even if the browser cannot update its recovery journal.
        batchRef.current = next; setBatch(next);
        sessionStorage.setItem(keyFor(session.user.id), JSON.stringify(next));
    }
    async function createRows(current: Batch) {
        if (lock.current || session.user.role !== 'ADMIN') return;
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try {
            for (let index = 0; index < current.rows.length; index++) {
                const row = batchRef.current?.rows[index];
                if (!row || row.state !== 'READY') continue;
                // Store UNKNOWN before sending: even closing this tab mid-request cannot permit a blind resend.
                record(index, { ...row, state: 'UNKNOWN' });
                const created = await createTransferDraft(session, row.input);
                if (!matches(created, row.input)) throw new Error(`Phản hồi của ${row.input.code} chưa khớp nội dung. Hãy đối chiếu trước khi tiếp tục.`);
                record(index, { ...row, state: 'SAVED', id: created.id, status: created.status });
            }
            setNotice('Đã lưu các phiếu DRAFT trên máy chủ. Mở từng phiếu chuyển kho để kiểm tra và POST bằng thao tác riêng.');
        } catch (cause) { setError(`${message(cause)} Các phiếu đã lưu vẫn được giữ. Bấm đối chiếu mã phiếu trước khi tiếp tục; không tạo bộ mã mới.`); }
        finally { lock.current = false; setBusy(false); }
    }
    function start() {
        if (!plan || batch || lock.current || initial.error || preview.error || !preview.groups.length || session.user.role !== 'ADMIN') return;
        if (!window.confirm(`Tạo ${preview.groups.length} phiếu chuyển kho DRAFT, mỗi điểm nhận một phiếu? Các phiếu chỉ được lưu nháp; tồn kho chưa thay đổi.`)) return;
        let batchCode: string;
        try { batchCode = crypto.randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase(); }
        catch { setError('Trình duyệt chưa tạo được mã phiếu duy nhất. Hãy dùng HTTPS hoặc localhost và mở lại thao tác; chưa gửi yêu cầu tạo phiếu.'); return; }
        const current: Batch = { version: 1, userId: session.user.id, createdAt: new Date().toISOString(), businessDate: plan.businessDate, shift: plan.shift,
            rows: preview.groups.map(([destinationBranchId, lines], index) => ({
                destinationLabel: lines[0].destinationBranchCode || destinationBranchId, state: 'READY',
                input: { code: `W75-${batchCode}-${index + 1}`, sourceBranchId: plan.sourceBranch.id, destinationBranchId,
                    note: `B7 ${plan.businessDate} ${plan.shift}. ${note.trim()}`.slice(0, 500),
                    items: lines.map(line => ({ ingredientId: line.ingredientId, quantity: canonicalQuantity(line.quantity) })) },
            })) };
        try { store(current); void createRows(current); }
        catch { setError('Trình duyệt không lưu được bộ mã đối chiếu. Chưa gửi yêu cầu tạo phiếu.'); }
    }
    async function reconcile() {
        if (lock.current || !batchRef.current) return;
        lock.current = true; setBusy(true); setError(''); setNotice('');
        try {
            for (let index = 0; index < batchRef.current.rows.length; index++) {
                const row = batchRef.current.rows[index];
                if (row.state === 'SAVED') continue;
                const found = await findTransferByCode(session, row.input.code);
                if (found && !matches(found, row.input)) throw new Error(`Mã ${row.input.code} có nội dung khác trên máy chủ. Hãy mở danh sách chuyển kho để xử lý; không gửi lại.`);
                record(index, found ? { ...row, state: 'SAVED', id: found.id, status: found.status } : { ...row, state: 'READY' });
            }
            setNotice('Đã đối chiếu máy chủ. Các mã chưa tồn tại có thể được gửi tiếp bằng nút bên dưới; hệ thống giữ nguyên mã duy nhất.');
        } catch (cause) { setError(message(cause)); }
        finally { lock.current = false; setBusy(false); }
    }
    function continueBatch() {
        const current = batchRef.current;
        if (!current || lock.current || current.rows.some(row => row.state === 'UNKNOWN')) return;
        const count = current.rows.filter(row => row.state === 'READY').length;
        if (count && window.confirm(`Tiếp tục tạo ${count} phiếu chưa tồn tại bằng các mã đã giữ?`)) void createRows(current);
    }
    function clearCompleted() {
        if (lock.current || !batch || unresolved || !window.confirm('Kết thúc bộ phiếu đã lưu? Lần tạo tiếp theo sẽ là một đợt mới và có thể trùng nhu cầu nếu dùng lại kế hoạch cũ.')) return;
        try { sessionStorage.removeItem(keyFor(session.user.id)); batchRef.current = null; setBatch(null); setNotice('Đã kết thúc bộ phiếu. Hãy tải lại B7 và kiểm tra tồn trước đợt tiếp theo.'); }
        catch { setError('Không xóa được bộ mã trên trình duyệt. Chưa mở đợt mới.'); }
    }
    return <div className="w5-panel" aria-label="Tạo phiếu chuyển kho từ kế hoạch">
        <h3>Lưu phiếu chuyển kho B5</h3>
        <p className="w5-caution">Chỉ ADMIN tạo phiếu. Tạo DRAFT chưa ghi sổ. Khi POST tại màn hình Chuyển kho, B5 trừ kho nguồn và cộng điểm nhận ngay; xác nhận nhận hàng W7.2 không ghi sổ lần nữa.</p>
        <p className="w5-muted">Giờ giao và người phụ trách ở trên chỉ là thông tin nháp trên máy này/JSON. Backend chưa có lịch giao, phân công tài xế hay trạng thái vận chuyển.</p>
        {error && <p className="w5-error" role="alert">{error}</p>}
        {notice && <p className="w5-success" role="status">{notice}</p>}
        {!batch ? <>
            {preview.error && <p role="alert" className="w5-caution">{preview.error}</p>}
            <p>{preview.groups.length} điểm nhận; {preview.groups.reduce((count, [, lines]) => count + lines.length, 0)} dòng nguyên liệu có lượng giao lớn hơn 0.</p>
            <button type="button" className="w5-primary" disabled={busy || Boolean(preview.error) || Boolean(initial.error) || !preview.groups.length} onClick={start}>Xác nhận tạo {preview.groups.length} phiếu DRAFT</button>
        </> : <>
            <p>Bộ phiếu ngày {batch.businessDate} · {batch.shift} · tạo lúc {new Date(batch.createdAt).toLocaleString('vi-VN')}. Nội dung bộ này đã được cố định; thay đổi bảng nháp không sửa các phiếu đã lưu.</p>
            <div className="w5-table-wrap"><table className="w5-table"><thead><tr><th>Điểm nhận</th><th>Mã phiếu duy nhất</th><th>Kết quả</th><th>Chi tiết</th></tr></thead>
                <tbody>{batch.rows.map(row => <tr key={row.input.code}><td>{row.destinationLabel}</td><td>{row.input.code}</td><td>{row.state === 'SAVED' ? `Đã lưu · ${row.status}` : row.state === 'UNKNOWN' ? 'Cần đối chiếu máy chủ' : 'Chưa tồn tại / sẵn sàng gửi'}</td>
                    <td>{row.id && <button type="button" disabled={busy} onClick={() => onOpenTransfer?.(row.id!)}>Mở phiếu B5</button>}</td></tr>)}</tbody></table></div>
            {unresolved && <button type="button" disabled={busy} onClick={() => { void reconcile(); }}>Đối chiếu các mã phiếu (chỉ đọc)</button>}
            {batch.rows.some(row => row.state === 'READY') && <button type="button" className="w5-primary" disabled={busy || batch.rows.some(row => row.state === 'UNKNOWN')} onClick={continueBatch}>Xác nhận tạo tiếp các phiếu chưa tồn tại</button>}
            {!unresolved && <button type="button" disabled={busy} onClick={clearCompleted}>Kết thúc bộ phiếu đã lưu</button>}
        </>}
        {busy && <p role="status">Đang xử lý từng phiếu; giữ màn hình mở cho đến khi có kết quả…</p>}
    </div>;
}
