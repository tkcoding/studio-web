//! One read of a project's sources shared by the requests that want it at
//! once, and kept for a few seconds after (#1041).
//!
//! The Project domain model screen opens with some eight concurrent reads
//! (the model, its work, requirements, glossary, build estimate, reviews…),
//! and each of them read the project's bindings, documents, uploads and
//! checkout from the start. After a backend start that was eight cold walks
//! of the same data racing for one small pool. Here the first caller reads;
//! the others wait for its answer and take it.
//!
//! The answer is kept for [`SOURCES_KEPT_FOR`]: long enough to cover one
//! screen's burst, short enough that a write this process does not see (a
//! checkout refreshed by another replica) shows almost at once. Writes this
//! process does see — a sync's bindings, an upload, a Studio document —
//! forget the workspace's entries straight away ([`FlightCache::forget`]).
//! An error is never kept: the next caller reads again.

use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// How long a project's sources answer other requests after one read them.
pub const SOURCES_KEPT_FOR: Duration = Duration::from_secs(10);

/// One slot: the read in flight holds its lock; the answer, once read.
type Slot<V> = Arc<tokio::sync::Mutex<Option<(Instant, Arc<V>)>>>;

/// Single-flight reads under a key, each answer kept for `ttl`.
pub struct FlightCache<K, V> {
    ttl: Duration,
    slots: Mutex<HashMap<K, Slot<V>>>,
}

impl<K: Eq + Hash + Clone, V> FlightCache<K, V> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            slots: Mutex::new(HashMap::new()),
        }
    }

    /// The answer kept under `key` while it is young enough; otherwise
    /// `read`'s, which concurrent callers of the same key wait for and share.
    /// A caller whose read fails gets its error and keeps nothing.
    pub async fn get_or_read<E, F, Fut>(&self, key: K, read: F) -> Result<Arc<V>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let slot = {
            let mut slots = self.slots.lock().unwrap_or_else(PoisonError::into_inner);
            let ttl = self.ttl;
            // Drop what nobody holds and nobody can use any more.
            slots.retain(|_, slot| Arc::strong_count(slot) > 1 || is_fresh(slot, ttl));
            Arc::clone(slots.entry(key).or_default())
        };
        let mut held = slot.lock().await;
        if let Some((at, value)) = &*held
            && at.elapsed() < self.ttl
        {
            return Ok(Arc::clone(value));
        }
        let value = Arc::new(read().await?);
        *held = Some((Instant::now(), Arc::clone(&value)));
        Ok(value)
    }

    /// Forget every entry whose key `stale` names. A read in flight under
    /// such a key finishes for its own callers, but nobody after asks it.
    pub fn forget(&self, stale: impl Fn(&K) -> bool) {
        self.slots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|key, _| !stale(key));
    }
}

/// Whether a slot holds an answer still young enough. A slot whose lock is
/// held is a read in flight, and counts as fresh.
fn is_fresh<V>(slot: &Slot<V>, ttl: Duration) -> bool {
    slot.try_lock()
        .map(|held| matches!(&*held, Some((at, _)) if at.elapsed() < ttl))
        .unwrap_or(true)
}

#[cfg(test)]
#[path = "sources_flight_tests.rs"]
mod tests;
