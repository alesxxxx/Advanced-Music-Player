import { existsSync, readFileSync } from "node:fs";
import { app } from "electron";
import path from "node:path";
import {
  LicenseType,
  SERVICE_CERTIFICATE_CHALLENGE,
  Session
} from "@spdl/widevine";

export interface NodeLicenseRequest {
  /** PSSH box as base64 */
  psshBase64: string;
  licenseUrl: string;
  licenseAuthToken?: string;
  /** Absolute path to the device private key binary file */
  privateKeyPath: string;
  /** Absolute path to the device client_id blob binary file */
  identifierBlobPath: string;
}

export interface NodeLicenseKey {
  key: string;
  type: string;
  kid?: string;
}

export interface NodeLicenseResult {
  ok: boolean;
  status: number;
  keyCount: number;
  keys?: NodeLicenseKey[];
  error?: string;
  serviceCertOk: boolean;
}

function defaultDeviceDir(): string {
  return path.join(app.getPath("userData"), "widevine");
}

/**
 * Prototype: use a custom Widevine device (extracted from a .wvd or individual
 * private_key + client_id_blob files) to request a license from SoundCloud's
 * KeyOS server. This lets us test whether KeyOS accepts the device identity,
 * independent of the castLabs CDM built into Electron.
 */
export async function acquireLicenseWithNodeSession(
  request: NodeLicenseRequest
): Promise<NodeLicenseResult> {
  try {
    if (!existsSync(request.privateKeyPath)) {
      return {
        ok: false,
        status: -1,
        keyCount: 0,
        serviceCertOk: false,
        error: `Private key not found: ${request.privateKeyPath}`
      };
    }
    if (!existsSync(request.identifierBlobPath)) {
      return {
        ok: false,
        status: -1,
        keyCount: 0,
        serviceCertOk: false,
        error: `Identifier blob not found: ${request.identifierBlobPath}`
      };
    }

    const privateKey = readFileSync(request.privateKeyPath);
    const identifierBlob = readFileSync(request.identifierBlobPath);
    const pssh = Buffer.from(request.psshBase64, "base64");

    const session = new Session({ privateKey, identifierBlob }, pssh);

    // 1) Service certificate handshake
    const certUrl = new URL(request.licenseUrl);
    certUrl.search = "";
    let serviceCertOk = false;
    try {
      const certResponse = await fetch(certUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(Buffer.from(SERVICE_CERTIFICATE_CHALLENGE))
      });
      if (certResponse.ok) {
        const certBytes = Buffer.from(await certResponse.arrayBuffer());
        await session.setServiceCertificateFromMessage(certBytes);
        serviceCertOk = true;
      }
    } catch {
      // Best-effort: some devices don't need a service cert
    }

    // 2) License request
    const licenseUrl = new URL(request.licenseUrl);
    if (request.licenseAuthToken) {
      licenseUrl.searchParams.set("license_token", request.licenseAuthToken);
    }

    const challenge = session.createLicenseRequest(LicenseType.STREAMING);
    const licenseResponse = await fetch(licenseUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(challenge)
    });

    if (!licenseResponse.ok) {
      return {
        ok: false,
        status: licenseResponse.status,
        keyCount: 0,
        serviceCertOk,
        error: `License server returned ${licenseResponse.status}`
      };
    }

    const licenseBytes = Buffer.from(await licenseResponse.arrayBuffer());
    const keys = session.parseLicense(licenseBytes);

    return {
      ok: true,
      status: licenseResponse.status,
      keyCount: keys.length,
      keys: keys.map((k: unknown) => {
        const key = k as { key: string; type: string; kid?: string };
        return { key: key.key, type: key.type, kid: key.kid };
      }),
      serviceCertOk
    };
  } catch (error) {
    return {
      ok: false,
      status: -1,
      keyCount: 0,
      serviceCertOk: false,
      error: (error as Error)?.message ?? String(error)
    };
  }
}

/**
 * Convenience: look for default device file paths in the AMP userData dir.
 */
export function getDefaultDevicePaths(): {
  privateKeyPath: string;
  identifierBlobPath: string;
} {
  const dir = defaultDeviceDir();
  return {
    privateKeyPath: path.join(dir, "device_private_key"),
    identifierBlobPath: path.join(dir, "device_client_id_blob")
  };
}
