//! A product's infra services as its `product.gdl` says them (ADR-0065 §1),
//! the profiles it declares, and which lines say which part of the product:
//! `infra = [use_service("keycloak", source = "...", image = "...",
//! config = {...}), ...]` inside `product(...)`.
//!
//! Moved from the portal (`infra-gdl.ts`, `infra-store.ts` and
//! `product-map.ts` `productGdlLines`), which edited the description as text
//! in the browser. Read and written as text, the way a person writes it: the
//! rest of the file, its comments among it, is left as it was. Only literals
//! are read -- strings, and dicts of strings -- which is all `use_service`
//! takes. A call with anything else keeps its text: `profile_config` is
//! carried over unread. The engine is not asked here: what it says of the
//! result is the save's check, as for any other revision.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value};

/// One `use_service(...)` call.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UseService {
    pub name: String,
    pub source: String,
    pub image: Option<String>,
    pub chart: Option<String>,
    pub chart_version: Option<String>,
    /// Keys of the passport's `config` the product sets.
    pub config: BTreeMap<String, String>,
    /// The `profile_config = {...}` argument as written, carried over unread.
    pub profile_config_text: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TokKind {
    Str,
    Ident,
    Punct,
}

#[derive(Clone, Debug)]
struct Tok {
    kind: TokKind,
    /// The raw text; for a string, its value.
    text: String,
    value: String,
    /// Byte offsets into the source.
    start: usize,
    end: usize,
}

/// Starlark's tokens, enough of them: strings, names, punctuation; comments
/// and whitespace skipped.
fn tokens(text: &str) -> Vec<Tok> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let at = |i: usize| chars.get(i).map(|&(_, c)| c);
    let offset = |i: usize| chars.get(i).map_or(text.len(), |&(o, _)| o);
    let starts_with = |i: usize, s: &str| text[offset(i)..].starts_with(s);
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i].1;
        if c == '#' {
            while i < chars.len() && chars[i].1 != '\n' {
                i += 1;
            }
        } else if c.is_whitespace() {
            i += 1;
        } else if c == '"' || c == '\'' {
            let start = i;
            let close: String = if starts_with(i, &c.to_string().repeat(3)) {
                c.to_string().repeat(3)
            } else {
                c.to_string()
            };
            i += close.chars().count();
            let mut value = String::new();
            while i < chars.len() && !starts_with(i, &close) {
                if chars[i].1 == '\\' && i + 1 < chars.len() {
                    let n = chars[i + 1].1;
                    value.push(match n {
                        'n' => '\n',
                        't' => '\t',
                        other => other,
                    });
                    i += 2;
                } else {
                    value.push(chars[i].1);
                    i += 1;
                }
            }
            i = (i + close.chars().count()).min(chars.len());
            out.push(Tok {
                kind: TokKind::Str,
                text: text[offset(start)..offset(i)].to_string(),
                value,
                start: offset(start),
                end: offset(i),
            });
        } else if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            while at(i).is_some_and(|c| c.is_ascii_alphanumeric() || c == '_') {
                i += 1;
            }
            let word = text[offset(start)..offset(i)].to_string();
            out.push(Tok {
                kind: TokKind::Ident,
                value: word.clone(),
                text: word,
                start: offset(start),
                end: offset(i),
            });
        } else {
            out.push(Tok {
                kind: TokKind::Punct,
                text: c.to_string(),
                value: c.to_string(),
                start: offset(i),
                end: offset(i + 1),
            });
            i += 1;
        }
    }
    out
}

fn is_punct(t: Option<&Tok>, s: &str) -> bool {
    t.is_some_and(|t| t.kind == TokKind::Punct && t.text == s)
}

fn opens(t: Option<&Tok>) -> bool {
    t.is_some_and(|t| t.kind == TokKind::Punct && matches!(t.text.as_str(), "(" | "[" | "{"))
}

/// The index of the token closing the bracket at `at`.
fn closing(toks: &[Tok], at: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (i, t) in toks.iter().enumerate().skip(at) {
        if t.kind != TokKind::Punct {
            continue;
        }
        match t.text.as_str() {
            "(" | "[" | "{" => depth += 1,
            ")" | "]" | "}" => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Past the token at `i`: past its whole bracket when it opens one.
fn next(toks: &[Tok], i: usize) -> usize {
    if opens(toks.get(i)) {
        closing(toks, i).map_or(toks.len(), |c| c + 1)
    } else {
        i + 1
    }
}

/// The `product(` call's open and close tokens.
fn product_call(toks: &[Tok]) -> Option<(usize, usize)> {
    for i in 0..toks.len().saturating_sub(1) {
        if toks[i].kind == TokKind::Ident
            && toks[i].text == "product"
            && is_punct(toks.get(i + 1), "(")
        {
            return closing(toks, i + 1).map(|close| (i + 1, close));
        }
    }
    None
}

/// A top-level keyword argument of the call between `open` and `close`:
/// where its name is, where its value starts and where it ends (exclusive),
/// by token.
#[derive(Clone, Copy, Debug)]
struct Arg {
    name: usize,
    value: usize,
    end: usize,
}

fn argument(toks: &[Tok], open: usize, close: usize, name: &str) -> Option<Arg> {
    let mut i = open + 1;
    while i < close {
        let t = &toks[i];
        if t.kind == TokKind::Ident && is_punct(toks.get(i + 1), "=") && t.text == name {
            let value = i + 2;
            let mut j = value;
            while j < close && !is_punct(toks.get(j), ",") {
                j = next(toks, j);
            }
            return Some(Arg {
                name: i,
                value,
                end: j.min(close),
            });
        }
        i = next(toks, i);
    }
    None
}

/// A dict of string literals, or none when it holds anything else.
fn string_dict(toks: &[Tok], open: usize, close: usize) -> Option<BTreeMap<String, String>> {
    let mut out = BTreeMap::new();
    let mut i = open + 1;
    while i < close {
        let (k, colon, v) = (toks.get(i)?, toks.get(i + 1), toks.get(i + 2)?);
        if k.kind != TokKind::Str || !is_punct(colon, ":") || v.kind != TokKind::Str {
            return None;
        }
        out.insert(k.value.clone(), v.value.clone());
        i += 3;
        if is_punct(toks.get(i), ",") {
            i += 1;
        }
    }
    Some(out)
}

/// The infra services `text` chooses; none when its product says no `infra`.
pub fn read_infra(text: &str) -> Option<Vec<UseService>> {
    let toks = tokens(text);
    let (open, close) = product_call(&toks)?;
    let arg = argument(&toks, open, close, "infra")?;
    if !is_punct(toks.get(arg.value), "[") {
        return None;
    }
    let list_close = closing(&toks, arg.value)?;
    let mut out = Vec::new();
    let mut i = arg.value + 1;
    while i < list_close {
        if !(toks[i].kind == TokKind::Ident
            && toks[i].text == "use_service"
            && is_punct(toks.get(i + 1), "("))
        {
            i += 1;
            continue;
        }
        let call_open = i + 1;
        let Some(call_close) = closing(&toks, call_open) else {
            break;
        };
        let first = toks.get(call_open + 1);
        let mut s = UseService {
            name: first
                .filter(|t| t.kind == TokKind::Str)
                .map(|t| t.value.clone())
                .unwrap_or_default(),
            ..UseService::default()
        };
        let literal = |key: &str| {
            argument(&toks, call_open, call_close, key)
                .filter(|a| toks[a.value].kind == TokKind::Str && a.end == a.value + 1)
                .map(|a| toks[a.value].value.clone())
        };
        s.source = literal("source").unwrap_or_default();
        s.image = literal("image");
        s.chart = literal("chart");
        s.chart_version = literal("chart_version");
        if let Some(config) = argument(&toks, call_open, call_close, "config")
            && is_punct(toks.get(config.value), "{")
        {
            s.config = closing(&toks, config.value)
                .and_then(|c| string_dict(&toks, config.value, c))
                .unwrap_or_default();
        }
        if let Some(profiles) = argument(&toks, call_open, call_close, "profile_config")
            && profiles.end > profiles.value
        {
            s.profile_config_text =
                Some(text[toks[profiles.value].start..toks[profiles.end - 1].end].to_string());
        }
        out.push(s);
        i = call_close + 1;
    }
    Some(out)
}

/// A string as the description writes it.
fn quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\""))
}

/// One call, on one line.
pub fn use_service_text(s: &UseService) -> String {
    let mut args = vec![quote(&s.name), format!("source = {}", quote(&s.source))];
    for (key, value) in [
        ("image", &s.image),
        ("chart", &s.chart),
        ("chart_version", &s.chart_version),
    ] {
        if let Some(v) = value.as_deref().filter(|v| !v.is_empty()) {
            args.push(format!("{key} = {}", quote(v)));
        }
    }
    if !s.config.is_empty() {
        let pairs: Vec<String> = s
            .config
            .iter()
            .map(|(k, v)| format!("{}: {}", quote(k), quote(v)))
            .collect();
        args.push(format!("config = {{{}}}", pairs.join(", ")));
    }
    if let Some(p) = s.profile_config_text.as_deref().filter(|p| !p.is_empty()) {
        args.push(format!("profile_config = {p}"));
    }
    format!("use_service({})", args.join(", "))
}

/// The indentation of the line byte offset `at` is on.
fn indent_at(text: &str, at: usize) -> String {
    let line = text[..at].rfind('\n').map_or(0, |n| n + 1);
    text[line..]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect()
}

/// Why a description cannot be edited.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotEditable(pub String);

impl std::fmt::Display for NotEditable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// `text` with its product's `infra` set to `list`: the argument replaced
/// where it is, else added before `gears`, else at the end of `product(...)`.
/// An empty list takes the argument out.
pub fn write_infra(text: &str, list: &[UseService]) -> Result<String, NotEditable> {
    let toks = tokens(text);
    let (open, close) = product_call(&toks)
        .ok_or_else(|| NotEditable("product.gdl has no product(...) call".to_string()))?;
    let arg = argument(&toks, open, close, "infra");
    let gears = argument(&toks, open, close, "gears");
    let anchor = arg.or(gears).map_or(close, |a| a.name);
    let mut indent = indent_at(text, toks[anchor].start);
    if indent.is_empty() {
        indent = "    ".to_string();
    }
    let block = if list.is_empty() {
        String::new()
    } else {
        let lines: Vec<String> = list
            .iter()
            .map(|s| format!("{indent}    {},", use_service_text(s)))
            .collect();
        format!("infra = [\n{}\n{indent}]", lines.join("\n"))
    };
    if let Some(arg) = arg {
        let start = toks[arg.name].start;
        let value_end = toks[arg.end - 1].end;
        if !block.is_empty() {
            return Ok(format!("{}{block}{}", &text[..start], &text[value_end..]));
        }
        // Out with its comma and the line it stood on.
        let after = if is_punct(toks.get(arg.end), ",") {
            toks[arg.end].end
        } else {
            value_end
        };
        let line_start = text[..start].rfind('\n').map_or(0, |n| n + 1);
        let line_end = text[after..].find('\n').map(|n| after + n);
        let whole = text[line_start..start].trim().is_empty()
            && line_end.is_none_or(|e| text[after..e].trim().is_empty());
        return Ok(if whole {
            let resume = line_end.map_or(after, |e| e + 1);
            format!("{}{}", &text[..line_start], &text[resume..])
        } else {
            format!("{}{}", &text[..start], &text[after..])
        });
    }
    if block.is_empty() {
        return Ok(text.to_string());
    }
    if let Some(gears) = gears {
        let at = toks[gears.name].start;
        return Ok(format!("{}{block},\n{indent}{}", &text[..at], &text[at..]));
    }
    let last = &toks[close - 1];
    let comma = if last.text == "," || last.text == "(" {
        ""
    } else {
        ","
    };
    let rest = text[last.end..].trim_start_matches([' ', '\t']);
    Ok(format!(
        "{}{comma}\n{indent}{block},\n{rest}",
        &text[..last.end]
    ))
}

static HOME_SOURCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"source\(\s*id\s*=\s*"([^"]+)"\s*,\s*at\s*=\s*path\("#).expect("constant")
});

/// The id of the source the product's own repository is (`at = path(...)`):
/// where a service added from the project's catalogue is found.
pub fn home_source(text: &str) -> Option<String> {
    HOME_SOURCE
        .captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// One profile a product declares: its id and the constructor that makes it
/// (`kubernetes`, `embedded`, `self_hosted`, ...).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileDecl {
    pub id: String,
    pub kind: String,
}

/// The profiles `text`'s product declares, in its order: each call in its
/// `profiles = [...]` that names an `id` string. None when the product has
/// no literal `profiles` list (or no product at all).
pub fn read_profiles(text: &str) -> Option<Vec<ProfileDecl>> {
    let toks = tokens(text);
    let (open, close) = product_call(&toks)?;
    let arg = argument(&toks, open, close, "profiles")?;
    if !is_punct(toks.get(arg.value), "[") {
        return None;
    }
    let list_close = closing(&toks, arg.value)?;
    let mut out = Vec::new();
    let mut i = arg.value + 1;
    while i < list_close {
        let t = &toks[i];
        if t.kind == TokKind::Ident && is_punct(toks.get(i + 1), "(") {
            let call_open = i + 1;
            let Some(call_close) = closing(&toks, call_open) else {
                break;
            };
            if let Some(id) = argument(&toks, call_open, call_close, "id")
                && toks[id.value].kind == TokKind::Str
                && id.end == id.value + 1
            {
                out.push(ProfileDecl {
                    id: toks[id.value].value.clone(),
                    kind: t.text.clone(),
                });
            }
            i = call_close + 1;
        } else {
            i = next(&toks, i);
        }
    }
    Some(out)
}

/* ── which lines say which part of the product ── */

/// The node the map draws for the shell.
pub const SHELL_NODE: &str = "shell";

/// A gear's key as a route names it: `cf-gears-account-management` and
/// `account-management` are the same gear.
pub fn gear_key(name: &str) -> String {
    let k = name.trim().to_lowercase();
    let k = k
        .strip_prefix("cf-gears-")
        .map_or(k.clone(), str::to_string);
    k.strip_prefix("cf-").map_or(k.clone(), str::to_string)
}

static FRONTEND_OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bfrontend\s*=\s*frontx_product\(").expect("constant"));
static SHELL_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*shell\s*=\s*path\(").expect("constant"));
static MFE_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\bfrontx_mfe\(\s*package\s*=\s*path\(\s*"([^"]+)""#).expect("constant")
});
static GEAR_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\buse_gear\(\s*"([^"]+)""#).expect("constant"));
static PLUGIN_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bplugin\(\s*"([^"]+)""#).expect("constant"));
static POSTGRES_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bdatabase\s*=\s*postgres\(").expect("constant"));

/// Which lines (1-based) of a `product.gdl` each part of the product is, in
/// the order they are claimed: a gear its `use_gear("<id>"` line
/// (`gear:<key>`), a plugin its `plugin("<id>"` (on its host's line), a
/// micro-frontend its `frontx_mfe(package = path("<path>")` line
/// (`mfe:<path>`), the shell the `shell = path(` line inside `frontend =
/// frontx_product(` (`shell`), Postgres the profiles' `database = postgres(`
/// lines (`infra:postgres`). On one line, the gear comes before the plugins
/// written on it.
pub fn node_lines(text: &str) -> Vec<(usize, Vec<String>)> {
    let mut out: Vec<(usize, Vec<String>)> = Vec::new();
    let mut in_frontend = false;
    let mut depth: i32 = 0;
    let normalised = text.replace("\r\n", "\n");
    for (i, line) in normalised.split('\n').enumerate() {
        let n = i + 1;
        let code = line.split('#').next().unwrap_or("");
        let mut ids: Vec<String> = Vec::new();
        let mut claim = |id: String| {
            if !ids.contains(&id) {
                ids.push(id);
            }
        };
        if FRONTEND_OPEN.is_match(code) {
            in_frontend = true;
            depth = 0;
        }
        if in_frontend {
            if SHELL_LINE.is_match(code) {
                claim(SHELL_NODE.to_string());
            }
            for ch in code.chars() {
                match ch {
                    '(' | '[' => depth += 1,
                    ')' | ']' => depth -= 1,
                    _ => {}
                }
            }
            if depth <= 0 && !code.trim().ends_with("frontx_product(") {
                in_frontend = false;
            }
        }
        if let Some(m) = MFE_LINE.captures(code) {
            claim(format!("mfe:{}", &m[1]));
        }
        if let Some(m) = GEAR_LINE.captures(code) {
            claim(format!("gear:{}", gear_key(&m[1])));
        }
        for m in PLUGIN_LINE.captures_iter(code) {
            claim(format!("gear:{}", gear_key(&m[1])));
        }
        if POSTGRES_LINE.is_match(code) {
            claim("infra:postgres".to_string());
        }
        if !ids.is_empty() {
            out.push((n, ids));
        }
    }
    out
}

/// Each node with its lines, in the order the nodes first appear.
pub fn lines_by_node(lines: &[(usize, Vec<String>)]) -> Vec<(String, Vec<usize>)> {
    let mut out: Vec<(String, Vec<usize>)> = Vec::new();
    for (n, ids) in lines {
        for id in ids {
            match out.iter_mut().find(|(k, _)| k == id) {
                Some((_, at)) => at.push(*n),
                None => out.push((id.clone(), vec![*n])),
            }
        }
    }
    out
}

/* ── an infra service between product.gdl and the project's records ── */

fn text_of(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn object_of(v: &Value, key: &str) -> Map<String, Value> {
    v.get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

/// An infra service's passport from its catalogue node's `value`
/// (`service.gdl`, `kind = "infra"`); none for any other component.
pub fn passport_of(value: &Value) -> Option<Value> {
    if value.get("kind").and_then(Value::as_str) != Some("service")
        || value.get("service_kind").and_then(Value::as_str) != Some("infra")
    {
        return None;
    }
    let name = value.get("name").and_then(Value::as_str)?;
    let infra = value.get("infra").cloned().unwrap_or(Value::Null);
    let only = |v: Map<String, Value>, keep: fn(&Value) -> bool| -> Value {
        Value::Object(v.into_iter().filter(|(_, x)| keep(x)).collect())
    };
    let strings = |v: Option<&Value>| -> Value {
        Value::Array(
            v.and_then(Value::as_array)
                .map(|a| a.iter().filter(|x| x.is_string()).cloned().collect())
                .unwrap_or_default(),
        )
    };
    let opt = |s: Option<String>| s.map_or(Value::Null, Value::String);
    Some(serde_json::json!({
        "name": name,
        "version": opt(text_of(value, "version")),
        "description": opt(text_of(value, "description")),
        "image": opt(text_of(value, "image")),
        "ports": only(object_of(value, "ports"), Value::is_number),
        "health": opt(text_of(value, "health")),
        "args": strings(infra.get("args")),
        "config": only(object_of(&infra, "config"), Value::is_string),
        "secrets": strings(infra.get("secrets")),
        "provides": only(object_of(&infra, "provides"), Value::is_string),
        "stateful": infra.get("stateful").and_then(Value::as_bool).unwrap_or(false),
        "storage": opt(text_of(&infra, "storage")),
        "data_path": opt(text_of(&infra, "data_path")),
        "chart": opt(text_of(&infra, "chart")),
        "chart_version": opt(text_of(&infra, "chart_version")),
    }))
}

/// Every infra service the catalogue's nodes offer, by name, sorted.
pub fn offered_infra(nodes: &[Value]) -> Vec<Value> {
    let mut by_name: BTreeMap<String, Value> = BTreeMap::new();
    for n in nodes {
        if let Some(p) = n.get("value").and_then(passport_of)
            && let Some(name) = p.get("name").and_then(Value::as_str)
        {
            by_name.entry(name.to_string()).or_insert(p);
        }
    }
    by_name.into_values().collect()
}

fn passport_name(service: &Value) -> Option<&str> {
    service.get("passport")?.get("name")?.as_str()
}

fn named<'a>(
    list: &'a [Value],
    name: &str,
    key: impl Fn(&Value) -> Option<&str>,
) -> Option<&'a Value> {
    list.iter().find(|v| key(v) == Some(name))
}

/// A service as the portal edits it: the passport the catalogue offers (else
/// the one the project kept) with the description's choice over it, and the
/// environment's side from the project's record.
pub fn service_of(u: &UseService, offered: &[Value], records: &[Value]) -> Value {
    let record = named(records, &u.name, passport_name);
    let base = named(offered, &u.name, |p| p.get("name").and_then(Value::as_str))
        .cloned()
        .or_else(|| record.and_then(|r| r.get("passport").cloned()))
        .unwrap_or_else(|| {
            serde_json::json!({ "name": u.name, "ports": {}, "args": [], "config": {},
                "secrets": [], "provides": {}, "stateful": false })
        });
    let mut passport = base.as_object().cloned().unwrap_or_default();
    for (key, value) in [
        ("image", &u.image),
        ("chart", &u.chart),
        ("chart_version", &u.chart_version),
    ] {
        if let Some(v) = value {
            passport.insert(key.to_string(), Value::String(v.clone()));
        }
    }
    let mut config = object_of(&base, "config");
    for (k, v) in &u.config {
        config.insert(k.clone(), Value::String(v.clone()));
    }
    passport.insert("config".to_string(), Value::Object(config));
    let mut out = record
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    out.insert("passport".to_string(), Value::Object(passport));
    Value::Object(out)
}

/// The call that says service `s`: only what differs from the catalogue's
/// passport, so a passport's later default reaches the product. Without the
/// catalogue's passport to compare with, what the description said before is
/// kept. `was` is what the description said of it; `home` the source a new
/// one is found in.
pub fn use_of(s: &Value, offered: &[Value], was: Option<&UseService>, home: &str) -> UseService {
    let empty = Value::Null;
    let p = s.get("passport").unwrap_or(&empty);
    let name = p
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let base = named(offered, &name, |o| o.get("name").and_then(Value::as_str));
    let differs = |key: &str| {
        let mine = text_of(p, key);
        let theirs = base.and_then(|b| text_of(b, key));
        mine.filter(|m| Some(m) != theirs.as_ref())
    };
    let config = match base {
        Some(b) => {
            let theirs = object_of(b, "config");
            object_of(p, "config")
                .into_iter()
                .filter_map(|(k, v)| {
                    let v = v.as_str()?.to_string();
                    let t = theirs.get(&k)?;
                    (t.as_str() != Some(v.as_str())).then_some((k, v))
                })
                .collect()
        }
        None => was.map(|w| w.config.clone()).unwrap_or_default(),
    };
    UseService {
        source: was.map_or_else(|| home.to_string(), |w| w.source.clone()),
        image: if base.is_some() {
            differs("image")
        } else {
            was.and_then(|w| w.image.clone())
        },
        chart: if base.is_some() {
            differs("chart")
        } else {
            was.and_then(|w| w.chart.clone())
        },
        chart_version: if base.is_some() {
            differs("chart_version")
        } else {
            was.and_then(|w| w.chart_version.clone())
        },
        config,
        profile_config_text: was.and_then(|w| w.profile_config_text.clone()),
        name,
    }
}

/// `text` with its infra services set to what `items` (services as the
/// portal edits them) say, each only where it differs from the catalogue's
/// passport.
pub fn infra_text_for(
    text: &str,
    items: &[Value],
    offered: &[Value],
) -> Result<String, NotEditable> {
    let chosen = read_infra(text).unwrap_or_default();
    let home = home_source(text).unwrap_or_default();
    let mut seen = BTreeSet::new();
    let list: Vec<UseService> = items
        .iter()
        .map(|s| {
            let name = passport_name(s).unwrap_or_default();
            use_of(s, offered, chosen.iter().find(|u| u.name == name), &home)
        })
        .filter(|u| !u.name.is_empty() && seen.insert(u.name.clone()))
        .collect();
    write_infra(text, &list)
}

#[cfg(test)]
#[path = "infra_gdl_tests.rs"]
mod tests;
