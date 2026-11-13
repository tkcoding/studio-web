/* A cluster's credential as people hold it (ADR-0043): a service-account
 * token, or a kubeconfig with the cluster's own CA. The server parses and
 * checks it (connectors/kubernetes.rs); this only reads what the form can
 * fill in from it. */

/** The API server a kubeconfig names, when it names exactly one. A line scan,
 *  not a YAML parser: enough for `kubectl config view --raw` output and for a
 *  kubeconfig written as JSON on one line. */
export function kubeconfigServer(text: string): string | null {
  const servers = new Set([...text.matchAll(/"?server"?\s*:\s*"?(https:\/\/[^\s",}]+)/g)].map((m) => m[1]));
  return servers.size === 1 ? [...servers][0] : null;
}

/** A kubeconfig rather than a bare token. */
export function looksLikeKubeconfig(text: string): boolean {
  return /\bclusters\b/.test(text) && /\bserver\b/.test(text);
}

/** The host of an API server, as a cluster's default name: `188.42.240.254`. */
export function clusterHost(server: string): string {
  try {
    return new URL(server).hostname;
  } catch {
    return server;
  }
}
