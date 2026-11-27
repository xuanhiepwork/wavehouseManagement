import { useCallback, useState, useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { fieldApi } from './field.api.ts';
import type { WorkShift } from './field.types.ts';
import { FieldFormNotice, FieldFormReview, FieldFormToggle } from './FieldForm.ts';
import { FieldEmptyRecords, FieldListHeading } from './FieldRecordUI.tsx';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, Selection, StateNotice,
  Status, Warning, businessToday, formatShift, shifts, useFieldRead, useSafeMutation } from './field.ui.tsx';

export function RosterScreen(){
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [day,setDay]=useState(businessToday());const [date,setDate]=useState(businessToday());
  const [areaId,setAreaId]=useState(user?.areaId??'');
  const [shift,setShift]=useState<WorkShift>('MORNING');
  const [worker,setWorker]=useState('');const [branch,setBranch]=useState('');const [confirm,setConfirm]=useState(false);
  const [cancelId,setCancelId]=useState<string|null>(null);
  const areas=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.areas(signal),[]));
  const roster=useFieldRead(useCallback(async(signal:AbortSignal)=>{
    if(!areaId)return {users:[],branches:[],availability:[],assignments:[]};
    const [users,branches,availability,assignments]=await Promise.all([
      fieldApi.areaUsers(areaId,signal),fieldApi.areaBranches(areaId,signal),fieldApi.availability(day,day,signal,areaId),
      fieldApi.assignments(day,day,areaId,signal),
    ]);
    return {users,branches,availability,assignments};
  },[areaId,day]));
  const mutation=useSafeMutation();
  if(user?.role==='STAFF')return <Page title="Chỉ dành cho quản lý"><Warning>Nhân viên xem lịch của mình tại trang Ca làm.</Warning></Page>;
  const available=roster.value?.users.filter(u=>u.role==='STAFF'&&u.workKind==='SALES'
    &&roster.value?.availability.some(a=>a.userId===u.id&&a.shift===shift&&a.available))??[];
  const assignments=roster.value?.assignments??[];
  return <Page title="Phân công ca trong khu" lead="Chọn nhân viên đã đăng ký rảnh. Backend kiểm tra trùng ca và phạm vi khu vực trước khi lưu.">
    <Panel><Header>Khu vực phụ trách</Header>
      {areas.value?.filter(a=>a.isActive!==false).map(a=><Action key={a.id} secondary={areaId!==a.id}
        label={`${areaId===a.id?'✓ ':''}${a.name}`} onPress={()=>{setAreaId(a.id);setWorker('');setBranch('');setConfirm(false);}}/>)}
      <LoadControl loading={areas.loading} error={areas.error} onRefresh={()=>{void areas.refresh();}}/>
      <FieldInput label="Ngày ca (YYYY-MM-DD)" value={date} onChangeText={setDate}/>
      <Action label="Xem lịch ngày" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)} onPress={()=>{
        setDay(date);setWorker('');setBranch('');setConfirm(false);
      }}/>
      <Header>Ca muốn xếp</Header><Selection options={shifts} value={shift} onChange={v=>{setShift(v);setWorker('');setConfirm(false);}}/>
    </Panel>
    <FieldListHeading title="Ca đã phân công" count={roster.value ? assignments.filter(a=>a.shift===shift).length : undefined} unit="ca"/>
    {assignments.filter(a=>a.shift===shift).map(a=><Panel key={a.id}>
      <Header>{a.user?.displayName??'Nhân viên'}</Header>
      <Copy>{a.branch?.name??'Quầy'} · {formatShift(a.shift)}</Copy><Status>{a.status}</Status>
      {a.status==='SCHEDULED'?<>
        <Action secondary label="Xem yêu cầu hủy phân công" onPress={()=>setCancelId(a.id)}/>
        {cancelId===a.id?<>
          <FieldFormReview title="Rà soát hủy ca" items={[
            {label:'Nhân viên',value:a.user?.displayName??'—'},
            {label:'Quầy',value:a.branch?.name??'—'},
            {label:'Ngày',value:day},
            {label:'Ca',value:formatShift(a.shift)},
          ]}/>
          <FieldFormNotice tone="warning" message="Hủy ca sẽ cập nhật lịch trên máy chủ. Hãy thông báo trực tiếp cho nhân viên sau khi xác nhận."/>
          <Action disabled={mutation.busy} label={mutation.busy?'Đang xử lý...':'XÁC NHẬN HỦY CA'} onPress={()=>{
            void mutation.execute(()=>fieldApi.changeAssignment(a.id,a.version,{status:'CANCELLED'}),()=>{
              setCancelId(null);void roster.refresh();
            });
          }}/>
          <Action secondary label="Giữ nguyên ca" onPress={()=>setCancelId(null)}/>
        </>:null}
      </>:null}
    </Panel>)}
    <LoadControl loading={roster.loading} error={roster.error} onRefresh={()=>{void roster.refresh();}}/>
    {roster.value!==null&&!assignments.some(a=>a.shift===shift)?<FieldEmptyRecords title="Chưa có phân công trong ca này"/>:null}
    <Header>Xếp ca mới</Header>
    <Panel>
      <FieldFormNotice tone="warning" message="Người bán phải tự xác nhận rảnh trước. Backend sẽ kiểm tra trùng ca và phạm vi khu vực."/>
      <Header>Nhân viên đã đăng ký rảnh</Header>
      {available.map(u=><Action key={u.id} secondary={worker!==u.id} label={`${worker===u.id?'✓ ':''}${u.displayName}`}
        onPress={()=>{setWorker(u.id);setConfirm(false);}}/>)}
      {!available.length?<Copy>Không có nhân viên rảnh trong ca này.</Copy>:null}
      <Header>Quầy trong khu vực</Header>
      {roster.value?.branches.filter(b=>b.isActive!==false).map(b=><Action key={b.id}
        secondary={branch!==b.id} label={`${branch===b.id?'✓ ':''}${b.name}`} onPress={()=>{setBranch(b.id);setConfirm(false);}}/>)}
      <FieldFormReview title="Rà soát trước khi phân ca" items={[
        {label:'Ngày',value:day},
        {label:'Ca',value:formatShift(shift)},
        {label:'Nhân viên',value:roster.value?.users.find(u=>u.id===worker)?.displayName??'Chưa chọn'},
        {label:'Quầy',value:roster.value?.branches.find(b=>b.id===branch)?.name??'Chưa chọn'},
      ]}/>
      <FieldFormToggle label="Tôi đã đối chiếu nhân viên và quầy" value={confirm}
        onChange={setConfirm} disabled={!worker||!branch||mutation.busy}/>
      <Action label={mutation.busy?'Đang phân công...':'XÁC NHẬN PHÂN CA'}
        disabled={!worker||!branch||!confirm||mutation.busy} onPress={()=>{void mutation.execute(()=>fieldApi.createAssignment({
          userId:worker,branchId:branch,businessDate:day,shift,
        }),()=>{setWorker('');setConfirm(false);void roster.refresh();});}}/>
      {mutation.error?<StateNotice error={mutation.error}/>:null}
    </Panel>
  </Page>;
}
