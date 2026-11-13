//! One build of a project's model: the documents nobody has extracted at
//! their current revision are read by a model on the key of the member who
//! asked (`docs/project-domain-model.md`, "A person's key, never Studio's").
//!
//! WHY NOT A studio-tasks RUN. A run is executed by the queue worker, which
//! acts as `studio-tasks` and never as the person who asked
//! (`tasks/dispatch.rs`), and a model is reached only on a person's key. So a
//! build runs in this process under the caller's context, like a long
//! request. What it costs to lose one is small: every document finished is
//! kept by revision, and the next build starts where this one stopped.
//!
//! Up to [`PARALLEL_READS`] documents are read at once: each document's
//! extraction is kept on its own, by path and revision, so the order they
//! finish in changes nothing about the model, which is assembled in document
//! order (`super::current`).

use std::collections::HashMap;
use std::future::Future;
use std::sync::{LazyLock, Mutex};

use futures_util::stream::{self, StreamExt};

use time::OffsetDateTime;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::extract::{self, Extraction};
use crate::llm_proxy::port::{CompletionError, ModelProviders};

/// Where a project's build is, as this process knows it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BuildState {
    pub running: bool,
    /// Documents this build has to read.
    pub documents: usize,
    pub done: usize,
    /// Candidates this build sends to the judge, and how many it has.
    pub candidates: usize,
    pub judged: usize,
    pub current: Option<String>,
    /// Why the build stopped, when it did not finish: no key, most often.
    pub error: Option<String>,
    pub started_at: Option<OffsetDateTime>,
    pub finished_at: Option<OffsetDateTime>,
    /// How long reading the documents was estimated to take when the build
    /// started ([`estimate`]), so a reader has an ETA before the first
    /// document is done.
    pub estimated_seconds: Option<u64>,
    /// The one document this build reads again, when it was asked for one.
    pub path: Option<String>,
    /// Every document this build reads again, when some were named.
    pub paths: Vec<String>,
}

/// Most documents read at once. Each is a model call on the caller's key, so
/// the bound is what keeps a large project from tripping the provider's rate
/// limit.
pub const PARALLEL_READS: usize = 4;

/// Seconds one document takes to read alone when no build of the project has
/// been timed yet: a few pieces, each one model call.
pub const DEFAULT_SECONDS_PER_DOCUMENT: f64 = 40.0;

/// Two extractions kept further apart than this were not of the same build.
const SAME_BUILD_GAP_SECONDS: f64 = 600.0;

/// The extractions a build's pace is measured on: the latest ones.
const PACE_SAMPLE: usize = 40;

/// What reading some documents is expected to take.
#[derive(Clone, Debug, PartialEq)]
pub struct Estimate {
    pub documents: usize,
    pub characters: usize,
    /// Characters over four: the usual rule of thumb, not a tokenizer.
    pub input_tokens: usize,
    pub seconds: u64,
    /// Wall-clock seconds per document at [`PARALLEL_READS`].
    pub seconds_per_document: f64,
    /// True when the pace was measured on the project's earlier builds,
    /// false when it is [`DEFAULT_SECONDS_PER_DOCUMENT`].
    pub measured: bool,
}

/// The estimate of reading `texts`, at the measured wall-clock `pace` per
/// document when there is one.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
pub fn estimate(texts: &[&str], pace: Option<f64>) -> Estimate {
    let documents = texts.len();
    let characters: usize = texts.iter().map(|t| t.chars().count()).sum();
    let (seconds, seconds_per_document, measured) = match pace {
        Some(pace) => (pace * documents as f64, pace, true),
        None => {
            // Documents go in waves of PARALLEL_READS, each as long as one read.
            let waves = documents.div_ceil(PARALLEL_READS);
            let seconds = waves as f64 * DEFAULT_SECONDS_PER_DOCUMENT;
            let per = if documents == 0 {
                DEFAULT_SECONDS_PER_DOCUMENT / PARALLEL_READS as f64
            } else {
                seconds / documents as f64
            };
            (seconds, per, false)
        }
    };
    Estimate {
        documents,
        characters,
        input_tokens: characters.div_ceil(4),
        seconds: seconds.max(0.0).ceil() as u64,
        seconds_per_document,
        measured,
    }
}

/// The wall-clock seconds per document of the project's recent builds, from
/// when each extraction was kept: the median gap between consecutive ones
/// kept close enough to be of one build. `None` with fewer than three such
/// gaps.
pub fn pace_from(kept_at: &[OffsetDateTime]) -> Option<f64> {
    let mut times: Vec<OffsetDateTime> = kept_at.to_vec();
    times.sort_unstable();
    let recent = &times[times.len().saturating_sub(PACE_SAMPLE)..];
    let mut gaps: Vec<f64> = recent
        .windows(2)
        .map(|w| (w[1] - w[0]).as_seconds_f64())
        .filter(|g| *g > 0.0 && *g < SAME_BUILD_GAP_SECONDS)
        .collect();
    if gaps.len() < 3 {
        return None;
    }
    gaps.sort_by(f64::total_cmp);
    Some(gaps[gaps.len() / 2])
}

static BUILDS: LazyLock<Mutex<HashMap<Uuid, BuildState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The project's build as this process knows it; the default when it never
/// ran one here.
pub fn state(project_id: Uuid) -> BuildState {
    BUILDS
        .lock()
        .map(|b| b.get(&project_id).cloned().unwrap_or_default())
        .unwrap_or_default()
}

/// Mark a build started; `false` when one is already running for the
/// project, which is then left alone.
pub fn begin(project_id: Uuid, documents: usize) -> bool {
    let Ok(mut builds) = BUILDS.lock() else {
        return false;
    };
    if builds.get(&project_id).is_some_and(|b| b.running) {
        return false;
    }
    builds.insert(
        project_id,
        BuildState {
            running: true,
            documents,
            started_at: Some(OffsetDateTime::now_utc()),
            ..BuildState::default()
        },
    );
    true
}

pub fn update(project_id: Uuid, change: impl FnOnce(&mut BuildState)) {
    if let Ok(mut builds) = BUILDS.lock()
        && let Some(state) = builds.get_mut(&project_id)
    {
        change(state);
    }
}

pub fn finish(project_id: Uuid, error: Option<String>) {
    update(project_id, |s| {
        s.running = false;
        s.current = None;
        s.error = error;
        s.finished_at = Some(OffsetDateTime::now_utc());
    });
}

/// What reading one document gave.
pub struct Read {
    pub extraction: Extraction,
    /// Why a piece could not be read, when one could not.
    pub error: Option<String>,
    pub provider: String,
    pub model: String,
}

/// Why a build cannot go on at all.
pub struct Stop(pub String);

/// Read `documents`, up to [`PARALLEL_READS`] at once, handing each read to
/// `keep` and counting it done once kept. The first [`Stop`] ends the build:
/// reads still in flight are dropped, and what was kept stays kept.
pub async fn read_all<K, F>(
    project_id: Uuid,
    models: &dyn ModelProviders,
    ctx: &SecurityContext,
    documents: Vec<super::SourceText>,
    keep: K,
) -> Result<(), Stop>
where
    K: Fn(super::SourceText, Read) -> F,
    F: Future<Output = ()>,
{
    let keep = &keep;
    let mut reads = stream::iter(documents.into_iter().map(|doc| async move {
        update(project_id, |s| s.current = Some(doc.path.clone()));
        let read =
            read_document(models, ctx, &doc.path, doc.doc_type.as_deref(), &doc.text).await?;
        keep(doc, read).await;
        update(project_id, |s| s.done += 1);
        Ok::<(), Stop>(())
    }))
    .buffer_unordered(PARALLEL_READS);
    while let Some(read) = reads.next().await {
        read?;
    }
    Ok(())
}

/// Read one document piece by piece. A piece whose answer is unreadable is
/// asked once more and then given up, with the reason kept; the caller having
/// no key stops the build, since every other document would fail the same way.
pub async fn read_document(
    models: &dyn ModelProviders,
    ctx: &SecurityContext,
    path: &str,
    doc_type: Option<&str>,
    text: &str,
) -> Result<Read, Stop> {
    let pieces = extract::chunks(text);
    let total = pieces.len();
    let mut read = Read {
        extraction: Extraction::default(),
        error: None,
        provider: String::new(),
        model: String::new(),
    };
    for (i, piece) in pieces.iter().enumerate() {
        let request = extract::request(path, doc_type, piece, (i + 1, total));
        let mut last_error = None;
        for _attempt in 0..2 {
            match models.complete(ctx, &request).await {
                Ok(answer) => {
                    read.provider = answer.provider;
                    read.model = answer.model;
                    match extract::read_answer(path, piece, &answer.text) {
                        Ok(got) => {
                            read.extraction.facts.extend(got.facts);
                            read.extraction.dropped += got.dropped;
                            last_error = None;
                            break;
                        }
                        Err(e) => last_error = Some(e),
                    }
                }
                Err(CompletionError::NoKey(message)) => return Err(Stop(message)),
                Err(CompletionError::Failed(e)) => last_error = Some(format!("{e:#}")),
            }
        }
        if let Some(e) = last_error {
            read.error = Some(format!(
                "lines {}-{}: {e}",
                piece.first_line,
                piece.last_line()
            ));
        }
    }
    Ok(read)
}

/// Ask the judge about one candidate: `Ok(Ok(Some))` a confirmed finding,
/// `Ok(Ok(None))` not a conflict, `Ok(Err)` an answer that could not be read
/// twice (asked again on the next build), `Err(Stop)` no key.
pub async fn judge_candidate(
    models: &dyn ModelProviders,
    ctx: &SecurityContext,
    candidate: &super::rules::Candidate,
    texts: &std::collections::BTreeMap<String, String>,
) -> Result<Result<Option<super::finding::Finding>, String>, Stop> {
    let text_of = |p: &str| texts.get(p).map(String::as_str);
    let request = super::judge::request(candidate, text_of);
    let mut last_error = String::new();
    for _attempt in 0..2 {
        match models.complete(ctx, &request).await {
            Ok(answer) => match super::judge::read_answer(candidate, &answer.text, text_of) {
                Ok(found) => return Ok(Ok(found)),
                Err(e) => last_error = e,
            },
            Err(CompletionError::NoKey(message)) => return Err(Stop(message)),
            Err(CompletionError::Failed(e)) => last_error = format!("{e:#}"),
        }
    }
    Ok(Err(last_error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm_proxy::port::{Completion, CompletionRequest, ModelInfo};
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Scripted {
        answers: Vec<Result<&'static str, &'static str>>,
        calls: AtomicUsize,
    }

    #[async_trait]
    impl ModelProviders for Scripted {
        async fn list_models(
            &self,
            _: &str,
            _: Option<&str>,
            _: &str,
        ) -> anyhow::Result<Vec<ModelInfo>> {
            Ok(Vec::new())
        }

        async fn complete(
            &self,
            _: &SecurityContext,
            _: &CompletionRequest,
        ) -> Result<Completion, CompletionError> {
            let i = self.calls.fetch_add(1, Ordering::SeqCst);
            match self
                .answers
                .get(i)
                .copied()
                .unwrap_or(Err("no more answers"))
            {
                Ok(text) => Ok(Completion {
                    provider: "anthropic".into(),
                    model: "m".into(),
                    text: text.into(),
                }),
                Err("nokey") => Err(CompletionError::NoKey("add a key in your profile".into())),
                Err(e) => Err(CompletionError::Failed(anyhow::anyhow!(e))),
            }
        }
    }

    fn ctx() -> SecurityContext {
        SecurityContext::builder()
            .subject_id(Uuid::from_u128(0xca7))
            .subject_type("user")
            .subject_tenant_id(Uuid::from_u128(0x0e9))
            .build()
            .expect("security context")
    }

    const TEXT: &str = "# T\n\nThe gateway rejects every request without a tenant header.\n";
    const GOOD: &str = r#"{"facts":[{"kind":"constraint","subject":"gateway","text":"t","status":"active","line_start":3,"line_end":3,"quote":"rejects every request without a tenant header"}]}"#;

    #[tokio::test]
    async fn an_unreadable_answer_is_asked_again_once() {
        let models = Scripted {
            answers: vec![Ok("sorry"), Ok(GOOD)],
            calls: AtomicUsize::new(0),
        };
        let read = read_document(&models, &ctx(), "d.md", None, TEXT)
            .await
            .ok()
            .unwrap();
        assert_eq!(read.extraction.facts.len(), 1);
        assert!(read.error.is_none());
        assert_eq!(read.provider, "anthropic");
    }

    #[tokio::test]
    async fn a_piece_that_fails_twice_is_kept_as_an_error() {
        let models = Scripted {
            answers: vec![Err("503"), Err("503")],
            calls: AtomicUsize::new(0),
        };
        let read = read_document(&models, &ctx(), "d.md", None, TEXT)
            .await
            .ok()
            .unwrap();
        assert!(read.extraction.facts.is_empty());
        assert!(read.error.unwrap().contains("503"));
    }

    #[tokio::test]
    async fn no_key_stops_the_build() {
        let models = Scripted {
            answers: vec![Err("nokey")],
            calls: AtomicUsize::new(0),
        };
        let stop = read_document(&models, &ctx(), "d.md", None, TEXT)
            .await
            .err()
            .unwrap();
        assert!(stop.0.contains("key"));
    }

    /// Answers every call with GOOD after a short wait, counting how many
    /// calls are in flight at once.
    struct Slow {
        now: AtomicUsize,
        most: AtomicUsize,
    }

    #[async_trait]
    impl ModelProviders for Slow {
        async fn list_models(
            &self,
            _: &str,
            _: Option<&str>,
            _: &str,
        ) -> anyhow::Result<Vec<ModelInfo>> {
            Ok(Vec::new())
        }

        async fn complete(
            &self,
            _: &SecurityContext,
            _: &CompletionRequest,
        ) -> Result<Completion, CompletionError> {
            let now = self.now.fetch_add(1, Ordering::SeqCst) + 1;
            self.most.fetch_max(now, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            self.now.fetch_sub(1, Ordering::SeqCst);
            Ok(Completion {
                provider: "anthropic".into(),
                model: "m".into(),
                text: GOOD.into(),
            })
        }
    }

    fn doc(path: &str) -> crate::documents::spec_model::SourceText {
        crate::documents::spec_model::SourceText {
            path: path.into(),
            text: TEXT.into(),
            doc_type: None,
            node: String::new(),
            binding: None,
            at: None,
        }
    }

    #[tokio::test]
    async fn documents_are_read_a_few_at_once_and_each_counted_once() {
        let project = Uuid::new_v4();
        let models = Slow {
            now: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
        };
        let docs: Vec<_> = (0..10).map(|i| doc(&format!("d{i}.md"))).collect();
        assert!(begin(project, docs.len()));
        let kept = Mutex::new(Vec::new());
        let result = read_all(project, &models, &ctx(), docs, |d, r| {
            kept.lock()
                .unwrap()
                .push((d.path, r.extraction.facts.len()));
            async {}
        })
        .await;
        assert!(result.is_ok());
        assert_eq!(state(project).done, 10);
        let most = models.most.load(Ordering::SeqCst);
        assert!(most > 1 && most <= PARALLEL_READS, "{most} at once");
        let kept = kept.into_inner().unwrap();
        assert_eq!(kept.len(), 10);
        assert!(kept.iter().all(|(_, n)| *n == 1));
    }

    #[tokio::test]
    async fn no_key_stops_reading_all() {
        let project = Uuid::new_v4();
        let models = Scripted {
            answers: vec![Err("nokey")],
            calls: AtomicUsize::new(0),
        };
        assert!(begin(project, 1));
        let result = read_all(project, &models, &ctx(), vec![doc("a.md")], |_, _| async {}).await;
        assert!(result.is_err());
        assert_eq!(state(project).done, 0);
    }

    #[test]
    fn an_unmeasured_estimate_reads_in_waves() {
        let texts = ["abcd"; 9];
        let e = estimate(&texts, None);
        assert_eq!(e.documents, 9);
        assert_eq!(e.characters, 36);
        assert_eq!(e.input_tokens, 9);
        // 9 documents at 4 at once: three waves of one read each.
        assert_eq!(e.seconds, 120);
        assert!(!e.measured);
        let measured = estimate(&texts, Some(12.5));
        assert_eq!(measured.seconds, 113);
        assert!(measured.measured);
        assert_eq!(estimate(&[], None).seconds, 0);
    }

    #[test]
    fn the_pace_is_the_median_gap_within_a_build() {
        let t0 = OffsetDateTime::UNIX_EPOCH;
        let at = |s: i64| t0 + time::Duration::seconds(s);
        // One build 10 s apart, another a day later 20 s apart.
        let kept = [
            at(0),
            at(10),
            at(20),
            at(86_400),
            at(86_420),
            at(86_440),
            at(86_460),
        ];
        assert_eq!(pace_from(&kept), Some(20.0));
        assert_eq!(pace_from(&[at(0), at(10)]), None);
    }

    #[test]
    fn a_second_build_of_the_same_project_waits_for_the_first() {
        let project = Uuid::new_v4();
        assert!(begin(project, 3));
        assert!(!begin(project, 3));
        update(project, |s| s.done = 2);
        assert_eq!(state(project).done, 2);
        finish(project, None);
        assert!(!state(project).running);
        assert!(begin(project, 1));
    }
}
