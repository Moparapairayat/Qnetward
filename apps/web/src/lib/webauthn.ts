/*
 * Browser side of passkeys. The API sends WebAuthn options with binary fields
 * as base64url strings and expects the credential back the same way.
 */

function fromB64URL(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toB64URL(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Descriptor = { id: string; type: PublicKeyCredentialType; transports?: AuthenticatorTransport[] };

export type CreationOptionsJSON = {
  publicKey: Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
    challenge: string;
    user: { id: string; name: string; displayName: string };
    excludeCredentials?: Descriptor[];
  };
};

export type RequestOptionsJSON = {
  publicKey: Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & {
    challenge: string;
    allowCredentials?: Descriptor[];
  };
};

const toDescriptor = (d: Descriptor): PublicKeyCredentialDescriptor => ({ ...d, id: fromB64URL(d.id) });

/** True when this browser can create and use passkeys. */
export function passkeysSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;
}

/** Runs the browser's "create a passkey" prompt and returns the credential as JSON. */
export async function createPasskey(options: CreationOptionsJSON) {
  const pk = options.publicKey;
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...pk,
      challenge: fromB64URL(pk.challenge),
      user: { ...pk.user, id: fromB64URL(pk.user.id) },
      excludeCredentials: pk.excludeCredentials?.map(toDescriptor),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was created.");
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toB64URL(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64URL(response.clientDataJSON),
      attestationObject: toB64URL(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

/** Runs the browser's "use a passkey" prompt and returns the assertion as JSON. */
export async function getPasskey(options: RequestOptionsJSON) {
  const pk = options.publicKey;
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...pk,
      challenge: fromB64URL(pk.challenge),
      allowCredentials: pk.allowCredentials?.map(toDescriptor),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was chosen.");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toB64URL(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64URL(response.clientDataJSON),
      authenticatorData: toB64URL(response.authenticatorData),
      signature: toB64URL(response.signature),
      userHandle: toB64URL(response.userHandle),
    },
  };
}

/** Turns the browser's cancel and timeout errors into a plain sentence. */
export function passkeyErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "The passkey prompt was closed or timed out.";
    if (error.name === "InvalidStateError") return "This device already has a passkey for your account.";
    if (error.name === "SecurityError") return "Passkeys need the console on a secure domain.";
  }
  return error instanceof Error ? error.message : "Something went wrong with the passkey.";
}
