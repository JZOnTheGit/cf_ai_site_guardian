// unit tests for the pure scoring + url helpers in the analyzer
import { describe, expect, it } from "vitest";
import { heuristicScores, isValidUrl } from "../worker/analyzer";

describe("isValidUrl", () => {
  it("accepts a basic https url", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("adds https when missing", () => {
    expect(isValidUrl("example.com")).toBe(true);
  });

  it("rejects internal hosts", () => {
    expect(isValidUrl("http://localhost")).toBe(false);
    expect(isValidUrl("http://127.0.0.1")).toBe(false);
  });
});

describe("heuristicScores", () => {
  it("returns all-zero for unreachable sites", () => {
    const score = heuristicScores({
      url: "https://x",
      finalUrl: "https://x",
      status: 0,
      ok: false,
      ttfbMs: 0,
      totalMs: 0,
      htmlBytes: 0,
      contentType: null,
      server: null,
      security: { headers: [], missingCount: 0 },
      performance: {
        ttfbMs: 0,
        totalMs: 0,
        htmlBytes: 0,
        estimatedAssetCount: 0,
        compression: null,
      },
      seo: {
        title: null,
        titleLength: 0,
        metaDescription: null,
        metaDescriptionLength: 0,
        h1Count: 0,
        h2Count: 0,
        hasViewport: false,
        hasCanonical: false,
        hasOgTitle: false,
        hasOgDescription: false,
        lang: null,
      },
      accessibility: {
        score: 0,
        issues: [],
        imagesMissingAlt: 0,
        totalImages: 0,
        headingOrderOk: true,
      },
      tls: {
        protocol: null,
        cipher: null,
        httpVersion: null,
        country: null,
        colo: null,
      },
      links: { sampled: 0, broken: [] },
    });
    expect(score).toEqual({ performance: 0, security: 0, seo: 0 });
  });

  it("rewards fast TTFB and full seo fields", () => {
    const score = heuristicScores({
      url: "https://good.example",
      finalUrl: "https://good.example",
      status: 200,
      ok: true,
      ttfbMs: 150,
      totalMs: 200,
      htmlBytes: 5000,
      contentType: "text/html",
      server: "cloudflare",
      security: {
        // every header present
        headers: [
          { header: "content-security-policy", present: true, value: "x", severity: "high", description: "" },
        ],
        missingCount: 0,
      },
      performance: {
        ttfbMs: 150,
        totalMs: 200,
        htmlBytes: 5000,
        estimatedAssetCount: 2,
        compression: "br",
      },
      seo: {
        title: "A great page title",
        titleLength: 18,
        metaDescription: "A description that is well within the 50 to 160 character bound.",
        metaDescriptionLength: 66,
        h1Count: 1,
        h2Count: 3,
        hasViewport: true,
        hasCanonical: true,
        hasOgTitle: true,
        hasOgDescription: true,
        lang: "en",
      },
      accessibility: {
        score: 100,
        issues: [],
        imagesMissingAlt: 0,
        totalImages: 0,
        headingOrderOk: true,
      },
      tls: {
        protocol: "TLSv1.3",
        cipher: "x",
        httpVersion: "HTTP/2",
        country: "US",
        colo: "SFO",
      },
      links: { sampled: 0, broken: [] },
    });
    expect(score.performance).toBe(100);
    expect(score.security).toBe(100);
    expect(score.seo).toBeGreaterThanOrEqual(95);
  });
});
