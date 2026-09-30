import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import OnboardingScreen from "./src/screens/OnboardingScreen";
import RiskScreen from "./src/screens/RiskScreen";
import { dailyStatus } from "@dmcripto/core";
import type { DailyLimits, Trade } from "@dmcripto/core";
import { fetchLimits, saveLimits } from "./src/tradesApi";
import { AppBackground, LiveDot, Logo, TabIcon } from "./src/ui";
import { colors } from "./src/theme";

const ONBOARDING_KEY = "veltrix_onboarding_v1";

type Tab = "signals" | "journal" | "add" | "risk" | "settings";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "signals", label: "Señales" },
  { key: "journal", label: "Diario" },
  { key: "add", label: "Registrar" },
  { key: "risk", label: "Riesgo" },
  { key: "settings", label: "Ajustes" },
];

function Dashboard({ userId, email }: { userId: string; email?: string }) {
  const [tab, setTab] = useState<Tab>("signals");
  const { trades, loading, refreshing, refresh } = useTrades(userId);
  const open = trades.filter((t) => t.outcome === "ABIERTA").length;
  const [limits, setLimits] = useState<DailyLimits>({ maxLossR: null, maxTrades: null });
  const limitStatus = dailyStatus(trades, limits);

  useEffect(() => {
    fetchLimits(userId).then(setLimits).catch(() => {});
  }, [userId]);

  const persistLimits = async (l: DailyLimits) => {
    await saveLimits(userId, l);
    setLimits(l);
  };

  const [calcTrade, setCalcTrade] = useState<Trade | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((v) => setOnboarding(v !== "done"))
      .catch(() => setOnboarding(false));
  }, []);

  const finishOnboarding = () => {
    setOnboarding(false);
    AsyncStorage.setItem(ONBOARDING_KEY, "done").catch(() => {});
  };

  useEffect(() => {
    if (onboarding !== false) return;
    registerForPushNotifications(userId).catch((err) => console.warn("Push registration failed:", err));
  }, [userId, onboarding]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab("signals");
      refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (onboarding === null) return <View style={{ flex: 1 }} />;
  if (onboarding) return <OnboardingScreen userId={userId} onDone={finishOnboarding} />;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Logo size={30} />
        <Text style={styles.brand}>
          VELTRIX
        </Text>
        <View style={styles.live}>
          <LiveDot />
          <Text style={styles.liveText}>EN VIVO{open > 0 ? ` · ${open}` : ""}</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "signals" && <SignalsScreen
            trades={trades}
            loading={loading}
            refreshing={refreshing}
            refresh={refresh}
            limitStatus={limitStatus}
            onCalculate={(t) => {
              setCalcTrade(t);
              setTab("risk");
            }}
          />}
        {tab === "journal" && <JournalScreen trades={trades} loading={loading} refreshing={refreshing} refresh={refresh} />}
        {tab === "add" && <AddScreen userId={userId} limitStatus={limitStatus} onAdded={() => { refresh(); setTab("signals"); }} />}
        {tab === "risk" && <RiskScreen prefill={calcTrade} onPrefillUsed={() => setCalcTrade(null)} />}
        {tab === "settings" && <SettingsScreen userId={userId} email={email} trades={trades} limits={limits} limitStatus={limitStatus} onSaveLimits={persistLimits} />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((tb) => {
          const on = tab === tb.key;
          return (
            <TouchableOpacity key={tb.key} style={styles.tabBtn} onPress={() => setTab(tb.key)}>
              {on && <View style={styles.tabIndicator} />}
              <View>
                <TabIcon name={tb.key} color={on ? colors.gold : colors.dim} />
                {tb.key === "signals" && open > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{open}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, on && styles.tabLabelActive]}>{tb.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  const { session, isRecovery, clearRecovery } = useSession();
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  return (
    <View style={styles.screen}>
      <AppBackground />
      <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor="#070b11" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#070b11" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 10 : 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: "rgba(10,14,20,0.6)",
  },
  brand: { color: colors.snow, fontSize: 20, fontWeight: "900", letterSpacing: 1.2, flex: 1 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(22,217,138,0.4)",
    backgroundColor: "rgba(22,217,138,0.1)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveText: { color: colors.bull, fontSize: 10.5, fontWeight: "800", letterSpacing: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: "rgba(10,14,20,0.94)",
  },
  tabBtn: { flex: 1, alignItems: "center", paddingTop: 10, paddingBottom: 10, gap: 4 },
  tabIndicator: { position: "absolute", top: 0, width: 34, height: 3, borderRadius: 2, backgroundColor: colors.gold },
  tabLabel: { color: colors.dim, fontWeight: "700", fontSize: 10.5, letterSpacing: 0.5 },
  tabLabelActive: { color: colors.gold },
  badge: {
    position: "absolute",
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.bull,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.ink, fontSize: 9.5, fontWeight: "900" },
});
