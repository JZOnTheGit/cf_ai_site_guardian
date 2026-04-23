// unit tests for the security helpers
// focus: ssrf guard, agent id validation, and the mini rate limiter
import { describe, expect, it } from "vitest";
import {
  HttpError,
  assertOptionalNumber,
  assertString,
  isSameOrigin,
  isValidAgentId,
  rateLimit,
  ssrfReason,
} from "../worker/security";

describe("ssrfReason", () => {
  it("allows public https sites", () => {
    expect(ssrfReason("https://example.com")).toBeNull();
    expect(ssrfReason("https://www.cloudflare.com/blog")).toBeNull();
  });

  it("blocks private rfc1918 hosts", () => {
    expect(ssrfReason("http://10.0.0.1")).not.toBeNull();
    expect(ssrfReason("http://192.168.1.1")).not.toBeNull();
    expect(ssrfReason("http://172.16.0.1")).not.toBeNull();
  });

  it("blocks loopback and link-local", () => {
    expect(ssrfReason("http://localhost")).not.toBeNull();
    expect(ssrfReason("http://127.0.0.1")).not.toBeNull();
    expect(ssrfReason("http://169.254.169.254")).not.toBeNull();
  });

  it("rejects non-http protocols", () => {
    expect(ssrfReason("file:///etc/passwd")).not.toBeNull();
    expect(ssrfReason("javascript:alert(1)")).not.toBeNull();
  });
});

describe("isValidAgentId", () => {
  it("accepts 64-char hex ids", () => {
    const id = "a".repeat(64);
    expect(isValidAgentId(id)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isValidAgentId("not-hex")).toBe(false);
    expect(isValidAgentId("a".repeat(63))).toBe(false);
    expect(isValidAgentId(null as any)).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("allows GET without origin header", () => {
    const req = new Request("https://example.com/api/foo", { method: "GET" });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("blocks cross-origin POST", () => {
    const req = new Request("https://example.com/api/foo", {
      method: "POST",
      headers: { origin: "https://evil.com", host: "example.com" },
    });
    expect(isSameOrigin(req)).toBe(false);
  });
});

describe("assertString + assertOptionalNumber", () => {
  it("accepts valid strings", () => {
    expect(assertString("hello", "x")).toBe("hello");
  });

  it("throws on empty strings", () => {
    expect(() => assertString("", "x")).toThrow(HttpError);
  });

  it("accepts numbers in range and rejects otherwise", () => {
    expect(assertOptionalNumber(5, "x", 0, 10)).toBe(5);
    expect(assertOptionalNumber(null, "x", 0, 10)).toBeNull();
    expect(() => assertOptionalNumber(100, "x", 0, 10)).toThrow(HttpError);
  });
});

describe("rateLimit", () => {
  it("throws after exceeding the limit", () => {
    const req = new Request("https://example.com/x", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    // use a unique route name so this test is isolated
    expect(() => rateLimit(req, "unit-test-route", 3)).not.toThrow();
    expect(() => rateLimit(req, "unit-test-route", 3)).not.toThrow();
    expect(() => rateLimit(req, "unit-test-route", 3)).not.toThrow();
    expect(() => rateLimit(req, "unit-test-route", 3)).toThrow(HttpError);
  });
});
