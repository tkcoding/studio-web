# The gears-matcher service (T9, ADR-0069): `gears-service` on port 8080.
#
# Build context is this folder:  docker build -t gears-matcher gears-matcher
#
# Two stages: the first installs the locked dependencies and the project into a virtualenv, the
# second copies only that virtualenv. Python images are multi-arch, so this builds natively on
# amd64 and arm64.
#
# The service needs `git` at run time (the Gear catalogue is read from a `gears-rust` checkout with
# `git show`, at the pinned commits), and a checkout to read: a volume, or an init container that
# clones it (see the chart). The LLM connector's settings come from the environment, or from a file
# named by GEARS_MATCHER_ENV_FILE.

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# Dependencies first, so a source change does not reinstall them.
COPY pyproject.toml uv.lock README.md LICENSE NOTICE ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY schemas ./schemas
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 matcher \
 && useradd --system --uid 10001 --gid matcher --home-dir /var/lib/gears-matcher --shell /usr/sbin/nologin matcher \
 && install -d -o matcher -g matcher /var/lib/gears-matcher
COPY --from=build /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    GEARS_MATCHER_DATA=/var/lib/gears-matcher \
    GEARS_RUST_REPO=/var/lib/gears-matcher/gears-rust \
    GEARS_MATCHER_HOST=0.0.0.0 \
    GEARS_MATCHER_PORT=8080
# Numeric, so a cluster's runAsNonRoot check can verify it (a name cannot be checked).
USER 10001:10001
WORKDIR /var/lib/gears-matcher
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).status == 200 else 1)"]
ENTRYPOINT ["gears-service"]
