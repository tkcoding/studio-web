import { describe, expect, it } from "vitest";

import { clusterHost, kubeconfigServer, looksLikeKubeconfig } from "./kubeconfig";

const YAML = `apiVersion: v1
kind: Config
clusters:
- name: webstudio
  cluster:
    server: https://188.42.240.254:6443
    certificate-authority-data: Q0E=
users:
- name: deployer
  user:
    token: t0k
current-context: webstudio
`;

describe("kubeconfig", () => {
  it("reads the API server of a kubeconfig in YAML", () => {
    expect(kubeconfigServer(YAML)).toBe("https://188.42.240.254:6443");
  });

  it("reads it from a kubeconfig written as JSON on one line", () => {
    const json = JSON.stringify({ clusters: [{ name: "c", cluster: { server: "https://k.example.com:6443" } }] });
    expect(kubeconfigServer(json)).toBe("https://k.example.com:6443");
  });

  it("names no server when the kubeconfig has several, or none", () => {
    expect(kubeconfigServer(`${YAML}\n- name: other\n  cluster:\n    server: https://10.0.0.1:6443\n`)).toBeNull();
    expect(kubeconfigServer("eyJhbGciOiJSUzI1NiJ9.e30.sig")).toBeNull();
  });

  it("tells a kubeconfig from a bare token", () => {
    expect(looksLikeKubeconfig(YAML)).toBe(true);
    expect(looksLikeKubeconfig("eyJhbGciOiJSUzI1NiJ9.e30.sig")).toBe(false);
  });

  it("names a cluster by its host", () => {
    expect(clusterHost("https://188.42.240.254:6443")).toBe("188.42.240.254");
    expect(clusterHost("not a url")).toBe("not a url");
  });
});
