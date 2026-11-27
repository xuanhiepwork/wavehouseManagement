import { useCallback, useState, useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { fieldApi } from './field.api.ts';
import type { WorkShift } from './field.types.ts';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, Selection, StateNotice,
  Status, Warning, businessToday, formatShift, shifts, useFieldRead, useSafeMutation } from './field.ui.tsx';
const validDay=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  &&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
export function ScheduleScreen() {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [date,setDate]=useState(businessToday());
  const [shift,setShift]=useState<WorkShift>('MORNING');
  const [available,setAvailable]=useState(true);
  const [selectedDay,setSelectedDay]=useState(businessToday());
  const [selectedArea,setSelectedArea]=useState(user?.areaId??'');
  const areas=useFieldRead(useCallback((signal:AbortSignal)=>user?.role==='ADMIN'?fieldApi.areas(signal):Promise.resolve([]),[user?.role]));
  const isSales=user?.role==='STAFF'&&user.workKind==='SALES';
  const query=useFieldRead(useCallback(async(signal:AbortSignal)=>{
    if(!validDay(selectedDay))throw Error('Ngày cần đúng YYYY-MM-DD.');
    if(user?.role==='ADMIN'&&!selectedArea)return {assignments:[],availability:[]};
    const assignments=await fieldApi.assignments(selectedDay,selectedDay,user?.role==='ADMIN'?selectedArea:user?.areaId??undefined,signal);
    const availability=isSales?await fieldApi.availability(selectedDay,selectedDay,signal):[];
    return {assignments,availability};
  },[selectedDay,user?.role,user?.areaId,isSales,selectedArea]));
  const mutation=useSafeMutation();
  return <Page title="Lịch làm việc" lead="Hiển thị đúng quầy, ngày và ca trên máy chủ. Lưu lịch rảnh chỉ cho chính tài khoản nhân viên.">
    {user?.role==='ADMIN'?<Panel>
      <Header>Chọn khu vực xem lịch</Header>
      {areas.value?.map(area=><Action key={area.id} secondary={selectedArea!==area.id}
        label={`${selectedArea===area.id?'✓ ':''}${area.name}`} onPress={()=>setSelectedArea(area.id)}/>)}
      <LoadControl loading={areas.loading} error={areas.error} onRefresh={()=>{void areas.refresh();}}/>
    </Panel>:null}
    <Panel>
      <FieldInput label="Ngày (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-11-26"/>
      <Action label="Xem ngày đã chọn" disabled={!validDay(date)} onPress={()=>setSelectedDay(date)}/>
    </Panel>
    <Header>Phân công ngày {selectedDay}</Header>
    {query.value?.assignments.length ? query.value.assignments.map(a=><Panel key={a.id}>
      <Header>{a.branch?.name??'Quầy'}</Header>
      <Copy>{formatShift(a.shift)} · {a.status==='SCHEDULED'?'Đang phân công':'Đã hủy'}</Copy>
      {user?.role!=='STAFF'?<Copy small>Nhân viên: {a.user?.displayName??'—'}</Copy>:null}
    </Panel>):<Copy>Chưa có ca trong ngày này hoặc chưa tải được dữ liệu.</Copy>}
    <LoadControl loading={query.loading} error={query.error} onRefresh={()=>{void query.refresh();}}/>
    {isSales?<>
      <Header>Đăng ký thời gian rảnh</Header>
      <Panel>
        <Copy>Chọn đúng ngày và ca. Nếu ca đã được phân công, không thể đánh dấu không rảnh mà bỏ qua quản lý.</Copy>
        <Selection options={shifts} value={shift} onChange={setShift}/>
        <Selection options={[{code:'YES',label:'Tôi rảnh'},{code:'NO',label:'Tôi bận'}] as const}
          value={available?'YES':'NO'} onChange={v=>setAvailable(v==='YES')}/>
        {query.value?.availability.filter(a=>a.shift===shift).map(a=><Status key={a.id}>
          Đã lưu trên máy chủ: {a.available?'Rảnh':'Bận'}
        </Status>)}
        <Action label={mutation.busy?'Đang ghi nhận...':'Lưu thời gian rảnh'} disabled={mutation.busy}
          onPress={()=>{void mutation.execute(()=>fieldApi.setAvailability(selectedDay,shift,available),()=>{void query.refresh();});}}/>
        {mutation.error?<StateNotice error={mutation.error}/>:null}
      </Panel>
    </>:<Warning>Phân công ca mới/đổi ca cần đối chiếu nhân sự và lịch rảnh. Màn hình này hiện ưu tiên tra cứu; không thay đổi ca hàng loạt ngoài hiện trường.</Warning>}
    <Copy small>Chỉ những lịch do máy chủ xác nhận mới có hiệu lực. Đừng coi trạng thái trên điện thoại là bằng chứng hoàn tất khi mạng yếu.</Copy>
  </Page>;
}
