// ─── VELTRIX · registro de push notifications (Expo Push) ────────────────
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

export interface PushStatus {
  ok: boolean;
  message: string;
  token?: string;
}

/**
 * Pide permiso de notificaciones, obtiene el Expo push token del dispositivo
 * y lo guarda (upsert) en device_tokens para que el webhook de TradingView
 * pueda enviarle avisos a este usuario. Devuelve un diagnóstico legible.
 */
export async function setupPush(userId: string): Promise<PushStatus> {
  if (!Device.isDevice) {
    return { ok: false, message: "Las notificaciones no funcionan en emuladores: probá en un celular real." };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Señales",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== Notifications.PermissionStatus.GRANTED) {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== Notifications.PermissionStatus.GRANTED) {
    return {
      ok: false,
      message: "Las notificaciones están bloqueadas. Activalas en Ajustes del celular → Apps → VELTRIX → Notificaciones.",
    };
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return { ok: false, message: "Falta el identificador del proyecto Expo en la configuración de la app." };

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const firebase = /firebase|fcm|google-services|gcm/i.test(text);
    return {
      ok: false,
      message: firebase
        ? "Falta configurar Firebase (FCM) en esta versión de la app. Detalle: " + text
        : "No se pudo obtener el permiso de envío: " + text,
    };
  }

  const { error } = await supabase
    .from("device_tokens")
    .upsert(
      { user_id: userId, expo_push_token: token, platform: Platform.OS },
      { onConflict: "expo_push_token" },
    );
  if (error) return { ok: false, token, message: "No se pudo guardar este celular en tu cuenta: " + error.message };

  return { ok: true, token, message: "Notificaciones activas en este celular." };
}

export async function registerForPushNotifications(userId: string): Promise<void> {
  const r = await setupPush(userId);
  if (!r.ok) console.warn("Push:", r.message);
}

/** Envía una notificación de prueba a este mismo celular a través del servicio de Expo. */
export async function sendTestPush(token: string): Promise<string> {
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        to: token,
        title: "✅ VELTRIX funciona",
        body: "Así te vamos a avisar cuando llegue una señal.",
        sound: "default",
        channelId: "default",
      }),
    });
    const json = (await res.json()) as { data?: { status?: string; message?: string; details?: { error?: string } } };
    const d = json.data;
    if (d?.status === "ok") return "Enviada. Si en unos segundos no aparece, la configuración de Firebase en Expo está incompleta.";
    if (d?.details?.error === "InvalidCredentials") {
      return "Expo no tiene las credenciales de Firebase (FCM V1) de este proyecto. Hay que subirlas en expo.dev → Credentials.";
    }
    return "No se pudo enviar: " + (d?.message ?? "respuesta inesperada de Expo");
  } catch (err) {
    return "No se pudo conectar con Expo: " + (err instanceof Error ? err.message : String(err));
  }
}
