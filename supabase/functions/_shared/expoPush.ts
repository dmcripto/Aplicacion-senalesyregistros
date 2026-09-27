// Envío de notificaciones push a través del servicio Expo Push
// (https://exp.host/--/api/v2/push/send). Expo se encarga de reenviarlas a
// APNs (iOS) o FCM (Android) según el token.

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendExpoPush(messages: PushMessage[]): Promise<void> {
  if (!messages.length) return;
  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });
}
