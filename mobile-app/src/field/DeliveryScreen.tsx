import { useCallback, useState, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { fieldApi } from './field.api.ts';
import { EvidenceContextCard } from './EvidenceContextCard';
import { FieldFormNotice, FieldFormReview, FieldFormToggle } from './FieldForm.ts';
import { FieldEmptyRecords, FieldFactRow, FieldListHeading } from './FieldRecordUI.tsx';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, StateNotice,
  Status, Warning, businessToday, useFieldRead, useSafeMutation } from './field.ui.tsx';

export function DeliveryScreen() {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [date,setDate]=useState(businessToday());
  const [selected,setSelected]=useState(businessToday());
  const source=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.trips(selected,signal),[selected]));
  const courier=user?.role==='STAFF'&&user.workKind==='KITCHEN_DELIVERY';
  const visible=source.value?.filter(t=>!courier||t.courierId===user?.id)??[];
  return <Page title="Chuyến giao hàng" lead="Danh sách theo ngày, điểm giao và tình trạng xác nhận thực tế.">
    <Warning>⛔ Không xem điện thoại khi đang điều khiển xe. Chỉ mở chuyến hoặc xác nhận thao tác sau khi đã dừng xe an toàn.</Warning>
    <Panel><FieldInput label="Ngày giao (YYYY-MM-DD)" value={date} onChangeText={setDate}/>
      <Action label="Xem chuyến theo ngày" onPress={()=>setSelected(date)} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}/>
    </Panel>
    <FieldListHeading title={`Chuyến ngày ${selected}`} count={source.value ? visible.length : undefined} unit="chuyến"/>
    {visible.map(trip=><Panel key={trip.id}>
      <Header>{trip.code}</Header><Status>{trip.status==='DRAFT'?'Chờ xuất kho':trip.status==='IN_TRANSIT'?'Đang giao':'Đã hoàn tất'}</Status>
      <FieldFactRow label="Kho xuất" value={trip.warehouse?.name}/>
      <FieldFactRow label="Điểm giao" value={trip.stops.length}/>
      <FieldFactRow label="Người phụ trách" value={trip.courier?.displayName??'Chưa gán'}/>
      <Action label="Xem điểm giao / xử lý chuyến" onPress={()=>router.push({pathname:'/field/trip/[id]',params:{id:trip.id}})}/>
    </Panel>)}
    {source.value!==null&&!visible.length?<FieldEmptyRecords title="Không có chuyến trong ngày" description="Không có chuyến thuộc phạm vi tài khoản của bạn với ngày đã chọn."/>:null}
    <LoadControl loading={source.loading} error={source.error} onRefresh={()=>{void source.refresh();}}/>
  </Page>;
}

export function TripScreen({id}: {id:string}) {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [stopped,setStopped]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const source=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.trip(id,signal),[id]));
  const mutation=useSafeMutation();
  const trip=source.value;
  const canDispatch=!!trip&&trip.status==='DRAFT'&&(user?.role==='ADMIN'||
    (user?.role==='STAFF'&&user.workKind==='KITCHEN_DELIVERY'&&trip.courierId===user.id));
  return <Page title="Chi tiết chuyến" lead="Đọc thông tin trước khi xuất kho. Không tạo chuyến mới hoặc sửa kế hoạch đã duyệt từ điện thoại.">
    <FieldFormNotice tone="warning" title="An toàn giao hàng" message="Chỉ thao tác sau khi dừng xe an toàn. Không dùng màn hình khi đang chạy xe, kể cả để xem điểm kế tiếp."/>
    {trip?<>
      <Panel><Header>{trip.code}</Header><Status>{trip.status}</Status>
        <FieldFactRow label="Kho xuất" value={trip.warehouse?.name}/>
        <FieldFactRow label="Ngày" value={String(trip.businessDate).slice(0,10)}/>
        <FieldFactRow label="Điểm giao" value={trip.stops.length}/>
      </Panel>
      <EvidenceContextCard type="trip" id={trip.id} kind="delivery" label="Chuyến giao hàng"/>
      {trip.stops.map(stop=><Panel key={stop.id}>
        <Header>Điểm {stop.stopOrder}: {stop.branch?.name??'Quầy'}</Header>
        <Status>{stop.status==='RECEIVED'?'Quầy đã nhận':stop.status==='DISPATCHED'?'Chờ quầy xác nhận':'Chưa xuất chuyến'}</Status>
        {stop.items.map(item=><Copy key={item.ingredientId}>{item.ingredient?.name??'Nguyên liệu'}: {String(item.plannedQuantity)} {item.ingredient?.unit??''}</Copy>)}
        <Copy small>Người giao không được tự xác nhận nhận hàng thay nhân viên quầy.</Copy>
      </Panel>)}
      {canDispatch?<Panel>
        <Header>Xuất chuyến từ kho đã duyệt</Header>
        <Copy>Chỉ thực hiện khi đã kiểm tra hàng thực tế và kế hoạch đã được phê duyệt.</Copy>
        <FieldFormReview title="Rà soát chuyến trước khi xuất" items={[
          {label:'Mã chuyến',value:trip.code},
          {label:'Kho xuất',value:trip.warehouse?.name??'—'},
          {label:'Ngày kinh doanh',value:String(trip.businessDate).slice(0,10)},
          {label:'Số điểm giao',value:trip.stops.length,emphasis:true},
          {label:'Số dòng nguyên liệu',value:trip.stops.reduce((sum,point)=>sum+point.items.length,0)},
        ]}/>
        <FieldFormToggle label="Tôi đã dừng xe an toàn" description="Bắt buộc trước khi xác nhận chuyến."
          value={stopped} onChange={next=>{setStopped(next);setConfirm(false);}} disabled={mutation.busy}/>
        <FieldFormToggle label="Tôi đã đối chiếu hàng và điểm giao" description="Đã kiểm tra thực tế theo kế hoạch xuất kho."
          value={confirm} onChange={setConfirm} disabled={!stopped||mutation.busy}/>
        <Action label={mutation.busy?'Đang xuất chuyến...':'XUẤT CHUYẾN (ẢNH HƯỞNG TỒN KHO)'}
          disabled={!stopped||!confirm||mutation.busy} onPress={()=>{void mutation.execute(()=>fieldApi.dispatch(trip.id),()=>{
            setConfirm(false);setStopped(false);void source.refresh();
          });}}/>
        {mutation.error?<StateNotice error={mutation.error}/>:null}
      </Panel>:null}
    </>:!source.loading?<Copy>Không tìm thấy chuyến hoặc bạn không được phân quyền xem.</Copy>:null}
    <LoadControl loading={source.loading} error={source.error} onRefresh={()=>{void source.refresh();}}/>
  </Page>;
}
