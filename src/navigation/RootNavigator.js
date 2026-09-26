import React, { useEffect } from 'react';
import { View, StatusBar, AppState } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as Linking from 'expo-linking';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import SetPasswordScreen from '../screens/SetPasswordScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import AdminCompaniesScreen from '../screens/AdminCompaniesScreen';
import AdminCompanyDetailScreen from '../screens/AdminCompanyDetailScreen';
import AdminSettingsScreen from '../screens/AdminSettingsScreen';
import AdminPaymentsScreen from '../screens/AdminPaymentsScreen';
import AdminPaymentDetailScreen from '../screens/AdminPaymentDetailScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import { refreshSubscriptionReminders } from '../subscription/reminders';
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
import DebtorsScreen from '../screens/DebtorsScreen';
import DebtorDetailScreen from '../screens/DebtorDetailScreen';
import CompanyUsersScreen from '../screens/CompanyUsersScreen';
import SplashView from '../components/SplashView';
import TabBar from '../components/TabBar';
import { startConnectivityWatcher } from '../sync/syncEngine';
import { startScanToFind } from '../utils/scan';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Invite and password-reset emails open beams://set-password?token=… (via the API's /invite
// page), which lands on the SetPassword screen with the token as a route param.
const linking = {
  prefixes: [Linking.createURL('/'), 'beams://'],
  config: { screens: { SetPassword: 'set-password' } },
};

const navigationRef = createNavigationContainerRef();

function openSubscription() {
  if (navigationRef.isReady()) navigationRef.navigate('Subscription');
}

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.ground, primary: colors.primary } };

// The Scan tab never renders — the tab bar intercepts it and opens the scanner modal.
function ScanPlaceholder() {
  return <View />;
}

// ROLE-06: single app binary — the same navigator serves both roles. Main Company users get
// Overview as their home tab; Sub Company users land on Inventory and get Alerts as a tab.
function HomeTabs() {
  const { user, isMainCompany, isCompanyAdmin } = useAuth();
  const tabBar = (props) => <TabBar {...props} onScan={() => startScanToFind(props.navigation, user.companyId)} />;

  // Regular (non-admin) users: sales and stock, plus who owes money.
  if (!isCompanyAdmin) {
    return (
      <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={tabBar}>
        <Tab.Screen name="Inventory" component={InventoryScreen} />
        <Tab.Screen name="Scan" component={ScanPlaceholder} />
        <Tab.Screen name="Debtors" component={DebtorsScreen} initialParams={{ asTab: true }} />
      </Tab.Navigator>
    );
  }

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={tabBar}>
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
  const { user, loading, isMainCompany, isSuperAdmin, isCompanyAdmin, allowSubCompanies, refreshUser } = useAuth();

  useEffect(() => {
    if (!user || isSuperAdmin) return;
    const stop = startConnectivityWatcher(user.id);
    return stop;
  }, [user, isSuperAdmin]);

  // Subscription expiry reminders (company admins): refresh on login and whenever the app comes
  // back to the foreground; tapping a reminder notification opens the Subscription screen.
  useEffect(() => {
    if (!user) return undefined;
    const refresh = () => refreshSubscriptionReminders(user, { isCompanyAdmin, isSuperAdmin, onOpen: openSubscription });
    refresh();
    // Coming back to the app also re-reads the session, so a renewal (or expiry) shows up for
    // every user without logging out.
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refresh();
      refreshUser();
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.screen === 'Subscription' && isCompanyAdmin && !isSuperAdmin) openSubscription();
    });
    return () => {
      appState.remove();
      tapped.remove();
    };
  }, [user, isCompanyAdmin, isSuperAdmin]);

  if (loading) return <SplashView />;

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <StatusBar barStyle="dark-content" />
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        {!user ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        ) : isSuperAdmin ? (
          <>
            <Stack.Screen name="AdminCompanies" component={AdminCompaniesScreen} />
            <Stack.Screen name="AdminCompanyDetail" component={AdminCompanyDetailScreen} />
            <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} />
            <Stack.Screen name="AdminPayments" component={AdminPaymentsScreen} />
            <Stack.Screen name="AdminPaymentDetail" component={AdminPaymentDetailScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeTabs} />
            {isCompanyAdmin && <Stack.Screen name="AddItem" component={AddItemScreen} />}
            {isCompanyAdmin && <Stack.Screen name="CompanyUsers" component={CompanyUsersScreen} />}
            {isCompanyAdmin && <Stack.Screen name="Subscription" component={SubscriptionScreen} />}
            <Stack.Screen name="StockTransaction" component={StockTransactionScreen} />
            {/* People owing from part-paid/credit sales (own company; Main Company can open a Sub's read-only). */}
            <Stack.Screen name="Debtors" component={DebtorsScreen} />
            <Stack.Screen name="DebtorDetail" component={DebtorDetailScreen} />
            <Stack.Screen
              name="ScanBarcode"
              component={ScanBarcodeScreen}
              options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.camera } }}
            />
            {isMainCompany && isCompanyAdmin && (
              <>
                <Stack.Screen name="Alerts" component={AlertsScreen} />
                {allowSubCompanies && (
                  <>
                    <Stack.Screen name="ManageSubCompanies" component={ManageSubCompaniesScreen} />
                    <Stack.Screen name="CompareSubCompanies" component={CompareSubCompaniesScreen} />
                  </>
                )}
                {/* RPT-06: read-only drill-down into one Sub Company, reusing the same screens. */}
                <Stack.Screen name="CompanyInventory" component={InventoryScreen} options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="CompanyReports" component={ReportsScreen} options={{ animation: 'fade' }} />
                <Stack.Screen name="CompanyAuditLog" component={AuditLogScreen} options={{ animation: 'fade' }} />
              </>
            )}
          </>
        )}
        {/* Registered in every state so an invite link always lands somewhere; the screen asks a
            signed-in user to log out first. */}
        <Stack.Screen name="SetPassword" component={SetPasswordScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
