import { useSyncExternalStore } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BrandButton } from '../design/doclap/BrandButton';
import { BrandCard } from '../design/doclap/BrandCard';
import { palette, radii, spacing } from '../design/doclap/theme';
import {
  evidenceFor, getEvidenceSnapshot, MAX_PER_TARGET, parseEvidenceTarget, subscribeEvidence,
  type EvidenceKind, type EvidenceTargetType,
} from './evidence.store';

export function EvidenceContextCard({type, id, kind, label}: {
  type: Exclude<EvidenceTargetType,'general'>;
  id:string;
  kind:EvidenceKind;
  label:string;
}) {
  const snapshot = useSyncExternalStore(subscribeEvidence, getEvidenceSnapshot, getEvidenceSnapshot);
  const target = parseEvidenceTarget(type,id);
  if (target.type === 'general') return null;
  const drafts = evidenceFor(target,snapshot);
  return <BrandCard style={styles.card}>
    <Text style={styles.heading}>Ảnh minh chứng · {label}</Text>
    <Text style={styles.count}>{drafts.length}/{MAX_PER_TARGET} ảnh nháp trên thiết bị</Text>
    {drafts.length ? <View style={styles.thumbs}>
      {drafts.map(item => <Image key={item.id} source={{uri:item.uri}} style={styles.thumb} resizeMode="cover" />)}
    </View>:null}
    <Text style={styles.notice}>
      Ảnh và ghi chú chỉ gắn với mã phiếu trong phiên đăng nhập hiện tại. Chưa gửi hoặc lưu trên máy chủ.
      Các thao tác xác nhận nghiệp vụ bên dưới không tự tải ảnh lên.
    </Text>
    <BrandButton title={drafts.length ? 'Xem / thêm ảnh minh chứng' : 'Chụp minh chứng cho phiếu'}
      variant="outline" fullWidth
      onPress={() => router.push({pathname:'/camera',params:{targetType:type,targetId:id,kind}})} />
  </BrandCard>;
}
const styles = StyleSheet.create({
  card:{gap:spacing.sm},
  heading:{color:palette.burgundy,fontWeight:'800',fontSize:17},
  count:{color:palette.textSecondary,fontSize:13},
  thumbs:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},
  thumb:{width:58,height:58,borderRadius:radii.sm,backgroundColor:palette.subtle},
  notice:{color:palette.textSecondary,fontSize:13,lineHeight:20},
});
