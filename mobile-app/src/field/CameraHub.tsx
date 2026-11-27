import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { listSavedEvidence, savedImageSource, uploadEvidence, type UploadedEvidence } from './evidence.api';
import * as ImagePicker from 'expo-image-picker';
import { BrandIcon } from '../design/BrandIcon.tsx';
import { BrandBadge } from '../design/doclap/BrandBadge';
import { BrandButton } from '../design/doclap/BrandButton';
import { BrandCard } from '../design/doclap/BrandCard';
import { BrandHubLayout, BrandSectionTitle } from '../design/doclap/BrandHubLayout';
import { controls, palette, radii, spacing, typography } from '../design/doclap/theme';
import {
  addEvidence, clearEvidenceTarget, evidenceFor, getEvidenceSnapshot,
  MAX_PER_TARGET, MAX_TOTAL_DRAFTS, parseEvidenceTarget, removeEvidence,
  subscribeEvidence, updateEvidenceNote,
  type EvidenceKind,
} from './evidence.store';

const CATEGORIES: readonly {key:EvidenceKind;label:string}[] = [
  {key:'delivery',label:'Giao hàng'},
  {key:'receiving',label:'Nhận hàng'},
  {key:'inventory',label:'Kiểm kê'},
  {key:'damage',label:'Sai lệch / hư hỏng'},
];
const LABELS = {trip:'Chuyến giao',stop:'Điểm nhận hàng',count:'Phiếu kiểm kê',general:'Ảnh tự do'} as const;
function kindLabel(kind:EvidenceKind) {
  return CATEGORIES.find(item=>item.key===kind)?.label??'Minh chứng';
}
function suggestedKind(type:string):EvidenceKind {
  return type==='trip'?'delivery':type==='stop'?'receiving':'inventory';
}

/** Local drafts become server evidence only after a confirmed POST response. */
export function CameraHub({targetType,targetId,initialKind}: {
  targetType?:unknown;targetId?:unknown;initialKind?:unknown;
}) {
  const target = parseEvidenceTarget(targetType,targetId);
  const snapshot = useSyncExternalStore(subscribeEvidence,getEvidenceSnapshot,getEvidenceSnapshot);
  const drafts = evidenceFor(target,snapshot);
  const [category,setCategory] = useState<EvidenceKind>(() =>
    CATEGORIES.some(item=>item.key===initialKind) ? initialKind as EvidenceKind : suggestedKind(target.type));
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState<UploadedEvidence[]>([]);
  const [savedBusy,setSavedBusy] = useState(false);
  const [saveBusy,setSaveBusy] = useState(false);
  const [savedMessage,setSavedMessage] = useState('');
  useEffect(() => {
    let active = true;
    setSaved([]);
    if (target.type !== 'general') {
      setSavedBusy(true);
      void listSavedEvidence(target).then(rows => { if (active) setSaved(rows); })
        .catch(() => { if (active) setSavedMessage('Chua tai duoc danh sach anh da luu.'); })
        .finally(() => { if (active) setSavedBusy(false); });
    }
    return () => { active = false; };
  }, [target.type, target.id]);
  const uploadSelected = async () => {
    if (saveBusy || !selected || target.type === 'general') return;
    setSaveBusy(true);
    setSavedMessage('');
    setError('');
    try {
      const item = await uploadEvidence(target, selected);
      setSaved(current => current.some(row => row.id === item.id) ? current : [...current, item]);
      removeEvidence(selected.id);
      setSelectedId(null);
      setSavedMessage('Anh da duoc luu tren Backend cua phieu nay.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Khong tai duoc anh len Backend.');
    } finally { setSaveBusy(false); }
  };
  const inProgress = useRef(false);
  const selected = drafts.find(draft=>draft.id===selectedId)??drafts[0]??null;
  const kinds = target.type==='trip' ? CATEGORIES.filter(item=>item.key==='delivery')
    : target.type==='stop' ? CATEGORIES.filter(item=>item.key==='receiving'||item.key==='damage')
    : target.type==='count' ? CATEGORIES.filter(item=>item.key==='inventory'||item.key==='damage')
    : CATEGORIES;
  const kind = kinds.some(item=>item.key===category) ? category : kinds[0].key;

  const capture = async (source:'camera'|'library') => {
    if (inProgress.current) return;
    if (drafts.length>=MAX_PER_TARGET || snapshot.items.length>=MAX_TOTAL_DRAFTS) {
      setError('Đã đạt giới hạn ảnh nháp. Hãy xóa ảnh không cần thiết trước.');return;
    }
    inProgress.current = true;
    setBusy(true);
    setError('');
    try {
      if (source==='camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Chưa có quyền sử dụng Camera. Hãy cấp quyền trong cài đặt thiết bị.');return;
        }
      }
      const options:ImagePicker.ImagePickerOptions = {
        mediaTypes:['images'],allowsEditing:false,exif:false,base64:true,
        quality:0.8,allowsMultipleSelection:false,
      };
      const result = source==='camera' ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      const photo = addEvidence({uri:asset.uri,kind,target,base64:asset.base64??undefined,
        mimeType:asset.mimeType??undefined});
      setSelectedId(photo.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể mở ảnh trên thiết bị.');
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  };
  const clear = () => Alert.alert('Xóa ảnh nháp của mục này?',
    'Ảnh và ghi chú sẽ được gỡ khỏi phiên làm việc. Ảnh gốc trong thư viện không bị xóa.',[
      {text:'Hủy',style:'cancel'},
      {text:'Xóa ảnh nháp',style:'destructive',onPress:()=>{
        clearEvidenceTarget(target);setSelectedId(null);setError('');
      }},
    ]);
  return <BrandHubLayout eyebrow="ĐỘC LẬP · CAMERA" title="Minh chứng hiện trường"
    description="Chụp, phân loại và ghi chú ảnh theo phiếu nghiệp vụ."
    footer="Ảnh nháp chưa gửi chỉ tồn tại trong phiên đăng nhập. Ảnh được Backend xác nhận mới được tính là minh chứng đã lưu.">
    <BrandCard variant="subtle" style={styles.notice}>
      <BrandBadge label="ẢNH NHÁP CHƯA GỬI" tone="warning" />
      <Text style={styles.noticeText}>Ảnh nháp chưa được lưu trên máy chủ. Chỉ ảnh có xác nhận lưu từ Backend mới được xem là minh chứng của phiếu. Camera không thay đổi trạng thái nghiệp vụ.</Text>
    </BrandCard>
    <BrandCard style={styles.context}>
      <Text style={styles.contextLabel}>Ngữ cảnh ảnh</Text>
      <Text style={styles.contextTitle}>{LABELS[target.type]}{target.type!=='general' ? ` · ${target.id.slice(0,8)}` : ''}</Text>
      <Text style={styles.contextSub}>Số ảnh của mục: {drafts.length}/{MAX_PER_TARGET} · Toàn phiên: {snapshot.items.length}/{MAX_TOTAL_DRAFTS} · Đã lưu: {saved.length}/5</Text>
      {target.type!=='general' ? <BrandButton title="Quay lại phiếu" variant="outline" onPress={()=>router.back()} fullWidth/>:null}
    </BrandCard>
    <BrandSectionTitle subtitle="Chỉ chọn những loại phù hợp với nghiệp vụ đang mở">Loại minh chứng</BrandSectionTitle>
    <View style={styles.categories}>{kinds.map(item=><Pressable key={item.key}
      accessibilityRole="button" accessibilityLabel={`Loại ảnh: ${item.label}`}
      accessibilityState={{selected:kind===item.key}}
      onPress={()=>setCategory(item.key)}
      style={[styles.category,kind===item.key&&styles.active]}>
      <Text style={[styles.categoryText,kind===item.key&&styles.categoryTextActive]}>{item.label}</Text>
    </Pressable>)}</View>
    <View style={styles.actions}>
      <View style={styles.slot}><BrandButton title="Chụp ảnh" variant="accent"
        icon={<BrandIcon name="camera" color="#FFFFFF" size={22}/>}
        disabled={busy||drafts.length>=MAX_PER_TARGET||snapshot.items.length>=MAX_TOTAL_DRAFTS}
        loading={busy} onPress={()=>{void capture('camera');}} fullWidth/></View>
      <View style={styles.slot}><BrandButton title="Chọn từ máy" variant="outline"
        disabled={busy||drafts.length>=MAX_PER_TARGET||snapshot.items.length>=MAX_TOTAL_DRAFTS}
        onPress={()=>{void capture('library');}} fullWidth/></View>
    </View>
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    <BrandSectionTitle subtitle="Chỉ hiển thị các ảnh nháp thuộc mục đang chọn">Ảnh và ghi chú</BrandSectionTitle>
    {!selected?<BrandCard style={styles.empty}>
      <BrandIcon name="camera" color={palette.burgundy} size={32}/>
      <Text style={styles.emptyTitle}>Chưa có ảnh nháp</Text>
      <Text style={styles.emptyText}>Chụp ảnh hoặc chọn ảnh có sẵn để chuẩn bị minh chứng.</Text>
    </BrandCard>:<BrandCard style={styles.previewCard}>
      <Image source={{uri:selected.uri}} style={styles.preview} resizeMode="contain" accessibilityLabel="Ảnh đang xem trước"/>
      <BrandBadge label={kindLabel(selected.kind)} tone="neutral" />
      <Text style={styles.inputLabel}>Ghi chú ảnh (chưa gửi)</Text>
      <TextInput accessibilityLabel="Ghi chú ảnh minh chứng" value={selected.note}
        onChangeText={text=>updateEvidenceNote(selected.id,text)}
        placeholder="Ví dụ: Thùng hàng bị móp tại quầy..." placeholderTextColor={palette.textSecondary}
        multiline maxLength={500} style={styles.noteInput}/>
      <Text style={styles.counter}>{selected.note.length}/500 ký tự</Text>
      {target.type !== 'general' ? <BrandButton title={saveBusy ? 'Đang gửi...' : 'Gửi ảnh lên máy chủ'}
        variant="accent" loading={saveBusy} disabled={saveBusy || saved.length >= 5 || !selected.base64 || !selected.mimeType}
        onPress={() => {void uploadSelected();}} fullWidth/> :
        <Text style={styles.noticeText}>Anh tu do khong gan voi phieu nen khong duoc tai len may chu.</Text>}
      <BrandButton title="Gỡ ảnh này khỏi danh sách" variant="outline" fullWidth
        onPress={()=>{removeEvidence(selected.id);setSelectedId(null);}}/>
    </BrandCard>}
    {drafts.length>1?<View style={styles.thumbnails}>{drafts.map((draft,index)=><Pressable
      key={draft.id} accessibilityRole="button" accessibilityLabel={`Xem ảnh số ${index+1}`}
      accessibilityState={{selected:draft.id===selected?.id}}
      onPress={()=>setSelectedId(draft.id)} style={[styles.thumbWrap,draft.id===selected?.id&&styles.thumbActive]}>
      <Image source={{uri:draft.uri}} style={styles.thumb} resizeMode="cover"/>
      <Text style={styles.thumbNumber}>{index+1}</Text>
    </Pressable>)}</View>:null}
    {target.type !== 'general' ? <>
      <BrandSectionTitle subtitle="Ảnh xác nhận lưu trên Backend, chỉ người có quyền mới xem được">Minh chứng đã lưu ({saved.length}/5)</BrandSectionTitle>
      {savedBusy ? <Text style={styles.noticeText}>Đang tải danh sách minh chứng...</Text> : null}
      {savedMessage ? <Text style={styles.noticeText}>{savedMessage}</Text> : null}
      {saved.map(item => {
        const source = savedImageSource(target,item);
        return <BrandCard key={item.id} style={styles.savedCard}>
          {source ? <Image source={source} style={styles.savedThumb} resizeMode="cover"/> : null}
          <View style={{flex:1}}>
            <BrandBadge tone="success" label="ĐÃ LƯU MÁY CHỦ"/>
            <Text style={styles.contextSub}>{item.kind} · {new Date(item.createdAt).toLocaleString('vi-VN')}</Text>
            {item.note ? <Text style={styles.noticeText}>{item.note}</Text> : null}
          </View>
        </BrandCard>;
      })}
    </> : null}
    {drafts.length ? <BrandButton title="Xóa tất cả ảnh nháp của mục này" variant="ghost" onPress={clear} fullWidth/>:null}
  </BrandHubLayout>;
}
const styles=StyleSheet.create({
  notice:{gap:spacing.sm},
  savedCard:{flexDirection:'row',gap:spacing.sm,alignItems:'center'},
  savedThumb:{width:74,height:74,borderRadius:radii.md},
  noticeText:{color:palette.textSecondary,fontSize:14,lineHeight:22},
  context:{gap:spacing.xs},
  contextLabel:{color:palette.textSecondary,fontSize:12,fontWeight:'700'},
  contextTitle:{color:palette.burgundy,fontSize:16,fontWeight:'800'},
  contextSub:{color:palette.textSecondary,fontSize:13,marginBottom:spacing.xs},
  categories:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},
  category:{minHeight:controls.minTouch,flexGrow:1,flexBasis:'45%',borderRadius:radii.md,
    borderWidth:1,borderColor:palette.border,backgroundColor:palette.white,padding:spacing.sm,
    alignItems:'center',justifyContent:'center'},
  active:{backgroundColor:palette.burgundy,borderColor:palette.burgundy},
  categoryText:{color:palette.burgundy,fontWeight:'700',fontSize:13,textAlign:'center'},
  categoryTextActive:{color:palette.white},
  actions:{flexDirection:'row',gap:spacing.sm},
  slot:{flex:1,minWidth:0},
  error:{color:palette.danger,fontSize:14,lineHeight:22},
  empty:{minHeight:160,alignItems:'center',justifyContent:'center',gap:spacing.xs},
  emptyTitle:{color:palette.burgundy,fontSize:typography.bodyLarge,fontWeight:'800'},
  emptyText:{color:palette.textSecondary,fontSize:typography.label,textAlign:'center'},
  previewCard:{gap:spacing.sm},
  preview:{width:'100%',height:265,backgroundColor:palette.subtle,borderRadius:radii.md},
  inputLabel:{color:palette.text,fontSize:14,fontWeight:'700'},
  noteInput:{minHeight:82,textAlignVertical:'top',borderWidth:1,borderColor:palette.border,
    borderRadius:radii.md,padding:spacing.sm,fontSize:15,color:palette.text,backgroundColor:palette.white},
  counter:{fontSize:12,color:palette.textSecondary,textAlign:'right'},
  thumbnails:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},
  thumbWrap:{borderRadius:radii.md,borderWidth:2,borderColor:palette.border,padding:3,alignItems:'center'},
  thumbActive:{borderColor:palette.orange},
  thumb:{width:64,height:64,borderRadius:radii.sm},
  thumbNumber:{color:palette.burgundy,fontSize:12,fontWeight:'700'},
});
