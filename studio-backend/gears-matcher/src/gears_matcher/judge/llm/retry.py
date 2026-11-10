"""One retry policy for both provider clients (T4b note D7a, D9).

Retried: a transport error (a timeout, a refused or dropped connection) and HTTP 429, 502, 503 and
504, at most `SDK_RETRIES` times per call. The pause is fixed (0.5 s, doubled per retry) and never
a server's `retry-after`: a provider can ask for any wait, and the judge's time budget cannot
follow it.
"""

RETRY_STATUSES = frozenset({429, 502, 503, 504})
RETRY_PAUSE_S = 0.5  # doubled per retry; the judge's budget leaves room for the few seconds it adds


def pause_before(attempt: int) -> float:
    """Seconds to wait before attempt number `attempt` (0 is the first and does not wait)."""
    return RETRY_PAUSE_S * 2 ** (attempt - 1) if attempt else 0.0
