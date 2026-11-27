import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { fieldApi } from './field.api.ts';
import { EvidenceContextCard } from './EvidenceContextCard';
import { FieldEmptyRecords, FieldListHeading } from './FieldRecordUI.tsx';
import { FieldFormNotice, FieldFormQuantityInput, FieldFormReview, FieldFormSection, FieldFormToggle } from './FieldForm.ts';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, StateNotice, Status, Warning,
  businessToday, parseQuantity, useFieldRead, useSafeMutation } from './field.ui.tsx';
function decimalUnits(value:string):bigint|null {
  if(!parseQuantity(value))return null;
  const [whole,fraction='']=value.split('.');
  return BigInt(whole)*1000000n+BigInt((fraction+'000000').slice(0,6));
}
export function ReceivingScreen() {
  const [date,setDate]=useState(businessToday());
  const [selected,setSelected]=useState(businessToday());
  const query=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.trips(selected,signal),[selected]));
  const stops = query.value?.flatMap(trip => trip.stops.map(stop => ({trip, stop}))) ?? [];
  return <Page title="Nhận hàng tại quầy" lead="Dành cho nhân viên hoặc quản lý được phân quyền tại quầy. Người giao không tự xác nhận hàng.">
    <FieldFormNotice tone="warning" title="Kiểm đếm trước khi xác nhận" message="Chỉ điền đủ sau khi kiểm đếm thực tế. Khi mất mạng, kiểm tra trạng thái máy chủ trước khi gửi lại."/>
    <Panel><FieldInput label="Ngày giao (YYYY-MM-DD)" value={date} onChangeText={setDate}/>
      <Action label="Xem chuyến trong ngày" onPress={()=>setSelected(date)} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}/>
    </Panel>
    <FieldListHeading title="Điểm giao cần đối chiếu" count={query.value ? stops.length : undefined} unit="điểm"/>
    {stops.map(({trip,stop})=><Panel key={stop.id}>
      <Header>{stop.branch?.name??'Quầy'} · Chuyến {trip.code}</Header>
      <Status>{stop.status==='RECEIVED'?'Đã nhận hàng':stop.status==='DISPATCHED'?'Chờ đối chiếu':'Chưa xuất kho'}</Status>
      <Copy>{stop.items.length} mặt hàng · Điểm giao {stop.stopOrder}</Copy>
      <Action secondary label="Xem và đối chiếu từng SKU"
        onPress={()=>router.push({pathname:'/field/receive',params:{tripId:trip.id,stopId:stop.id}})}/>
    </Panel>)}
    {query.value!==null&&stops.length===0?<FieldEmptyRecords title="Không có điểm giao" description="Chưa có điểm giao để đối chiếu trong ngày đã chọn."/>:null}
    <LoadControl loading={query.loading} error={query.error} onRefresh={()=>{void query.refresh();}}/>
  </Page>;
}
export function ReceiveStopScreen({tripId,stopId}: {tripId:string;stopId:string}) {
  const read=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.trip(tripId,signal),[tripId]));
  const stop=read.value?.stops.find(x=>x.id===stopId);
  const [quantities,setQuantities]=useState<Record<string,{received:string;damaged:string}>>({});
  const [note,setNote]=useState('');
  const [checked,setChecked]=useState(false);
  const [initialised,setInitialised]=useState<string|null>(null);
  const mutation=useSafeMutation();
  // Reset only when navigating to another stop; don't overwrite in-progress counts on refresh.
  if (stop && initialised !== stop.id) {
    setQuantities(Object.fromEntries(stop.items.map(item => [item.ingredientId, {
      received: item.receivedQuantity ?? '', damaged: item.damagedQuantity ?? '0',
    }])));
    setChecked(false);
    setNote('');
    setInitialised(stop.id);
  }
  const lines=stop?.items.map(item=>{
    const quantity=quantities[item.ingredientId];
    const received=quantity?decimalUnits(quantity.received):null;
    const damaged=quantity?decimalUnits(quantity.damaged):null;
    const planned=decimalUnits(String(item.plannedQuantity));
    const valid=received!==null&&damaged!==null&&planned!==null&&received+damaged<=planned
      &&(item.ingredient?.unit!=='piece'||(received%1000000n===0n&&damaged%1000000n===0n));
    const difference=valid&&(received!==planned||damaged!==0n);
    return {item,quantity,valid,difference};
  })??[];
  const valid=lines.length>0&&lines.every(x=>x.valid)
    &&(!lines.some(x=>x.difference)||note.trim().length>0);
  return <Page title="Đối chiếu giao nhận" lead="Thực nhận và số lượng hỏng cần nhập đủ cho từng SKU. Thông tin lưu trên máy chủ mới được xem là đã nhận.">
    {stop?<>
      <Panel><Header>{stop.branch?.name??'Quầy'}</Header>
        <Status>{stop.status==='RECEIVED'?'ĐÃ XÁC NHẬN':stop.status}</Status>
        <Copy>Điểm giao {stop.stopOrder} · {lines.length} nguyên liệu</Copy>
      </Panel>
      <EvidenceContextCard type="stop" id={stop.id} kind="receiving" label="Điểm nhận hàng"/>
      {lines.map(({item,quantity,valid:validLine})=><FieldFormSection key={item.ingredientId}
        title={item.ingredient?.name??'Nguyên liệu'}
        description={`Mã ${item.ingredient?.code??'—'} · Dự kiến ${String(item.plannedQuantity)} ${item.ingredient?.unit??''}`}>
        <Action secondary label="Điền theo số đã đếm đủ như dự kiến" disabled={stop.status!=='DISPATCHED'||mutation.busy}
          onPress={()=>{setChecked(false);setQuantities(q=>({...q,[item.ingredientId]:{received:String(item.plannedQuantity),damaged:'0'}}));}}/>
        <FieldFormQuantityInput label="Thực nhận" unit={item.ingredient?.unit??''} required
          value={quantity?.received??''} disabled={stop.status!=='DISPATCHED'||mutation.busy}
          helperText="Số lượng thực đếm tại quầy, không tự điền từ tồn hệ thống."
          error={quantity?.received&&!parseQuantity(quantity.received)?'Số không hợp lệ, tối đa 6 chữ số thập phân.':undefined}
          onChangeText={received=>{setChecked(false);setQuantities(q=>({...q,[item.ingredientId]:{received,damaged:q[item.ingredientId]?.damaged??'0'}}));}}/>
        <FieldFormQuantityInput label="Số lượng hỏng" unit={item.ingredient?.unit??''} required
          value={quantity?.damaged??''} disabled={stop.status!=='DISPATCHED'||mutation.busy}
          error={quantity?.damaged&&!parseQuantity(quantity.damaged)?'Số không hợp lệ, tối đa 6 chữ số thập phân.':undefined}
          onChangeText={damaged=>{setChecked(false);setQuantities(q=>({...q,[item.ingredientId]:{received:q[item.ingredientId]?.received??'',damaged}}));}}/>
        {!validLine?<FieldFormNotice tone="error" message="Kiểm tra số thực nhận + hỏng không vượt dự kiến; đơn vị cái phải là số nguyên."/>:null}
      </FieldFormSection>)}
      {stop.status==='DISPATCHED'?<FieldFormSection title="Rà soát và xác nhận" description="Phiếu chỉ được ghi nhận sau khi máy chủ xác nhận thành công.">
        <FieldFormReview title="Tóm tắt kiểm đếm" items={[
          {label:'Quầy nhận',value:stop.branch?.name??'—'},
          {label:'Tổng SKU',value:lines.length},
          {label:'SKU đã nhập hợp lệ',value:lines.filter(x=>x.valid).length,emphasis:true},
          {label:'SKU có chênh lệch/hỏng',value:lines.filter(x=>x.difference).length},
        ]}/>
        <FieldInput label="Ghi chú thiếu/hỏng (bắt buộc nếu có sai lệch)" value={note} onChangeText={value=>{setChecked(false);setNote(value);}} multiline/>
        <FieldFormNotice tone="warning" message="Nhận thiếu/hỏng sẽ tạo hồ sơ sai lệch. Không tự cộng số lượng thiếu vào tồn kho."/>
        <FieldFormToggle label="Tôi đã trực tiếp kiểm tra hàng tại quầy" value={checked}
          description="Chỉ xác nhận sau khi đối chiếu tất cả SKU thực tế." onChange={setChecked} disabled={!valid||mutation.busy}/>
        <Action disabled={!valid||!checked||mutation.busy} label={mutation.busy?'Đang ghi nhận...':'XÁC NHẬN NHẬN HÀNG'}
          onPress={()=>{void mutation.execute(()=>fieldApi.receive(stop.id,lines.map(x=>({
            ingredientId:x.item.ingredientId,receivedQuantity:x.quantity!.received,damagedQuantity:x.quantity!.damaged,
          })),note.trim()||null),()=>{
            setChecked(false);void read.refresh();
          });}}/>
        {mutation.error?<StateNotice error={mutation.error}/>:null}
      </FieldFormSection>:<Warning>{stop.status==='RECEIVED'?'Điểm giao đã nhận; không được xác nhận lần hai.':'Chuyến chưa xuất kho; không được nhận trước.'}</Warning>}
    </>:!read.loading?<Copy>Điểm giao không còn khả dụng hoặc bạn không có quyền xem.</Copy>:null}
    <LoadControl loading={read.loading} error={read.error} onRefresh={()=>{void read.refresh();}}/>
  </Page>;
}
