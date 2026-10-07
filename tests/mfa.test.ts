import { describe, expect, it } from "vitest";
import { MFA_FRESH_SEC, safeSvgUri, cleanMfaCode, createMfa, isMfaCode, isMfaRequired, mfaFreshFromToken } from "../packages/core/src/mfa";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const NOW = 1_800_000_000;

describe("2FA opcional: marcas de la sesión", () => {
  it("un código reciente cuenta; uno viejo, sin código o un token roto no", () => {
    expect(mfaFreshFromToken(jwt({ amr: [{ method: "totp", timestamp: NOW - 60 }] }), NOW)).toBe(true);
    expect(mfaFreshFromToken(jwt({ amr: [{ method: "password", timestamp: NOW - 5 }, { method: "totp", timestamp: NOW - MFA_FRESH_SEC + 5 }] }), NOW)).toBe(true);
    expect(mfaFreshFromToken(jwt({ amr: [{ method: "totp", timestamp: NOW - MFA_FRESH_SEC - 5 }] }), NOW)).toBe(false);
    expect(mfaFreshFromToken(jwt({ amr: [{ method: "password", timestamp: NOW }] }), NOW)).toBe(false);
    expect(mfaFreshFromToken(jwt({}), NOW)).toBe(false);
    expect(mfaFreshFromToken("basura", NOW)).toBe(false);
    expect(mfaFreshFromToken(null, NOW)).toBe(false);
  });

  it("el cliente vence antes que el servidor (10 min)", () => {
    expect(MFA_FRESH_SEC).toBeLessThan(600);
  });

  it("codifica el QR sin tocar otras imágenes", () => {
    expect(safeSvgUri("data:image/svg+xml;utf8,<svg a=\"#f\"/>")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23f%22%2F%3E");
    expect(safeSvgUri("data:image/svg+xml;utf-8,<svg/>")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    expect(safeSvgUri("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });

  it("limpia y valida el código", () => {
    expect(cleanMfaCode("123 456")).toBe("123456");
    expect(cleanMfaCode("12-34-56-78")).toBe("123456");
    expect(isMfaCode("123456")).toBe(true);
    expect(isMfaCode("12345")).toBe(false);
    expect(isMfaCode("12345a")).toBe(false);
  });

  it("reconoce el error de «falta el código» venga como Error, objeto o texto", () => {
    expect(isMfaRequired(new Error("mfa_required"))).toBe(true);
    expect(isMfaRequired({ message: "P0001: mfa_required" })).toBe(true);
    expect(isMfaRequired("mfa_required")).toBe(true);
    expect(isMfaRequired(new Error("otra cosa"))).toBe(false);
    expect(isMfaRequired(null)).toBe(false);
  });
});

function fakeAuth(factors: Array<{ id: string; status: string }>, token: string | null = null) {
  const calls: string[] = [];
  return {
    calls,
    getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
    mfa: {
      listFactors: async () => ({ data: { all: factors, totp: factors.filter((f) => f.status === "verified") }, error: null }),
      challenge: async ({ factorId }: { factorId: string }) => (calls.push(`challenge:${factorId}`), { data: { id: "ch1" }, error: null }),
      verify: async ({ code }: { code: string }) => (calls.push(`verify:${code}`), code === "123456" ? { data: {}, error: null } : { data: null, error: { message: "Invalid TOTP code entered" } }),
      enroll: async () => (calls.push("enroll"), { data: { id: "new", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABCD", uri: "otpauth://totp/x" } }, error: null }),
      unenroll: async ({ factorId }: { factorId: string }) => (calls.push(`unenroll:${factorId}`), { data: {}, error: null }),
    },
  };
}

describe("2FA opcional: flujo con el cliente de auth", () => {
  it("el estado solo cuenta factores verificados", async () => {
    expect(await createMfa(fakeAuth([]) as any).status()).toEqual({ enabled: false, factorId: null });
    expect(await createMfa(fakeAuth([{ id: "a", status: "unverified" }]) as any).status()).toEqual({ enabled: false, factorId: null });
    expect(await createMfa(fakeAuth([{ id: "b", status: "verified" }]) as any).status()).toEqual({ enabled: true, factorId: "b" });
  });

  it("activar: borra intentos a medias, crea el factor y devuelve QR y clave", async () => {
    const a = fakeAuth([{ id: "viejo", status: "unverified" }, { id: "ok", status: "verified" }]);
    const e = await createMfa(a as any).startEnroll();
    expect(a.calls).toEqual(["unenroll:viejo", "enroll"]);
    expect(e).toMatchObject({ factorId: "new", secret: "ABCD", uri: "otpauth://totp/x" });
    expect(e.qr).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
  });

  it("verificar: manda el desafío y el código limpio; un código malo da un mensaje claro", async () => {
    const a = fakeAuth([{ id: "f", status: "verified" }]);
    await createMfa(a as any).verify("f", "123 456");
    expect(a.calls).toEqual(["challenge:f", "verify:123456"]);
    await expect(createMfa(a as any).verify("f", "000000")).rejects.toThrow(/incorrecto o vencido/i);
  });

  it("isFresh lee la sesión", async () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(await createMfa(fakeAuth([], jwt({ amr: [{ method: "totp", timestamp: ts - 5 }] })) as any).isFresh()).toBe(true);
    expect(await createMfa(fakeAuth([], jwt({ amr: [{ method: "password", timestamp: ts }] })) as any).isFresh()).toBe(false);
    expect(await createMfa(fakeAuth([]) as any).isFresh()).toBe(false);
  });

  it("desactivar quita el factor", async () => {
    const a = fakeAuth([{ id: "f", status: "verified" }]);
    await createMfa(a as any).disable("f");
    expect(a.calls).toEqual(["unenroll:f"]);
  });
});
