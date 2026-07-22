import { describe, expect, it } from "vitest";
import {
  BFF_API_URL_DEFAULTS,
  defaultBffApiUrlForRole,
  diagnoseBffApiUrl,
  isContainerLocalBffUrl,
  previewPublicBffOrigin,
  productionLoopbackBffUrl,
  resolveBffApiUrl,
} from "./bff-api-url.js";

describe("resolveBffApiUrl", () => {
  it("prefers explicit BFF_API_URL over role defaults", () => {
    const explicit = `${previewPublicBffOrigin()}/`;
    expect(
      resolveBffApiUrl({
        BFF_API_URL: explicit,
        TRENDS_DEPLOYMENT_ROLE: "preview",
        PORT: BFF_API_URL_DEFAULTS.previewApiPort,
      }),
    ).toBe(previewPublicBffOrigin());
  });

  it("accepts TRENDS_BFF_API_URL alias", () => {
    const loopback = productionLoopbackBffUrl();
    expect(
      resolveBffApiUrl({
        TRENDS_BFF_API_URL: loopback,
      }),
    ).toBe(loopback);
  });

  it("uses public preview host when deployment role is preview and URL unset", () => {
    // Docker Convex cannot use container-local production-port loopback for host BFF.
    expect(
      resolveBffApiUrl({
        TRENDS_DEPLOYMENT_ROLE: "preview",
      }),
    ).toBe(previewPublicBffOrigin());
  });

  it("uses host loopback for production when URL unset", () => {
    expect(resolveBffApiUrl({})).toBe(productionLoopbackBffUrl());
    expect(
      resolveBffApiUrl({
        TRENDS_DEPLOYMENT_ROLE: "production",
        PORT: BFF_API_URL_DEFAULTS.productionApiPort,
      }),
    ).toBe(productionLoopbackBffUrl());
  });

  it("maps preview API PORT to host preview loopback when role unset", () => {
    expect(
      resolveBffApiUrl({ PORT: BFF_API_URL_DEFAULTS.previewApiPort }),
    ).toBe(`http://${BFF_API_URL_DEFAULTS.loopbackHost}:${BFF_API_URL_DEFAULTS.previewApiPort}`);
  });

  it("honors PREVIEW_PUBLIC_HOST override without hardcoding alternate hosts in callers", () => {
    expect(
      resolveBffApiUrl({
        TRENDS_DEPLOYMENT_ROLE: "preview",
        PREVIEW_PUBLIC_HOST: "preview.example.test",
      }),
    ).toBe("https://preview.example.test");
  });
});

describe("defaultBffApiUrlForRole / isContainerLocalBffUrl", () => {
  it("returns role defaults from shared helpers", () => {
    expect(defaultBffApiUrlForRole("preview")).toBe(previewPublicBffOrigin());
    expect(defaultBffApiUrlForRole("production")).toBe(productionLoopbackBffUrl());
  });

  it("detects container-local production-port loopback", () => {
    expect(isContainerLocalBffUrl(productionLoopbackBffUrl())).toBe(true);
    expect(isContainerLocalBffUrl(`http://localhost:${BFF_API_URL_DEFAULTS.productionApiPort}`)).toBe(true);
    expect(isContainerLocalBffUrl(previewPublicBffOrigin())).toBe(false);
  });
});

describe("diagnoseBffApiUrl", () => {
  it("flags preview explicit URL that still targets container production-port loopback", () => {
    const issues = diagnoseBffApiUrl(
      {
        BFF_API_URL: `http://localhost:${BFF_API_URL_DEFAULTS.productionApiPort}`,
        TRENDS_DEPLOYMENT_ROLE: "preview",
        PORT: BFF_API_URL_DEFAULTS.previewApiPort,
      },
      { role: "preview" },
    );
    expect(issues.some((i) => i.code === "preview_points_at_container_localhost")).toBe(true);
    expect(issues[0]?.message).toContain(previewPublicBffOrigin());
  });

  it("accepts public preview BFF URL", () => {
    const issues = diagnoseBffApiUrl(
      {
        BFF_API_URL: previewPublicBffOrigin(),
        TRENDS_DEPLOYMENT_ROLE: "preview",
      },
      { role: "preview" },
    );
    expect(issues).toEqual([]);
  });

  it("flags preview PORT with BFF still on production loopback", () => {
    const issues = diagnoseBffApiUrl({
      BFF_API_URL: productionLoopbackBffUrl(),
      PORT: BFF_API_URL_DEFAULTS.previewApiPort,
    });
    expect(issues.some((i) => i.code === "preview_points_at_container_localhost")).toBe(true);
  });

  it("production loopback default is not flagged", () => {
    const issues = diagnoseBffApiUrl(
      { TRENDS_DEPLOYMENT_ROLE: "production" },
      { role: "production" },
    );
    expect(issues).toEqual([]);
  });
});
