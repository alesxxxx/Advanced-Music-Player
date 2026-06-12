import { net } from "electron";
import type { StealthRequestInit, StealthResponse } from "./types";

interface CookieJarEntry {
  value: string;
  domain: string;
  path: string;
  expires?: number;
}

export class StealthClient {
  private cookieJar = new Map<string, CookieJarEntry[]>();
  private defaultHeaders: Record<string, string>;
  private disableCookies: boolean;

  constructor(userAgent?: string, options?: { disableCookies?: boolean }) {
    this.disableCookies = options?.disableCookies ?? false;
    this.defaultHeaders = {
      "User-Agent":
        userAgent ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    };
  }

  async request(url: string, init: StealthRequestInit = {}): Promise<StealthResponse> {
    return new Promise((resolve, reject) => {
      const method = init.method ?? "GET";
      const clientRequest = net.request({
        method,
        url,
        redirect: "follow"
      });

      // Apply default + custom headers
      const headers = { ...this.defaultHeaders, ...init.headers };
      for (const [key, value] of Object.entries(headers)) {
        if (value) {
          clientRequest.setHeader(key, value);
        }
      }

      // Apply cookies for this domain. SoundCloud's anonymous api-v2 + media endpoints work
      // without cookies, and accumulating them across a session can poison the media endpoint
      // (causing 404s on stream resolution), so cookie handling is opt-out per client.
      if (!this.disableCookies) {
        const domainCookies = this.getCookiesForUrl(url);
        if (domainCookies) {
          clientRequest.setHeader("Cookie", domainCookies);
        }
      }

      const timeout = setTimeout(() => {
        clientRequest.abort();
        reject(new Error(`Request timeout: ${url}`));
      }, init.timeoutMs ?? 30000);

      let body = "";

      clientRequest.on("response", (response) => {
        clearTimeout(timeout);

        // Collect response headers
        const responseHeaders: Record<string, string> = {};
        for (const [key, values] of Object.entries(response.headers)) {
          if (Array.isArray(values)) {
            responseHeaders[key.toLowerCase()] = values.join(", ");
          } else if (typeof values === "string") {
            responseHeaders[key.toLowerCase()] = values;
          }
        }

        // Store Set-Cookie headers
        const setCookie = responseHeaders["set-cookie"];
        if (setCookie && !this.disableCookies) {
          this.storeCookies(url, setCookie);
        }

        response.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
            body
          });
        });

        response.on("error", (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      clientRequest.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      if (init.body) {
        clientRequest.write(init.body);
      }

      clientRequest.end();
    });
  }

  setDefaultHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  clearCookies(): void {
    this.cookieJar.clear();
  }

  private getCookiesForUrl(url: string): string | undefined {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const path = parsed.pathname;

    const entries: string[] = [];
    for (const [cookieDomain, cookies] of this.cookieJar) {
      if (domain.endsWith(cookieDomain) || cookieDomain.endsWith(domain)) {
        for (const cookie of cookies) {
          if (path.startsWith(cookie.path)) {
            if (!cookie.expires || cookie.expires > Date.now()) {
              entries.push(`${cookie.value}`);
            }
          }
        }
      }
    }

    return entries.length > 0 ? entries.join("; ") : undefined;
  }

  private storeCookies(url: string, setCookieHeader: string): void {
    const parsed = new URL(url);
    const domain = parsed.hostname;

    const cookies = setCookieHeader.split(",").map((c) => c.trim());
    const existing = this.cookieJar.get(domain) ?? [];

    for (const cookie of cookies) {
      const [nameValue] = cookie.split(";");
      const trimmed = nameValue.trim();
      if (trimmed) {
        existing.push({
          value: trimmed,
          domain,
          path: "/"
        });
      }
    }

    this.cookieJar.set(domain, existing);
  }
}
