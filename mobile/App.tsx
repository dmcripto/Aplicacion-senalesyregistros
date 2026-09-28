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
import { useSession } from "./src/hooks";
import { registerForPushNotifications } from "./src/push";
import LoginScreen from "./src/screens/LoginScreen";
import ResetPasswordScreen from "./src/screens/ResetPasswordScreen";
import JournalScreen from "./src/screens/JournalScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import { colors } from "./src/theme";

function Dashboard({ userId, email }: { userId: string; email?: string }) {
  const [tab, setTab] = useState<"journal" | "settings">("journal");

  useEffect(() => {
    registerForPushNotifications(userId).catch((err) => console.warn("Push registration failed:", err));
  }, [userId]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>
          DMCRIPTO<Text style={{ color: colors.gold }}>.</Text>
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "journal" ? <JournalScreen userId={userId} /> : <SettingsScreen userId={userId} email={email} />}
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabBtn} onPress={() => setTab("journal")}>
          <Text style={[styles.tabLabel, tab === "journal" && styles.tabLabelActive]}>Diario</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBtn} onPress={() => setTab("settings")}>
          <Text style={[styles.tabLabel, tab === "settings" && styles.tabLabelActive]}>Ajustes</Text>
        </TouchableOpacity>
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
