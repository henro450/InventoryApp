import React, { useEffect } from 'react';
import { View, StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import InventoryScreen from '../screens/InventoryScreen';
import AddItemScreen from '../screens/AddItemScreen';
import StockTransactionScreen from '../screens/StockTransactionScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ReportsScreen from '../screens/ReportsScreen';
import AuditLogScreen from '../screens/AuditLogScreen';
import ManageSubCompaniesScreen from '../screens/ManageSubCompaniesScreen';
import CompareSubCompaniesScreen from '../screens/CompareSubCompaniesScreen';
import ScanBarcodeScreen from '../screens/ScanBarcodeScreen';
import AlertsScreen from '../screens/AlertsScreen';
import SplashView from '../components/SplashView';
import TabBar from '../components/TabBar';
import { startConnectivityWatcher } from '../sync/syncEngine';
import { startScanToFind } from '../utils/scan';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.ground, primary: colors.primary } };

// The Scan tab never renders — the tab bar intercepts it and opens the scanner modal.
function ScanPlaceholder() {
  return <View />;
}

// ROLE-06: single app binary — the same navigator serves both roles. Main Company users get
// Overview as their home tab; Sub Company users land on Inventory and get Alerts as a tab.
function HomeTabs() {
  const { user, isMainCompany } = useAuth();
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} onScan={() => startScanToFind(props.navigation, user.companyId)} />}
    >
      {isMainCompany && <Tab.Screen name="Overview" component={DashboardScreen} />}
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      {!isMainCompany && <Tab.Screen name="Reports" component={ReportsScreen} />}
      <Tab.Screen name="Scan" component={ScanPlaceholder} />
      {isMainCompany && <Tab.Screen name="Reports" component={ReportsScreen} />}
      <Tab.Screen name="AuditLog" component={AuditLogScreen} />
      {!isMainCompany && <Tab.Screen name="Alerts" component={AlertsScreen} initialParams={{ asTab: true }} />}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading, isMainCompany } = useAuth();

  useEffect(() => {
    if (!user) return;
    const stop = startConnectivityWatcher(user.id);
    return stop;
  }, [user]);

  if (loading) return <SplashView />;

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar barStyle="dark-content" />
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeTabs} />
            <Stack.Screen name="AddItem" component={AddItemScreen} />
            <Stack.Screen name="StockTransaction" component={StockTransactionScreen} />
            <Stack.Screen
              name="ScanBarcode"
              component={ScanBarcodeScreen}
              options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.camera } }}
            />
            {isMainCompany && (
              <>
                <Stack.Screen name="Alerts" component={AlertsScreen} />
                <Stack.Screen name="ManageSubCompanies" component={ManageSubCompaniesScreen} />
                <Stack.Screen name="CompareSubCompanies" component={CompareSubCompaniesScreen} />
                {/* RPT-06: read-only drill-down into one Sub Company, reusing the same screens. */}
                <Stack.Screen name="CompanyInventory" component={InventoryScreen} options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="CompanyReports" component={ReportsScreen} options={{ animation: 'fade' }} />
                <Stack.Screen name="CompanyAuditLog" component={AuditLogScreen} options={{ animation: 'fade' }} />
              </>
            )}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
