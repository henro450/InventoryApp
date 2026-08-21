import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
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
import { initLocalDb } from '../db/localDb';
import { startConnectivityWatcher } from '../sync/syncEngine';

const Stack = createNativeStackNavigator();

// ROLE-06: single app binary — the same navigator serves both roles. A Main Company user
// additionally gets the Dashboard screen; a Sub Company user goes straight to Inventory.
export default function RootNavigator() {
  const { user, loading, logout, isMainCompany } = useAuth();

  useEffect(() => {
    initLocalDb();
  }, []);

  useEffect(() => {
    if (!user) return;
    const stop = startConnectivityWatcher(user.id);
    return stop;
  }, [user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerRight: () =>
            user ? (
              <TouchableOpacity onPress={logout}>
                <Text style={{ color: '#2f6fed' }}>Log Out</Text>
              </TouchableOpacity>
            ) : null,
        }}
      >
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : isMainCompany ? (
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Overview' }} />
            <Stack.Screen name="Inventory" component={InventoryScreen} />
            <Stack.Screen
              name="AddItem"
              component={AddItemScreen}
              options={({ route }) => ({ title: route.params?.item ? 'Edit Item' : 'Add Item' })}
            />
            <Stack.Screen
              name="StockTransaction"
              component={StockTransactionScreen}
              options={{ title: 'Record Transaction' }}
            />
            <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
            <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Audit Log' }} />
            <Stack.Screen
              name="ManageSubCompanies"
              component={ManageSubCompaniesScreen}
              options={{ title: 'Sub Companies' }}
            />
            <Stack.Screen
              name="CompareSubCompanies"
              component={CompareSubCompaniesScreen}
              options={{ title: 'Compare Companies' }}
            />
            <Stack.Screen name="ScanBarcode" component={ScanBarcodeScreen} options={{ title: 'Scan' }} />
            <Stack.Screen name="Alerts" component={AlertsScreen} options={{ title: 'Alerts' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Inventory" component={InventoryScreen} options={{ title: 'Inventory' }} />
            <Stack.Screen
              name="AddItem"
              component={AddItemScreen}
              options={({ route }) => ({ title: route.params?.item ? 'Edit Item' : 'Add Item' })}
            />
            <Stack.Screen
              name="StockTransaction"
              component={StockTransactionScreen}
              options={{ title: 'Record Transaction' }}
            />
            <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
            <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Audit Log' }} />
            <Stack.Screen name="ScanBarcode" component={ScanBarcodeScreen} options={{ title: 'Scan' }} />
            <Stack.Screen name="Alerts" component={AlertsScreen} options={{ title: 'Alerts' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
