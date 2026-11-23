import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { ApiError } from '../api';
import {
    approveCount,
    createCount,
    getCount,
    listCounts,
    loadBranchList,
    loadTemplate,
    returnCount,
    submitCount,
    updateCount,
    UUID_PATTERN,
    type BranchItem,
    type CountStatus,
    type IngredientLine,
    type ShiftCount,
    type WorkShift,
} from './shift-count.api';
import './ShiftStockCountPage.css';

const STATUS_LABELS: Record<CountStatus, string> = {
    DRAFT: 'Bản nháp',
    SUBMITTED: 'Chờ duyệt',
    RETURNED: 'Trả lại để sửa',
    APPROVED: 'Đã duyệt',
};

const SHIFT_LABELS: Record<WorkShift, string> = {
    MORNING: 'Ca sáng',
    AFTERNOON: 'Ca chiều',
    EVENING: 'Ca tối',
};

function vietnamDate(): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function qtyValid(text: string, unit: string): boolean {
    return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(text)
        && (unit !== 'piece' || /^\d+$/.test(text));
}

function showQty(value: string | null): string {
    if (value === null || value === '') return '—';
    if (!/^-?\d+(?:\.\d{1,6})?$/.test(value)) return value;
    const [integer, fraction = ''] = value.split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (trimmed ? `,${trimmed}` : '');
}

function estimatedVariance(expected: string | null, actual: string): string {
    if (expected === null || !/^-?\d+(?:\.\d{1,6})?$/.test(expected) || !/^\d+(?:\.\d{1,6})?$/.test(actual)) return '—';
    const scaled = (value: string) => {
        const negative = value.startsWith('-');
        const [integer, fraction = ''] = (negative ? value.slice(1) : value).split('.');
        const amount = BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
        return negative ? -amount : amount;
    };
    const difference = scaled(actual) - scaled(expected);
    const magnitude = difference < 0n ? -difference : difference;
    const value = `${difference < 0n ? '-' : ''}${magnitude / 1_000_000n}.${String(magnitude % 1_000_000n).padStart(6, '0')}`;
    return `${difference > 0n ? '+' : ''}${showQty(value)}`;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : 'Có lỗi không xác định. Vui lòng tải lại.';
}

function sectionHeader(title: string, subtitle: string) {
    return (
        <div className="w2-heading">
            <div><p className="w2-eyebrow">WAVEHOUSE / QUẢN LÝ CA</p><h2>{title}</h2><p>{subtitle}</p></div>
            <span className="w2-head-tag">Kết nối B6</span>
        </div>
    );
}

// Keep catalog names and units from the current template when detail rows
// only contain ingredientId / countedQuantity.
function mergeItems(template: IngredientLine[], saved: IngredientLine[]): IngredientLine[] {
    const byId = new Map(saved.map(item => [item.ingredientId, item]));
    const merged = template.map(item => {
        const previous = byId.get(item.ingredientId);
        return {
            ...item,
            expectedQuantity: previous?.expectedQuantity ?? item.expectedQuantity,
            countedQuantity: previous?.countedQuantity ?? '',
        };
    });
    const templateIds = new Set(template.map(item => item.ingredientId));
    // Keep inactive-but-counted ingredients if present on the saved count.
    for (const item of saved) {
        if (!templateIds.has(item.ingredientId)) merged.push(item);
    }
    return merged;
}

type Props = { session: AuthSession; onDirtyChange?: (dirty: boolean) => void; onWorkingChange?: (working: boolean) => void };

export default function ShiftStockCountPage({ session, onDirtyChange, onWorkingChange }: Props) {
    const canReview = session.user.role !== 'STAFF';
    const isAdmin = session.user.role === 'ADMIN';
    const [branchId, setBranchId] = useState(session.user.branchId ?? '');
    const [branches, setBranches] = useState<BranchItem[]>([]);
    const [businessDate, setBusinessDate] = useState(vietnamDate);
    const [shift, setShift] = useState<WorkShift>('EVENING');
    const [items, setItems] = useState<IngredientLine[]>([]);
    const [count, setCount] = useState<ShiftCount | null>(null);
    const [note, setNote] = useState('');
    const [returnReason, setReturnReason] = useState('');
    const [filter, setFilter] = useState('');
    const [working, setWorking] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [version, setVersion] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [recoveryNeeded, setRecoveryNeeded] = useState(false);
    const sessionRef = useRef(session); sessionRef.current = session;
    const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
    const actionLock = useRef(false);
    const alive = useRef(true);
    const callbacks = useRef({ onDirtyChange, onWorkingChange }); callbacks.current = { onDirtyChange, onWorkingChange };
    const loadedScope = useRef('');
    const sessionScope = JSON.stringify([session.user.id, session.user.role, session.user.branchId]);

    useEffect(() => {
        alive.current = true;
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (dirtyRef.current || actionLock.current) { event.preventDefault(); event.returnValue = ''; }
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => {
            alive.current = false; window.removeEventListener('beforeunload', beforeUnload);
            callbacks.current.onDirtyChange?.(false); callbacks.current.onWorkingChange?.(false);
        };
    }, []);
    useEffect(() => { callbacks.current.onDirtyChange?.(dirty); }, [dirty]);
    useEffect(() => { callbacks.current.onWorkingChange?.(working); }, [working]);
    useEffect(() => { if (!isAdmin) setBranchId(session.user.branchId ?? ''); }, [isAdmin, session.user.branchId]);

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        void loadBranchList(sessionRef.current).then(list => {
            if (!active) return;
            setBranches(list);
            if (list.length) setBranchId(current => current || list[0].id);
        }).catch(() => {
            // Admin can still type a branch UUID when listing is not available.
        });
        return () => { active = false; };
        // Branch list is only loaded when the signed-in user changes.
    }, [sessionScope, isAdmin]);

    useEffect(() => {
        const scope = JSON.stringify([sessionScope, branchId, businessDate, shift]);
        if (loadedScope.current !== scope) {
            loadedScope.current = scope;
            setCount(null); setItems([]); setNote(''); setFilter(''); setReturnReason('');
            setDirty(false); setRecoveryNeeded(false); setSuccess('');
        }
        if (!UUID_PATTERN.test(branchId)) {
            setError('Hãy chọn chi nhánh hợp lệ để tải danh sách kiểm kê.');
            setLoading(false);
            return;
        }

        let active = true;
        setLoading(true);
        setError('');

        void Promise.all([
            loadTemplate(sessionRef.current, branchId),
            listCounts(sessionRef.current, branchId, { businessDate, shift }),
        ]).then(async ([template, counts]) => {
            const match = counts.find(row => row.branchId === branchId
                && row.businessDate === businessDate && row.shift === shift);
            const selected = match ? await getCount(sessionRef.current, match.id) : null;
            if (selected && (selected.branchId !== branchId || selected.businessDate !== businessDate || selected.shift !== shift)) {
                throw new Error('Chi tiết phiếu không khớp chi nhánh/ngày/ca đã chọn.');
            }
            if (!active) return;
            setCount(selected);
            setItems(selected ? mergeItems(template, selected.items) : template);
            setNote(selected?.note ?? '');
            setReturnReason(selected?.returnReason ?? '');
            setDirty(false); setRecoveryNeeded(false);
        }).catch(cause => {
            if (active) setError(message(cause));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [branchId, businessDate, shift, version, sessionScope]);

    const filteredItems = useMemo(() => items.filter(item =>
        `${item.code} ${item.name}`.toLocaleLowerCase('vi-VN').includes(filter.toLocaleLowerCase('vi-VN'))
    ), [items, filter]);
    const completed = useMemo(() => items.filter(item => qtyValid(item.countedQuantity, item.unit)).length, [items]);
    const editable = !count || count.status === 'DRAFT' || count.status === 'RETURNED';
    const complete = items.length > 0 && completed === items.length;
    const safeToSubmit = Boolean(count && editable && !dirty && complete && !recoveryNeeded);

    function setQuantity(ingredientId: string, value: string) {
        if (!editable || working) return;
        setItems(previous => previous.map(item => item.ingredientId === ingredientId
            ? { ...item, countedQuantity: value }
            : item));
        setDirty(true);
        setSuccess('');
    }

    function reload() {
        if (actionLock.current || loading) return;
        if ((dirty || recoveryNeeded) && !window.confirm('Tải lại sẽ thay các số đang nhập bằng dữ liệu đã lưu trên máy chủ. Tiếp tục?')) return;
        setVersion(value => value + 1);
    }

    async function runAction(action: () => Promise<void>, successText: string) {
        if (actionLock.current || recoveryNeeded || loading) return;
        actionLock.current = true;
        setWorking(true);
        setError('');
        setSuccess('');
        try {
            await action();
            if (!alive.current) return;
            setSuccess(successText);
            setDirty(false);
            // Reload the persisted count; server owns status and variance.
            setVersion(value => value + 1);
        } catch (cause) {
            if (alive.current) {
                setError(message(cause));
                if (cause instanceof ApiError && cause.uncertain) { setRecoveryNeeded(true); setDirty(true); }
            }
        } finally {
            actionLock.current = false;
            if (alive.current) setWorking(false);
        }
    }

    async function reconcile() {
        if (actionLock.current || loading || !UUID_PATTERN.test(branchId)) return;
        actionLock.current = true; setWorking(true); setError(''); setSuccess('');
        try {
            const counts = await listCounts(sessionRef.current, branchId, { businessDate, shift });
            const persisted = counts[0] ? await getCount(sessionRef.current, counts[0].id) : null;
            if (persisted && (persisted.branchId !== branchId || persisted.businessDate !== businessDate || persisted.shift !== shift)) {
                throw new Error('Chi tiết phiếu không khớp chi nhánh/ngày/ca đã chọn.');
            }
            if (!alive.current) return;
            // Reconcile identity and status only. Never replace a user's quantities
            // after a failed write; an existing unique draft can then be updated.
            setCount(persisted); setRecoveryNeeded(false);
            const quantitiesKey = (lines: IngredientLine[]) => JSON.stringify(lines.map(line => [line.ingredientId, line.countedQuantity]).sort(([first], [second]) => first.localeCompare(second)));
            if (!persisted || quantitiesKey(items) !== quantitiesKey(persisted.items) || note.trim() !== persisted.note) setDirty(true);
            setSuccess(persisted
                ? `Đã đối chiếu phiếu ${persisted.id}: ${STATUS_LABELS[persisted.status]}. Số đang nhập vẫn được giữ; tải lại nếu muốn dùng số đã lưu.`
                : 'Máy chủ chưa có phiếu cho chi nhánh/ngày/ca này. Số đang nhập vẫn được giữ; có thể lưu bản nháp sau khi đối chiếu.');
        } catch (cause) { if (alive.current) setError(message(cause)); }
        finally { actionLock.current = false; if (alive.current) setWorking(false); }
    }

    function payloadLines() {
        return items.map(item => ({ ingredientId: item.ingredientId, countedQuantity: item.countedQuantity }));
    }

    async function save() {
        if (actionLock.current || recoveryNeeded || !complete || !editable || !UUID_PATTERN.test(branchId)) return;
        const payload = { branchId, businessDate, shift, note: note.trim(), items: payloadLines() };
        await runAction(async () => {
            if (count) await updateCount(session, count.id, { note: payload.note, items: payload.items });
            else {
                const id = await createCount(sessionRef.current, payload);
                if (alive.current) setCount({ id, branchId, businessDate, shift, status: 'DRAFT', note: payload.note, returnReason: '', items: [...items] });
            }
        }, 'Đã lưu bản nháp kiểm kê.');
    }

    async function submit() {
        if (actionLock.current || !count || !safeToSubmit || !window.confirm('Gửi phiếu kiểm kê để quản lý duyệt? Sau khi gửi, nhân viên không thể sửa đến khi phiếu được trả lại.')) return;
        await runAction(() => submitCount(session, count.id), 'Đã gửi phiếu để quản lý duyệt.');
    }

    async function approve() {
        if (actionLock.current || !count || count.status !== 'SUBMITTED' || !canReview
            || !window.confirm('Duyệt phiếu sẽ cập nhật tồn kho theo chênh lệch kiểm kê. Bạn đã đối chiếu số liệu?')) return;
        await runAction(() => approveCount(session, count.id), 'Phiếu đã được duyệt và cập nhật số dư theo quy trình B6.');
    }

    async function sendBack() {
        if (actionLock.current || !count || count.status !== 'SUBMITTED' || !canReview || returnReason.trim().length < 3) return;
        await runAction(() => returnCount(session, count.id, returnReason.trim()), 'Đã trả lại phiếu để nhân viên chỉnh sửa.');
    }

    const inProgress = loading || working;
    const branchLabel = branches.find(branch => branch.id === branchId);

    return (
        <section className="w2-page">
            {sectionHeader('Kiểm kê cuối ca', 'Nhập tồn thực đếm, lưu bản nháp và chuyển quản lý duyệt. Mọi số liệu đều lấy từ Backend, không dùng dữ liệu minh họa.')}
            <div className="w2-alert" role="note">Hoàn tất xác nhận mọi phiếu chuyển kho đến trước khi kiểm đếm và gửi phiếu. Nếu có nhận hàng sau lúc gửi, quản lý phải trả phiếu để kiểm đếm và gửi lại.</div>
            <div className="w2-panel w2-filters">
                <div className="w2-field w2-branch-field">
                    <label htmlFor="w2-branch">Chi nhánh kiểm kê</label>
                    {isAdmin && branches.length > 0 ? (
                        <select id="w2-branch" value={branchId} disabled={inProgress || dirty} onChange={event => setBranchId(event.target.value)}>
                            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                        </select>
                    ) : isAdmin ? (
                        <input id="w2-branch" value={branchId} disabled={inProgress || dirty} placeholder="UUID chi nhánh" onChange={event => setBranchId(event.target.value.toLowerCase())} />
                    ) : (
                        <input id="w2-branch" value={session.user.branchId ?? ''} readOnly aria-label="Chi nhánh được phân quyền" />
                    )}
                    {branchLabel && <span className="w2-helper">{branchLabel.name}</span>}
                </div>
                <div className="w2-field">
                    <label htmlFor="w2-date">Ngày kinh doanh</label>
                    <input id="w2-date" type="date" value={businessDate} max={vietnamDate()} disabled={inProgress || dirty} onChange={event => setBusinessDate(event.target.value)} />
                </div>
                <div className="w2-field">
                    <label htmlFor="w2-shift">Ca làm việc</label>
                    <select id="w2-shift" value={shift} disabled={inProgress || dirty} onChange={event => setShift(event.target.value as WorkShift)}>
                        {Object.entries(SHIFT_LABELS).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
                    </select>
                </div>
                <button className="w2-secondary w2-refresh" type="button" disabled={inProgress} onClick={reload}>↻ Tải lại</button>
                {dirty && <p className="w2-dirty">Bạn đang sửa số liệu. Hãy lưu bản nháp trước khi đổi chi nhánh/ngày/ca.</p>}
            </div>

            {error && <div className="w2-alert w2-error" role="alert">{error}</div>}
            {success && <div className="w2-alert w2-success" role="status">{success}</div>}
            {recoveryNeeded && <div className="w2-alert" role="alert">Yêu cầu trước có thể đã được lưu. Tạm dừng gửi lại; đối chiếu trạng thái máy chủ trước khi tiếp tục. Số đang nhập vẫn được giữ.</div>}

            <div className="w2-stats">
                <div className="w2-stat"><span>Tình trạng phiếu</span><strong>{loading ? 'Đang tải…' : count ? STATUS_LABELS[count.status] : 'Chưa lập'}</strong></div>
                <div className="w2-stat"><span>Đã nhập đủ</span><strong>{completed}/{items.length} nguyên liệu</strong></div>
                <div className="w2-stat"><span>Phạm vi</span><strong>{SHIFT_LABELS[shift]}</strong></div>
                <div className="w2-stat"><span>Người thực hiện</span><strong>{session.user.displayName || session.user.email || session.user.role}</strong></div>
            </div>

            <div className="w2-panel w2-count-panel">
                <div className="w2-panel-heading">
                    <div><h3>Phiếu tồn nguyên liệu cuối ca</h3><p>Nhập <strong>0</strong> nếu đã hết hàng; để trống nghĩa là chưa kiểm kê. Đơn vị lấy từ danh mục nguyên liệu.</p></div>
                    <input className="w2-search" aria-label="Tìm nguyên liệu" placeholder="Tìm nguyên liệu / mã…" value={filter} onChange={event => setFilter(event.target.value)} />
                </div>
                <div className="w2-table-wrap">
                    <table className="w2-table">
                        <thead><tr><th>Mã</th><th>Nguyên liệu / vật tư</th><th>ĐVT</th><th>Tồn hệ thống*</th><th>Tồn thực đếm</th><th>Chênh lệch tạm tính*</th></tr></thead>
                        <tbody>
                            {filteredItems.length === 0 && <tr><td colSpan={6} className="w2-empty">{loading ? 'Đang tải danh sách nguyên liệu…' : 'Không có nguyên liệu phù hợp hoặc chưa tải được dữ liệu.'}</td></tr>}
                            {filteredItems.map(item => {
                                const valid = item.countedQuantity === '' || qtyValid(item.countedQuantity, item.unit);
                                return (
                                    <tr key={item.ingredientId}>
                                        <td className="w2-code">{item.code || '—'}</td>
                                        <td><strong>{item.name}</strong></td>
                                        <td>{item.unit}</td>
                                        <td className="w2-number">{showQty(item.expectedQuantity)}</td>
                                        <td><input aria-label={`Tồn thực đếm ${item.name}`} className={`w2-quantity ${!valid ? 'w2-invalid' : ''}`} type="text" inputMode="decimal" placeholder="Chưa nhập" value={item.countedQuantity} disabled={!editable || inProgress} onChange={event => setQuantity(item.ingredientId, event.target.value)} /></td>
                                        <td className="w2-number">{qtyValid(item.countedQuantity, item.unit) ? estimatedVariance(item.expectedQuantity, item.countedQuantity) : '—'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="w2-footnote">* Tồn hệ thống/chênh lệch chỉ để tham khảo tại thời điểm hiển thị. Chênh lệch chính thức được Backend xác định khi gửi/duyệt phiếu; không được coi là số nguyên liệu đã bán.</div>
            </div>

            <div className="w2-lower">
                <div className="w2-panel w2-note-panel">
                    <label htmlFor="w2-note">Ghi chú cuối ca</label>
                    <textarea id="w2-note" maxLength={500} rows={5} placeholder="Hàng hủy, đổ vỡ, nguyên liệu bất thường, lý do chênh lệch…" value={note} disabled={!editable || inProgress} onChange={event => { setNote(event.target.value); setDirty(true); }} />
                    {count?.status === 'RETURNED' && <div className="w2-returned">Lý do quản lý trả phiếu: {count.returnReason || 'Chưa ghi rõ'}</div>}
                    <p>Ghi chú phục vụ đối soát; không tự chứng minh lỗi hoặc gian lận của nhân viên.</p>
                </div>
                <div className="w2-panel w2-action-panel">
                    <h3>Xử lý phiếu</h3>
                    <p>{count ? `Mã phiếu: ${count.id}` : 'Chưa có phiếu cho chi nhánh, ngày và ca đã chọn.'}</p>
                    {editable ? (
                        <>
                            <button type="button" className="w2-primary" disabled={inProgress || recoveryNeeded || !complete} onClick={() => { void save(); }}>{working ? 'Đang xử lý…' : count ? 'Lưu chỉnh sửa' : 'Lưu bản nháp'}</button>
                            <button type="button" className="w2-secondary" disabled={inProgress || !safeToSubmit} onClick={() => { void submit(); }}>Gửi quản lý duyệt</button>
                            <small>Chỉ gửi duyệt sau khi đã nhập đủ nguyên liệu và lưu bản nháp. Không tạo lại phiếu nếu lưu gặp lỗi mạng.</small>
                        </>
                    ) : (
                        <span className="w2-status">{count ? STATUS_LABELS[count.status] : ''} — không được sửa số liệu</span>
                    )}
                    <button type="button" className="w2-secondary" disabled={inProgress || !UUID_PATTERN.test(branchId)} onClick={() => { void reconcile(); }}>Đối chiếu trạng thái, giữ số đang nhập</button>
                    {canReview && count?.status === 'SUBMITTED' && (
                        <div className="w2-review">
                            <div className="w2-separator" />
                            <strong>Quản lý xét duyệt</strong>
                            <button type="button" className="w2-primary" disabled={inProgress || recoveryNeeded} onClick={() => { void approve(); }}>Duyệt & điều chỉnh tồn</button>
                            <label htmlFor="w2-reason">Lý do yêu cầu kiểm kê lại</label>
                            <textarea id="w2-reason" rows={2} maxLength={500} value={returnReason} disabled={inProgress} onChange={event => { setReturnReason(event.target.value); setDirty(true); }} placeholder="Cần kiểm tra lại số lượng…" />
                            <button type="button" className="w2-secondary" disabled={inProgress || recoveryNeeded || returnReason.trim().length < 3} onClick={() => { void sendBack(); }}>Trả phiếu</button>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
