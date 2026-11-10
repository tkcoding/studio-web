"""Committed alias tables. Edit here, not in the join code; stale entries are reported."""

# `gear.gdl` gear id -> (GEARS.md section name, GEARS.md category slug), for gears whose names
# differ
# between the two sources. Gears with no GEARS.md section at all (mini-chat, graph-storage,
# authz-resolver, simple-user-settings, grpc-hub, service-discovery, BSS Approvals) are deliberately
# not listed: they stay gdl-only.
GDL_TO_MD = {
    "event-broker": ("Event Broker", "core-functionality"),  # gdl: "Events Broker"
    "authn-resolver": (
        "Auth Resolver",
        "core-platform-integration",
    ),  # gdl: "Authentication Resolver"
    "cluster": ("Cluster Plane", "serverless"),  # gdl: "Cluster Coordination"
    "resource-group": (
        "Resource Groups",
        "core-functionality",
    ),  # gdl: "Resource Groups Manager"
    "serverless-runtime": (
        "Serverless Runtimes",
        "serverless",
    ),  # gdl: "Serverless Runtime"
    "approval-service": ("Approvals", "core-functionality"),  # gdl: "Approval Service"
    "account-management": (
        "Account Manager",
        "core-platform-services",
    ),  # gdl: "Account Management"
}

# Names other documents use for a gear (crate/lib names that differ from the catalogue id).
# normalised external name -> catalogue gear id (without the `<source>/` prefix).
EXTERNAL_NAMES = {
    "api-egress": "oagw",  # Studio's registered_gears.rs links oagw as `api_egress`
}
