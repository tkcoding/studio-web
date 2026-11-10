"""Read `gear.gdl` files with `ast`, never executing them.

GDL is Starlark, which is Python syntax: `ast.parse` gives the tree and `ast.literal_eval` reads the
literal leaves. Calls such as `cargo(...)` and `extension_point(...)` are kept as plain data, and
top-level `NAME = ...` constants are resolved by name. Nothing here runs GDL code; do not add
`exec` or `eval` (see issue #2).
"""

import ast
import posixpath
from dataclasses import dataclass
from typing import Any

from gears_matcher.catalogue.models import Issue


class GdlError(ValueError):
    pass


@dataclass(frozen=True)
class Call:
    """A call kept as data: `cargo(crate_name="x")` -> `Call("cargo", (), {"crate_name": "x"})`."""

    func: str
    args: tuple[Any, ...]
    kwargs: dict[str, Any]


@dataclass(frozen=True)
class Ref:
    """A dotted name kept as data: `cluster_cap.linearizable` -> `Ref("cluster_cap.linearizable")`.

    It is a name the GDL tooling defines, not a value; this reader never looks it up."""

    name: str


@dataclass(frozen=True)
class GdlGear:
    path: str
    line: int
    name: str
    description: str
    category: str
    id: str  # explicit `id`, else the directory name
    crate: str | None
    implements: str | None
    extension_points: tuple[str, ...]  # GTS specs this gear's plugins register under
    is_plugin: bool


@dataclass(frozen=True)
class GdlParse:
    gear: GdlGear | None
    issues: tuple[Issue, ...]


def parse_gdl(text: str, path: str) -> GdlParse:
    try:
        tree = ast.parse(text, filename=path)
    except SyntaxError as exc:
        return GdlParse(
            None,
            (_error("unparsable_gdl", f"syntax error: {exc.msg}", path, exc.lineno),),
        )

    names: dict[str, Any] = {}
    calls: list[ast.Call] = []
    issues: list[Issue] = []
    for stmt in tree.body:
        try:
            if (
                isinstance(stmt, ast.Assign)
                and len(stmt.targets) == 1
                and isinstance(stmt.targets[0], ast.Name)
            ):
                names[stmt.targets[0].id] = _value(stmt.value, names)
            elif (
                isinstance(stmt, ast.Expr)
                and isinstance(stmt.value, ast.Call)
                and _func_name(stmt.value) == "gear"
            ):
                calls.append(stmt.value)
            else:
                issues.append(
                    _error(
                        "unrecognised_statement",
                        f"unexpected {type(stmt).__name__}",
                        path,
                        stmt.lineno,
                    )
                )
        except GdlError as exc:
            issues.append(_error("unreadable_gdl", str(exc), path, stmt.lineno))

    if len(calls) != 1:
        issues.append(
            _error(
                "gear_call_count",
                f"expected one gear(...) call, found {len(calls)}",
                path,
                None,
            )
        )
        return GdlParse(None, tuple(issues))
    try:
        return GdlParse(_gear(calls[0], names, path), tuple(issues))
    except GdlError as exc:
        issues.append(_error("unreadable_gdl", str(exc), path, calls[0].lineno))
        return GdlParse(None, tuple(issues))


def _gear(call: ast.Call, names: dict[str, Any], path: str) -> GdlGear:
    kw = {k.arg: _value(k.value, names) for k in call.keywords if k.arg}
    for required in ("name", "description", "category"):
        if not isinstance(kw.get(required), str):
            raise GdlError(f"gear() needs a string `{required}`")
    directory = posixpath.dirname(path)
    package = kw.get("package")
    crate = (
        _text(package.kwargs.get("crate_name"), "package crate_name")
        if isinstance(package, Call)
        else None
    )
    points = tuple(
        _string(p.args[0], "extension_point name")
        for p in kw.get("extension_points", [])
        if isinstance(p, Call) and p.func == "extension_point" and p.args
    )
    return GdlGear(
        path=path,
        line=call.lineno,
        name=kw["name"],
        description=kw["description"],
        category=kw["category"],
        id=_text(kw.get("id"), "id") or posixpath.basename(directory),
        crate=crate,
        implements=_text(kw.get("implements"), "implements"),
        extension_points=points,
        is_plugin="plugins" in directory.split("/"),
    )


def _text(value: Any, what: str) -> str | None:
    """A field that must be a string: a dotted name (`Ref`) or anything else is an error for this
    gear alone, as on main, never a value that stops the whole build (Sanjeev, #87)."""
    if value is None or isinstance(value, str):
        return value
    raise GdlError(f"gear() needs a string for `{what}`")


def _string(value: Any, what: str) -> str:
    """As `_text`, for a field that must be there."""
    if isinstance(value, str):
        return value
    raise GdlError(f"gear() needs a string for `{what}`")


def _value(node: ast.expr, names: dict[str, Any]) -> Any:
    if isinstance(node, ast.Name):
        if node.id not in names:
            raise GdlError(f"unknown name `{node.id}`")
        return names[node.id]
    if isinstance(node, ast.Call):
        return Call(
            _func_name(node),
            tuple(_value(a, names) for a in node.args),
            {k.arg: _value(k.value, names) for k in node.keywords if k.arg},
        )
    if isinstance(node, ast.Attribute) and (dotted := _dotted(node)):
        return Ref(dotted)
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_value(e, names) for e in node.elts]
    if isinstance(node, ast.Dict):
        return {
            _value(k, names): _value(v, names)
            for k, v in zip(node.keys, node.values, strict=True)
            if k
        }
    try:
        return ast.literal_eval(node)
    except ValueError as exc:
        raise GdlError(f"not a literal: {ast.unparse(node)[:60]}") from exc


def _dotted(node: ast.expr) -> str | None:
    """`a.b.c` as a string when it is only names joined by dots; anything else is not a name."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute) and (head := _dotted(node.value)):
        return f"{head}.{node.attr}"
    return None


def _func_name(call: ast.Call) -> str:
    return call.func.id if isinstance(call.func, ast.Name) else ast.unparse(call.func)


def _error(kind: str, message: str, path: str, line: int | None) -> Issue:
    return Issue(
        severity="error",
        kind=kind,
        message=message,
        where=f"{path}:{line}" if line else path,
    )
