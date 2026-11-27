import { Stack } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { StatusBar } from 'expo-status-bar';
import { catalogColors } from '../navigation/catalog.styles';
import { IngredientStateProvider } from '../ingredients/IngredientState';
import { ProductStateProvider } from '../products/ProductState';
import { RecipeStateProvider } from '../recipes/RecipeState';

/** Root Stack is mounted unconditionally; each protected route uses an AuthGate before rendering data. */
export default function WaveHouseLayout() {
  const { generation } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  return <IngredientStateProvider key={generation}>
      <ProductStateProvider>
        <RecipeStateProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{
            headerStyle: { backgroundColor: catalogColors.surface },
            headerTintColor: catalogColors.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: catalogColors.background },
          }}>
            <Stack.Screen name="index" options={{title:'WaveHouse'}} />
            <Stack.Screen name="field/sales" options={{title:'Bán hàng'}} />
            <Stack.Screen name="field/sales-edit" options={{title:'Nhập doanh thu'}} />
            <Stack.Screen name="field/sales/[id]" options={{title:'Chi tiết báo cáo'}} />
            <Stack.Screen name="field/schedule" options={{title:'Lịch làm việc'}} />
            <Stack.Screen name="field/roster" options={{title:'Phân ca'}} />
            <Stack.Screen name="field/deliveries" options={{title:'Giao hàng'}} />
            <Stack.Screen name="field/trip/[id]" options={{title:'Chuyến giao'}} />
            <Stack.Screen name="field/receiving" options={{title:'Nhận hàng'}} />
            <Stack.Screen name="field/receive" options={{title:'Kiểm hàng'}} />
            <Stack.Screen name="field/inventory" options={{title:'Tồn kho'}} />
            <Stack.Screen name="field/count-edit" options={{title:'Sửa phiếu kiểm kê'}} />
            <Stack.Screen name="field/count-new" options={{title:'Kiểm kê'}} />
            <Stack.Screen name="field/count/[id]" options={{title:'Phiếu kiểm kê'}} />
            <Stack.Screen name="field/manager" options={{title:'Quản lý khu'}} />
            <Stack.Screen name="field/plan/[id]" options={{title:'Kế hoạch bổ sung'}} />
            <Stack.Screen name="ingredients/index" options={{ title:'Nguyên liệu' }} />
            <Stack.Screen name="ingredients/[id]" options={{ title:'Chi tiết nguyên liệu' }} />
            <Stack.Screen name="products/index" options={{ title:'Sản phẩm' }} />
            <Stack.Screen name="products/[id]" options={{ title:'Chi tiết sản phẩm' }} />
            <Stack.Screen name="recipes/index" options={{ title:'Công thức' }} />
            <Stack.Screen name="recipes/[id]" options={{ title:'Chi tiết công thức' }} />
            <Stack.Screen name="+not-found" options={{ title:'Không tìm thấy' }} />
          </Stack>
        </RecipeStateProvider>
      </ProductStateProvider>
    </IngredientStateProvider>;
}
