import { router } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { fieldApi } from './field.api.ts';
import type { WorkShift } from './field.types.ts';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, Selection, StateNotice,
  Status, Warning, businessToday, formatShift, parseQuantity, shifts, useFieldRead, useSafeMutation, ux } from './field.ui.tsx';
export function InventoryScreen(){
  const day=businessToday();const [shift,setShift]=useState<WorkShift>('MORNING');
  const [branchId,setBranchId]=useState('');const [page,setPage]=useState(1);
  const branches=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.branches(day,shift,signal),[day,shift]));
  const balances=useFieldRead(useCallback((signal:AbortSignal)=>branchId?fieldApi.inventory(branchId,page,signal):
    Promise.resolve({items:[],total:0,page}),[branchId,page]));
  return <Page title="Tồn kho quầy" lead="Chọn quầy được phép xem theo ngày. Dữ liệu phải tải từ máy chủ, không lấy giá trị cũ làm số thực đếm.">
    <Panel><Header>Ca cần xem</Header><Selection options={shifts} value={shift} onChange={v=>{setShift(v);setBranchId('');setPage(1);}}/>
      <Header>Quầy được phân công</Header>
      {branches.value?.map(b=><Action key={b.id} secondary={branchId!==b.id}
        label={`${branchId===b.id?'✓ ':''}${b.name}`} onPress={()=>{setBranchId(b.id);setPage(1);}}/>)}
      {!branches.value?.length?<Copy>Không có quầy được phân quyền trong ca này.</Copy>:null}
      <LoadControl loading={branches.loading} error={branches.error} onRefresh={()=>{void branches.refresh();}}/>
    </Panel>
    {branchId?<>
      <Action label="Bắt đầu kiểm kê quầy theo ca" onPress={()=>router.push({pathname:'/field/count-new',params:{branchId,shift}})}/>
      <Header>Tồn kho ghi nhận</Header>
      {balances.value?.items.map(item=><Panel key={item.ingredientId}>
        <Header>{item.ingredient?.name??'Nguyên liệu'}</Header>
        <Copy>{String(item.quantity)} {item.ingredient?.unit??''} · {item.ingredient?.code??''}</Copy>
      </Panel>)}
      {!balances.value?.items.length&&!balances.loading?<Copy>Không có bản ghi tồn kho trong trang này.</Copy>:null}
      {balances.value?.total&&balances.value.total>50?<View style={ux.row}>
        <Action secondary label="Trước" disabled={page<=1} onPress={()=>setPage(p=>Math.max(1,p-1))}/>
        <Copy>Trang {page}</Copy>
        <Action secondary label="Sau" disabled={page*50>=balances.value.total} onPress={()=>setPage(p=>p+1)}/>
      </View>:null}
      <LoadControl loading={balances.loading} error={balances.error} onRefresh={()=>{void balances.refresh();}}/>
    </>:null}
    <Copy small>Không sửa trực tiếp số lượng tồn kho từ điện thoại. Mọi điều chỉnh phải qua nghiệp vụ kiểm kê/duyệt của Backend.</Copy>
  </Page>;
}

export function CountNewScreen({branchId,shift}: {branchId:string;shift:WorkShift}) {
  const day=businessToday();
  const [date,setDate]=useState(day);
  const [selectedDay,setSelectedDay]=useState(day);
  const [values,setValues]=useState<Record<string,string>>({});
  const [note,setNote]=useState('');const [confirmed,setConfirmed]=useState(false);
  const template=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.countTemplate(branchId,selectedDay,shift,signal),[branchId,selectedDay,shift]));
  const mutation=useSafeMutation();
  const records=template.value?.items??[];
  const completed=records.filter(i=>parseQuantity(values[i.ingredientId]??'')).length;
  const valid=records.length>0&&completed===records.length;
  return <Page title="Kiểm kê theo ca" lead="Nhập số lượng thực tế từng nguyên liệu. Không tự điền số hệ thống vào ô đếm.">
    <Warning>Hãy thực sự đếm đủ mọi SKU. Gửi bản nháp trước, sau đó mới thực hiện duyệt theo quy trình; kiểm kê có thể ảnh hưởng số tồn sau phê duyệt.</Warning>
    <Panel>
      <FieldInput label="Ngày kiểm kê (YYYY-MM-DD)" value={date} onChangeText={setDate}/>
      <Action secondary label="Tải mẫu ngày đã chọn" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
        onPress={()=>{setSelectedDay(date);setValues({});setConfirmed(false);}}/>
      <Header>Ca {formatShift(shift)} · Tiến độ {completed}/{records.length}</Header>
      <Copy small>Nhập đầy đủ mới được lưu nháp.</Copy>
    </Panel>
    {records.map(record=><Panel key={record.ingredientId}>
      <Header>{record.name} ({record.code})</Header>
      <Copy small>Hệ thống: {String(record.systemQuantity)} {record.unit} · Chỉ để tham khảo</Copy>
      <FieldInput label={`Thực đếm (${record.unit})`} value={values[record.ingredientId]??''} keyboardType="decimal-pad"
        onChangeText={text=>{setConfirmed(false);setValues(prev=>({...prev,[record.ingredientId]:text}));}}/>
      {!parseQuantity(values[record.ingredientId]??'')&&values[record.ingredientId]!==undefined?
        <Warning>Chỉ nhập số không âm với tối đa 6 chữ số thập phân.</Warning>:null}
    </Panel>)}
    <LoadControl loading={template.loading} error={template.error} onRefresh={()=>{void template.refresh();}}/>
    {records.length?<Panel>
      <FieldInput label="Ghi chú kiểm kê" value={note} onChangeText={v=>{setConfirmed(false);setNote(v);}} multiline/>
      <Action secondary label={confirmed?'✓ Tôi đã đếm đủ mặt hàng':'Tôi xác nhận đã kiểm đếm thực tế'}
        disabled={!valid} onPress={()=>setConfirmed(v=>!v)}/>
      <Action label={mutation.busy?'Đang lưu...':'LƯU PHIẾU KIỂM KÊ NHÁP'} disabled={!confirmed||mutation.busy||!valid}
        onPress={()=>{void mutation.execute(()=>fieldApi.createCount({branchId,businessDate:selectedDay,shift,note:note.trim()||null,
          items:records.map(r=>({ingredientId:r.ingredientId,countedQuantity:values[r.ingredientId]})),
        }),result=>router.replace({pathname:'/field/count/[id]',params:{id:result.id}}));}}/>
      {mutation.error?<StateNotice error={mutation.error}/>:null}
    </Panel>:null}
  </Page>;
}
export function CountScreen({id}: {id:string}) {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const query=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.stockCount(id,signal),[id]));
  const [reason,setReason]=useState('');const [armed,setArmed]=useState<'submit'|'approve'|'return'|null>(null);
  const mutation=useSafeMutation();const data=query.value;
  const manager=user?.role==='ADMIN'||user?.role==='BRANCH_MANAGER';
  const action=()=>{
    if(!armed)return;
    void mutation.execute(()=>armed==='submit'?fieldApi.submitCount(id):armed==='approve'?fieldApi.approveCount(id):
      fieldApi.returnCount(id,reason.trim()),()=>{setArmed(null);setReason('');void query.refresh();});
  };
  return <Page title="Phiếu kiểm kê" lead="Đối chiếu từng dòng và trạng thái trước khi gửi/duyệt.">
    {data?<>
      <Panel><Header>Ngày {String(data.businessDate).slice(0,10)} · {formatShift(data.shift)}</Header>
        <Status>{data.status}</Status><Copy>{data.note??'Không ghi chú'}</Copy>
        {data.returnReason?<Warning>Lý do trả: {data.returnReason}</Warning>:null}
      </Panel>
      {data.items.map(item=><Panel key={item.ingredientId}>
        <Copy>SKU: {item.ingredientId}</Copy><Copy>Đã đếm: {String(item.countedQuantity)}</Copy>
        <Copy small>Đối chiếu hệ thống: {item.expectedQuantity===null?'Chưa chốt':String(item.expectedQuantity)}</Copy>
      </Panel>)}
      {['DRAFT','RETURNED'].includes(data.status)&&user?.role==='STAFF'?<>
        <Action secondary label="Sửa số lượng thực đếm" onPress={()=>router.push({pathname:'/field/count-edit',params:{id}})}/>
        <Action label="Chuẩn bị gửi phiếu duyệt" onPress={()=>setArmed('submit')}/>
      </>:null}
      {data.status==='SUBMITTED'&&manager?<>
        <Action label="Chuẩn bị duyệt kiểm kê" onPress={()=>setArmed('approve')}/>
        <Action secondary label="Trả phiếu về để bổ sung" onPress={()=>setArmed('return')}/>
      </>:null}
      {armed?<Panel><Warning>Kiểm kê duyệt có thể làm thay đổi số tồn. Chỉ xác nhận nếu đã đối chiếu đầy đủ thông tin trên máy chủ.</Warning>
        {armed==='return'?<FieldInput label="Lý do trả lại" value={reason} onChangeText={setReason} multiline/>:null}
        <Action label={mutation.busy?'Đang xử lý...':'XÁC NHẬN '+armed.toUpperCase()} disabled={mutation.busy||(armed==='return'&&!reason.trim())}
          onPress={action}/>
        <Action secondary label="Hủy thao tác" onPress={()=>setArmed(null)}/>
      </Panel>:null}
      {mutation.error?<StateNotice error={mutation.error}/>:null}
    </>:null}
    <LoadControl loading={query.loading} error={query.error} onRefresh={()=>{void query.refresh();}}/>
  </Page>;
}

/** Edit only an existing DRAFT/RETURNED stock count. Every SKU is re-entered from its saved actual quantity,
 * never silently replaced by current theoretical stock. */
export function CountEditScreen({id}:{id:string}) {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const query=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.stockCount(id,signal),[id]));
  const [original,setOriginal]=useState<string|null>(null);
  const [values,setValues]=useState<Record<string,string>>({});
  const [note,setNote]=useState('');
  const [verified,setVerified]=useState(false);
  const mutation=useSafeMutation();
  const record=query.value;
  // Initialize once for each new record ID; guarded render-phase adjustment avoids effect cascades.
  // Refreshing the same record must not erase unsaved field edits.
  if (record && record.id !== original) {
    setOriginal(record.id);
    setNote(record.note ?? '');
    setValues(Object.fromEntries(record.items.map(item => [item.ingredientId, String(item.countedQuantity)])));
    setVerified(false);
  }
  const editable=user?.role==='STAFF'&&!!record&&['DRAFT','RETURNED'].includes(record.status);
  const valid=!!record?.items.length&&record.items.every(item=>parseQuantity(values[item.ingredientId]??''));
  return <Page title="Bổ sung phiếu kiểm kê" lead="Chỉ sửa phiếu bản nháp hoặc bị trả lại. Mọi số lượng là số thực đếm, không phải số hệ thống.">
    {record?<Panel>
      <Header>{String(record.businessDate).slice(0,10)} · {formatShift(record.shift)}</Header>
      <Status>{record.status}</Status>
      {record.returnReason?<Warning>Lý do trả: {record.returnReason}</Warning>:null}
    </Panel>:null}
    {!editable&&record?<Warning>Phiếu đã gửi duyệt hoặc bạn không có quyền sửa. Hãy xem chi tiết thay vì gửi lại.</Warning>:null}
    {editable? <>
      <Warning>Kiểm đếm thực tế trước khi sửa. Mất mạng không tự gửi lại PATCH; hãy xem lại phiếu trên máy chủ.</Warning>
      {record!.items.map(item=><Panel key={item.ingredientId}>
        <Copy small>Nguyên liệu: {item.ingredientId}</Copy>
        <FieldInput label="Số lượng thực đếm" keyboardType="decimal-pad"
          value={values[item.ingredientId]??''} onChangeText={text=>{setVerified(false);setValues(old=>({...old,[item.ingredientId]:text}));}}/>
      </Panel>)}
      <Panel>
        <FieldInput label="Ghi chú bổ sung" value={note} onChangeText={text=>{setVerified(false);setNote(text);}} multiline/>
        <Action secondary label={verified?'✓ Đã đối chiếu từng SKU':'Tôi đã đối chiếu tất cả số lượng'}
          disabled={!valid||mutation.busy} onPress={()=>setVerified(flag=>!flag)}/>
        <Action label={mutation.busy?'Đang lưu...':'LƯU SỐ THỰC ĐẾM'}
          disabled={!valid||!verified||mutation.busy} onPress={()=>{
            void mutation.execute(()=>fieldApi.updateCount(id,{note:note.trim()||null,
              items:record!.items.map(item=>({ingredientId:item.ingredientId,countedQuantity:values[item.ingredientId]})),
            }),()=>router.replace({pathname:'/field/count/[id]',params:{id}}));
          }}/>
        {mutation.error?<StateNotice error={mutation.error}/>:null}
      </Panel>
    </>:null}
    <LoadControl loading={query.loading} error={query.error} onRefresh={()=>{void query.refresh();}}/>
  </Page>;
}
