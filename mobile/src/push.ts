// ─── DMCRIPTO · registro de push notifications (Expo Push) ────────────────
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabaseClient";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Pide permiso de notificaciones, obtiene el Expo push token del dispositivo
 * y lo guarda (upsert) en device_tokens para que el webhook de TradingView
 * pueda enviarle avisos a este usuario.
 */
export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!Device.isDevice) {
    // Los simuladores/emuladores no reciben push de verdad.
    return;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== Notifications.PermissionStatus.GRANTED) {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn("Falta extra.eas.projectId en app.json — corré `eas init` para poder registrar push.");
    return;
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    console.warn("No se pudo obtener el Expo push token:", err);
    return;
  }

  const { error } = await supabase
    .from("device_tokens")
    .upsert(
      { user_id: userId, expo_push_token: token, platform: Platform.OS },
      { onConflict: "expo_push_token" },
    );
  if (error) console.warn("No se pudo guardar el device token:", error.message);
}
