import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { fieldApi } from './field.api.ts';
import type { DeliveryStop } from './field.types.ts';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, StateNotice, Status, Warning,
  businessToday, parseQuantity, useFieldRead, useSafeMutation, ux } from './field.ui.tsx';
function decimalUnits(value:string):bigint|null {
  if(!parseQuantity(value))return null;
  const [whole,fraction='']=value.split('.');
  return BigInt(whole)*1000000n+BigInt((fraction+'000000').slice(0,6));
}
export function ReceivingScreen() {
  const [date,setDate]=useState(businessToday());
  const [selected,setSelected]=useState(businessToday());
  const query=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.trips(selected,signal),[selected]));
  return <Page title="Nhận hàng tại quầy" lead="Dành cho nhân viên hoặc quản lý được phân quyền tại quầy. Người giao không tự xác nhận hàng.">
    <Warning>Chỉ chọn ‘Đã đếm đủ’ sau khi kiểm đếm thực tế. Đối chiếu số lượng thực nhận, hàng hỏng và tên nguyên liệu trước khi bấm xác nhận. Khi mất mạng, không gửi lại cho đến khi kiểm tra trạng thái máy chủ.</Warning>
    <Panel><FieldInput label="Ngày giao (YYYY-MM-DD)" value={date} onChangeText={setDate}/>
      <Action label="Xem chuyến trong ngày" onPress={()=>setSelected(date)} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}/>
    </Panel>
    {query.value?.flatMap(trip=>trip.stops.map(stop=>({trip,stop}))).map(({trip,stop})=><Panel key={stop.id}>
      <Header>{stop.branch?.name??'Quầy'} · Chuyến {trip.code}</Header>
      <Status>{stop.status==='RECEIVED'?'Đã nhận hàng':stop.status==='DISPATCHED'?'Chờ đối chiếu':'Chưa xuất kho'}</Status>
      <Copy>{stop.items.length} mặt hàng · Điểm giao {stop.stopOrder}</Copy>
      <Action secondary label="Xem và đối chiếu từng SKU"
        onPress={()=>router.push({pathname:'/field/receive',params:{tripId:trip.id,stopId:stop.id}})}/>
    </Panel>)}
    {!query.value?.length&&!query.loading?<Copy>Chưa có chuyến giao hợp lệ trong ngày này.</Copy>:null}
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
  useEffect(()=>{
    if(!stop||initialised===stop.id)return;
    setQuantities(Object.fromEntries(stop.items.map(item=>[item.ingredientId,{
      received:item.receivedQuantity??'',damaged:item.damagedQuantity??'0',
    }])));
    setChecked(false);setInitialised(stop.id);
  },[stop,initialised]);
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
      {lines.map(({item,quantity,valid:validLine})=><Panel key={item.ingredientId}>
        <Header>{item.ingredient?.name??'Nguyên liệu'}</Header>
        <Copy>Mã: {item.ingredient?.code??'—'} · Dự kiến: {String(item.plannedQuantity)} {item.ingredient?.unit??''}</Copy>
        <Action secondary label="✓ Đã đếm đủ như dự kiến" onPress={()=>{setChecked(false);setQuantities(q=>({...q,[item.ingredientId]:{received:String(item.plannedQuantity),damaged:'0'}}));}}/>
        <FieldInput label={`Thực nhận (${item.ingredient?.unit??''})`} value={quantity?.received??''} keyboardType="decimal-pad"
          onChangeText={received=>{setChecked(false);setQuantities(q=>({...q,[item.ingredientId]:{received,damaged:q[item.ingredientId]?.damaged??'0'}}));}}/>
        <FieldInput label={`Hỏng (${item.ingredient?.unit??''})`} value={quantity?.damaged??''} keyboardType="decimal-pad"
          onChangeText={damaged=>{setChecked(false);setQuantities(q=>({...q,[item.ingredientId]:{received:q[item.ingredientId]?.received??'',damaged}}));}}/>
        {!validLine?<Warning>Số lượng không hợp lệ hoặc vượt lượng dự kiến.</Warning>:null}
      </Panel>)}
      {stop.status==='DISPATCHED'?<Panel>
        <FieldInput label="Ghi chú thiếu/hỏng (bắt buộc nếu có sai lệch)" value={note} onChangeText={value=>{setChecked(false);setNote(value);}} multiline/>
        <Warning>Nhận thiếu/hỏng sẽ tạo hồ sơ sai lệch. Không tự cộng số lượng thiếu vào tồn kho.</Warning>
        <Action secondary label={checked?'✓ Đã kiểm hàng thực tế':'Tôi đã trực tiếp kiểm tra hàng tại quầy'}
          onPress={()=>setChecked(v=>!v)} disabled={!valid||mutation.busy}/>
        <Action disabled={!valid||!checked||mutation.busy} label={mutation.busy?'Đang ghi nhận...':'XÁC NHẬN NHẬN HÀNG'}
          onPress={()=>{void mutation.execute(()=>fieldApi.receive(stop.id,lines.map(x=>({
            ingredientId:x.item.ingredientId,receivedQuantity:x.quantity!.received,damagedQuantity:x.quantity!.damaged,
          })),note.trim()||null),()=>{
            setChecked(false);void read.refresh();
          });}}/>
        {mutation.error?<StateNotice error={mutation.error}/>:null}
      </Panel>:<Warning>{stop.status==='RECEIVED'?'Điểm giao đã nhận; không được xác nhận lần hai.':'Chuyến chưa xuất kho; không được nhận trước.'}</Warning>}
    </>:!read.loading?<Copy>Điểm giao không còn khả dụng hoặc bạn không có quyền xem.</Copy>:null}
    <LoadControl loading={read.loading} error={read.error} onRefresh={()=>{void read.refresh();}}/>
  </Page>;
}
