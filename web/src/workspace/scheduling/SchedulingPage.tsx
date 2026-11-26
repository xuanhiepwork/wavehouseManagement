import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { apiRequest } from '../api';
import './SchedulingPage.css';

type Shift = 'MORNING' | 'AFTERNOON' | 'EVENING';
type Area = { id: string; code: string; name: string; isActive: boolean };
type Branch = { id: string; code: string; name: string; isActive: boolean };
type Staff = { id: string; displayName: string; role: string; workKind: string };
type Availability = { id: string; userId: string; businessDate: string; shift: Shift; available: boolean; user: { displayName: string } };
type Assignment = { id: string; userId: string; branchId: string; businessDate: string; shift: Shift;
    status: string; version: number; user: { displayName: string }; branch: { name: string; code: string } };
const SHIFTS: Shift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const SHIFT_NAMES: Record<Shift, string> = { MORNING: 'Ca sáng', AFTERNOON: 'Ca chiều', EVENING: 'Ca tối' };
const formatDay = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
function monday(day: Date): string {
    const base = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    return formatDay(base);
}
function offsetDay(day: string, offset: number): string {
    const [year, month, date] = day.split('-').map(Number);
    const local = new Date(year, month - 1, date);
    local.setDate(local.getDate() + offset);
    return formatDay(local);
}
function asDay(value: string) { return value.slice(0, 10); }

export default function SchedulingPage({ session }: { session: AuthSession }) {
    const manager = session.user.role !== 'STAFF';
    const [week, setWeek] = useState(() => monday(new Date()));
    const [areas, setAreas] = useState<Area[]>([]);
    const [areaId, setAreaId] = useState('');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [employees, setEmployees] = useState<Staff[]>([]);
    const [availability, setAvailability] = useState<Availability[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [day, setDay] = useState(() => formatDay(new Date()));
    const [shift, setShift] = useState<Shift>('MORNING');
    const [employeeId, setEmployeeId] = useState('');
    const [branchId, setBranchId] = useState('');
    const [available, setAvailable] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let active = true;
        void apiRequest<{ items: Area[] }>(session, '/areas').then(result => {
            if (!active) return;
            setAreas(result.items);
            setAreaId(previous => result.items.some(area => area.id === previous) ? previous : result.items[0]?.id ?? '');
        }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không tải được khu vực.'); });
        return () => { active = false; };
    }, [session]);

    const refresh = useCallback(() => setRevision(value => value + 1), []);
    useEffect(() => {
        if (!areaId) return;
        let active = true;
        const from = week, to = offsetDay(week, 6);
        const query = new URLSearchParams({ from, to, areaId }).toString();
        const requests = [
            apiRequest<{ items: Branch[] }>(session, `/areas/${areaId}/branches`),
            manager ? apiRequest<{ items: Staff[] }>(session, `/areas/${areaId}/users`) : Promise.resolve({ items: [] as Staff[] }),
            apiRequest<{ items: Availability[] }>(session, `/scheduling/availability?${query}`),
            apiRequest<{ items: Assignment[] }>(session, `/scheduling/assignments?${query}`),
        ] as const;
        void Promise.all(requests).then(([b, u, a, s]) => {
            if (!active) return;
            setBranches(b.items); setEmployees(u.items); setAvailability(a.items); setAssignments(s.items);
            setBranchId(previous => b.items.some(item => item.id === previous) ? previous : b.items[0]?.id ?? '');
            setEmployeeId(previous => u.items.some(item => item.id === previous) ? previous : u.items.find(x => x.role === 'STAFF' && x.workKind === 'SALES')?.id ?? '');
        }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Không thể tải lịch.'); });
        return () => { active = false; };
    }, [session, areaId, week, revision, manager]);

    async function sendAvailability(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            await apiRequest(session, '/scheduling/availability', { method: 'POST', body: { businessDate: day, shift, available } });
            setMessage('Đã ghi nhận thời gian có thể làm việc.'); setWeek(monday(new Date(`${day}T12:00:00`))); refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu thời gian rảnh.'); }
        finally { setBusy(false); }
    }
    async function assign(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy || !employeeId || !branchId) return;
        setBusy(true); setError(''); setMessage('');
        try {
            await apiRequest(session, '/scheduling/assignments', { method: 'POST', body: {
                userId: employeeId, branchId, businessDate: day, shift,
            } });
            setMessage('Đã phân công nhân viên.'); setWeek(monday(new Date(`${day}T12:00:00`))); refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể phân công.'); }
        finally { setBusy(false); }
    }
    async function changeAssignment(item: Assignment, status: 'CANCELLED' | 'SCHEDULED') {
        if (busy) return;
        const label = status === 'CANCELLED' ? 'hủy' : 'khôi phục';
        if (!window.confirm(`Xác nhận ${label} ca ${SHIFT_NAMES[item.shift]} của ${item.user.displayName} ngày ${asDay(item.businessDate)}?`)) return;
        setBusy(true); setError(''); setMessage('');
        try {
            await apiRequest(session, `/scheduling/assignments/${item.id}`, { method: 'PATCH', body: { status, expectedVersion: item.version } });
            setMessage('Đã cập nhật phân công.'); refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật phân công.'); }
        finally { setBusy(false); }
    }

    const validEmployees = employees.filter(item => item.role === 'STAFF' && item.workKind === 'SALES');
    const availableShifts = availability.filter(item => item.available);
    return <section className="wh-scheduling">
        <div className="wh-heading">
            <div><p className="wh-eyebrow">WAVEHOUSE / NHÂN SỰ</p><h2>Lịch làm việc theo khu vực</h2></div>
            <button type="button" onClick={refresh} disabled={busy}>Tải lịch mới nhất</button>
        </div>
        <p className="wh-intro">Nhân viên bán hàng thuộc khu vực; quầy làm việc được quản lý phân công theo từng ca. Lịch không tự thay đổi quyền báo cáo cũ.</p>
        {error && <p className="wh-schedule-error" role="alert">{error} Nếu không rõ kết quả thao tác, tải lại lịch trước khi gửi lần nữa.</p>}
        {message && <p className="wh-schedule-success" role="status">{message}</p>}
        {!areas.length && <p className="wh-schedule-warning">Chưa có khu vực được phân công. ADMIN cần tạo khu vực, gán quầy và nhân viên trước khi lập lịch.</p>}
        <div className="wh-schedule-panel wh-schedule-toolbar">
            <label> Khu vực
                <select value={areaId} onChange={event => setAreaId(event.target.value)} disabled={!areas.length || busy}>
                    {areas.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
                </select>
            </label>
            <div className="wh-schedule-week">
                <button type="button" disabled={busy} onClick={() => setWeek(day => offsetDay(day, -7))}>Tuần trước</button>
                <strong>{week} → {offsetDay(week, 6)}</strong>
                <button type="button" disabled={busy} onClick={() => setWeek(day => offsetDay(day, 7))}>Tuần sau</button>
            </div>
        </div>
        {areaId && <div className="wh-schedule-grid">
            <form className="wh-schedule-panel" onSubmit={manager ? assign : sendAvailability}>
                <h3>{manager ? 'Phân công ca làm việc' : 'Đăng ký thời gian có thể làm'}</h3>
                <label>Ngày làm việc<input type="date" required value={day} onChange={event => setDay(event.target.value)} /></label>
                <label>Ca
                    <select value={shift} onChange={event => setShift(event.target.value as Shift)}>
                        {SHIFTS.map(value => <option key={value} value={value}>{SHIFT_NAMES[value]}</option>)}
                    </select>
                </label>
                {manager ? <>
                    <label>Nhân viên bán hàng
                        <select value={employeeId} required onChange={event => setEmployeeId(event.target.value)}>
                            <option value="">Chọn nhân viên</option>
                            {validEmployees.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                        </select>
                    </label>
                    <label>Quầy
                        <select value={branchId} required onChange={event => setBranchId(event.target.value)}>
                            <option value="">Chọn quầy</option>
                            {branches.filter(x => x.isActive).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </label>
                    <p className="wh-schedule-hint">Nhân viên phải đăng ký rảnh ở ca này. Backend sẽ từ chối trùng ca hoặc phân công khác khu vực.</p>
                </> : <label>Khả năng làm việc
                    <select value={available ? 'yes' : 'no'} onChange={event => setAvailable(event.target.value === 'yes')}>
                        <option value="yes">Có thể làm</option><option value="no">Không thể làm</option>
                    </select>
                </label>}
                <button type="submit" className="wh-primary" disabled={busy || (manager && (!employeeId || !branchId))}>
                    {busy ? 'Đang lưu…' : manager ? 'Phân công nhân viên' : 'Lưu thời gian rảnh'}
                </button>
            </form>
            <section className="wh-schedule-panel">
                <h3>Đăng ký rảnh trong tuần</h3>
                {!availableShifts.length ? <p className="wh-schedule-hint">Chưa có dữ liệu đăng ký trong tuần.</p> :
                    <ul className="wh-schedule-availability">{availableShifts.map(item => <li key={item.id}>
                        <span>{asDay(item.businessDate)} · {SHIFT_NAMES[item.shift]}</span><strong>{item.user.displayName}</strong>
                    </li>)}</ul>}
            </section>
        </div>}
        <section className="wh-schedule-panel">
            <h3>Phân công trong tuần</h3>
            <div className="wh-schedule-scroll"><table>
                <thead><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Quầy</th><th>Trạng thái</th>{manager && <th>Thao tác</th>}</tr></thead>
                <tbody>{assignments.map(item => <tr key={item.id}>
                    <td>{asDay(item.businessDate)}</td><td>{SHIFT_NAMES[item.shift]}</td><td>{item.user.displayName}</td>
                    <td>{item.branch.name}</td><td>{item.status === 'SCHEDULED' ? 'Đã phân công' : 'Đã hủy'}</td>
                    {manager && <td><button type="button" disabled={busy} onClick={() => void changeAssignment(item, item.status === 'SCHEDULED' ? 'CANCELLED' : 'SCHEDULED')}>
                        {item.status === 'SCHEDULED' ? 'Hủy ca' : 'Khôi phục'}</button></td>}
                </tr>)}{!assignments.length && <tr><td colSpan={manager ? 6 : 5}>Chưa có phân công cho tuần này.</td></tr>}</tbody>
            </table></div>
        </section>
    </section>;
}
