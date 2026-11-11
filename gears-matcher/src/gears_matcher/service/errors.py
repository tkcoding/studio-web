"""A refused request, as the contract's problem details (RFC 9457) with a stable `code`."""

from http import HTTPStatus


class ProblemError(Exception):
    """An answer that is not a success. `code` is for programs, `detail` is one line of text for
    people and never holds a key, a header or document text."""

    def __init__(
        self,
        status: HTTPStatus,
        code: str,
        detail: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(f"{status.value} {code}: {detail}")
        self.status = status
        self.code = code
        self.detail = detail
        self.headers = headers or {}

    def body(self) -> dict[str, object]:
        return {
            "type": "about:blank",
            "title": self.code.replace("_", " "),
            "status": self.status.value,
            "code": self.code,
            "detail": self.detail,
        }


def bad_request(detail: str) -> ProblemError:
    return ProblemError(HTTPStatus.BAD_REQUEST, "bad_request", detail)


def unprocessable(code: str, detail: str) -> ProblemError:
    return ProblemError(HTTPStatus.UNPROCESSABLE_ENTITY, code, detail)


def too_large(detail: str) -> ProblemError:
    return ProblemError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", detail)


def not_found(detail: str = "no such run") -> ProblemError:
    return ProblemError(HTTPStatus.NOT_FOUND, "not_found", detail)
