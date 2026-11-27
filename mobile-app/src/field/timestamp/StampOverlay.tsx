import { Image, StyleSheet, Text, View } from 'react-native';
import { coordinatesLabel, formatCaptureTime, locationLabel, type CaptureFacts, type StampStyle } from './stamp.model';

interface Props {
  facts: CaptureFacts;
  styleConfig: StampStyle;
  employee: string;
  context: string;
  note: string;
  logoUri: string | null;
  /** Set false while camera is live to avoid misrepresenting the live clock as capture time. */
  captured: boolean;
}

/** Visual stamp. Must be included inside the view captured to JPEG. */
export function StampOverlay({facts,styleConfig,employee,context,note,logoUri,captured}: Props) {
  const display = formatCaptureTime(facts.capturedAt);
  const fontScale = styleConfig.size === 'small' ? 0.83 : styleConfig.size === 'large' ? 1.14 : 1;
  const light = styleConfig.background === 'cream';
  const color = light ? '#5B070D' : '#FFFFFF';
  const minorColor = light ? '#5B070D' : '#F0DCBC';
  const backgroundColor = light ? 'rgba(240,220,188,0.95)'
    : styleConfig.background === 'burgundy' ? 'rgba(91,7,13,0.87)' : 'rgba(0,0,0,0.67)';
  return <View pointerEvents="none" style={[styles.frame,
    styleConfig.position === 'top' ? styles.frameTop : styles.frameBottom,
    {backgroundColor}]}>
    <View style={styles.top}>
      {styleConfig.logo ? <View style={styles.mark}>
        {logoUri ? <Image source={{uri:logoUri}} resizeMode="contain" style={styles.customLogo}/>
          : <Text allowFontScaling={false} style={[styles.logo,{color:minorColor}]}>ĐỘC LẬP<Text style={styles.logoSmall}>  CÀ PHÊ</Text></Text>}
      </View> : null}
      <Text allowFontScaling={false} style={[styles.tag,{color:minorColor}]}>{captured ? 'ẢNH MINH CHỨNG' : 'XEM TRƯỚC'}</Text>
    </View>
    <Text allowFontScaling={false} style={[styles.time,{fontSize:27*fontScale,color}]}>{display.time}</Text>
    <Text allowFontScaling={false} style={[styles.date,{fontSize:14*fontScale,color}]}>{display.date} · GMT+7</Text>
    <Text allowFontScaling={false} style={[styles.address,{fontSize:12*fontScale,color}]} numberOfLines={3}>{locationLabel(facts)}</Text>
    {styleConfig.coordinates && <Text allowFontScaling={false} style={[styles.minor,{color:minorColor}]}>
      {coordinatesLabel(facts)}{facts.accuracyMeters !== null ? ` · ±${Math.round(facts.accuracyMeters)} m` : ''}
    </Text>}
    <Text allowFontScaling={false} style={[styles.minor,{color:minorColor}]} numberOfLines={2}>{context}</Text>
    {styleConfig.employee && employee ? <Text allowFontScaling={false} style={[styles.minor,{color:minorColor}]} numberOfLines={1}>Nhân viên: {employee}</Text> : null}
    {styleConfig.note && note.trim() ? <Text allowFontScaling={false} style={[styles.minor,{color:minorColor}]} numberOfLines={2}>Ghi chú: {note.trim()}</Text> : null}
    <Text allowFontScaling={false} style={[styles.disclaimer,{color:light?'#5B070D':'#E7DCD0'}]}>Thời gian/GPS từ thiết bị · Chưa được máy chủ xác thực</Text>
  </View>;
}

const styles=StyleSheet.create({
  frame:{position:'absolute',left:0,right:0,paddingHorizontal:12,paddingTop:10,paddingBottom:12,gap:3},
  frameTop:{top:0},frameBottom:{bottom:0},
  top:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:7,marginBottom:1},
  mark:{minHeight:28,maxWidth:'70%',justifyContent:'center'},
  logo:{color:'#F0DCBC',fontWeight:'900',fontSize:15,letterSpacing:0.5},
  logoSmall:{fontSize:9,fontWeight:'700',letterSpacing:1.1},
  customLogo:{width:105,height:37},
  tag:{color:'#F0DCBC',fontSize:9,fontWeight:'800',letterSpacing:0.4},
  time:{color:'#FFFFFF',fontWeight:'900',letterSpacing:1,fontVariant:['tabular-nums']},
  date:{color:'#FFFFFF',fontWeight:'800'},
  address:{color:'#FFFFFF',fontWeight:'700',lineHeight:17},
  minor:{color:'#F0DCBC',fontSize:11,lineHeight:15,fontWeight:'600'},
  disclaimer:{color:'#E7DCD0',fontSize:9,marginTop:3,fontWeight:'500'},
});
