import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { useSession, useTrades } from "./src/hooks";
import { registerForPushNotifications } from "./src/push";
import LoginScreen from "./src/screens/LoginScreen";
import ResetPasswordScreen from "./src/screens/ResetPasswordScreen";
import JournalScreen from "./src/screens/JournalScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import SignalsScreen from "./src/screens/SignalsScreen";
import AddScreen from "./src/screens/AddScreen";
import { colors } from "./src/theme";

type Tab = "signals" | "journal" | "add" | "settings";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "signals", label: "Señales" },
  { key: "journal", label: "Diario" },
  { key: "add", label: "Registrar" },
  { key: "settings", label: "Ajustes" },
];

function Dashboard({ userId, email }: { userId: string; email?: string }) {
  const [tab, setTab] = useState<Tab>("signals");
  const { trades, loading, refreshing, refresh } = useTrades(userId);
  const open = trades.filter((t) => t.outcome === "ABIERTA").length;

  useEffect(() => {
    registerForPushNotifications(userId).catch((err) => console.warn("Push registration failed:", err));
  }, [userId]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab("signals");
      refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>
          DMCRIPTO<Text style={{ color: colors.gold }}>.</Text>
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "signals" && <SignalsScreen trades={trades} loading={loading} refreshing={refreshing} refresh={refresh} />}
        {tab === "journal" && <JournalScreen trades={trades} loading={loading} refreshing={refreshing} refresh={refresh} />}
        {tab === "add" && <AddScreen userId={userId} onAdded={() => { refresh(); setTab("signals"); }} />}
        {tab === "settings" && <SettingsScreen userId={userId} email={email} trades={trades} />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((tb) => (
          <TouchableOpacity key={tb.key} style={styles.tabBtn} onPress={() => setTab(tb.key)}>
            <Text style={[styles.tabLabel, tab === tb.key && styles.tabLabelActive]}>
              {tb.label}
              {tb.key === "signals" && open > 0 ? ` (${open})` : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  const { session, isRecovery, clearRecovery } = useSession();
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      {isRecovery ? (
        <ResetPasswordScreen
          onDone={(notice) => {
            clearRecovery();
            setAuthNotice(notice);
          }}
        />
      ) : session === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} />
        </View>
      ) : session ? (
        <Dashboard userId={session.user.id} email={session.user.email} />
      ) : (
        <LoginScreen initialNotice={authNotice} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 12 : 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brand: { color: colors.snow, fontSize: 20, fontWeight: "800", letterSpacing: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.panel,
  },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabLabel: { color: colors.dim, fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },
  tabLabelActive: { color: colors.gold },
});
