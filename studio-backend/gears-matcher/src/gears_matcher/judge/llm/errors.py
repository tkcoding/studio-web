"""T4b: the errors a provider client raises. None of their messages holds an API key."""


class ClientError(Exception):
    """The model call failed. The message never holds the API key."""


class MissingConfigError(ClientError):
    """A setting the client needs (a key, a host) is not set; the message names the variable."""


class ModelRefusedError(ClientError):
    """The model declined to answer (a safety stop)."""


class ReplyCutOffError(ClientError):
    """The reply hit its token limit, so its JSON is incomplete."""


class ProviderError(ClientError):
    """The provider returned an error, or could not be reached."""
