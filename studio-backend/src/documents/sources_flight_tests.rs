use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use super::FlightCache;

#[tokio::test]
async fn concurrent_reads_of_one_key_share_one_read() {
    let cache = Arc::new(FlightCache::<u32, String>::new(Duration::from_secs(10)));
    let reads = Arc::new(AtomicUsize::new(0));
    let calls = (0..8).map(|_| {
        let cache = Arc::clone(&cache);
        let reads = Arc::clone(&reads);
        async move {
            cache
                .get_or_read(1, || async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    // Long enough that every caller arrives while it runs.
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok::<_, String>("sources".to_owned())
                })
                .await
        }
    });
    for answer in futures_util::future::join_all(calls).await {
        assert_eq!(answer.unwrap().as_str(), "sources");
    }
    assert_eq!(reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn other_keys_read_on_their_own() {
    let cache = FlightCache::<u32, u32>::new(Duration::from_secs(10));
    let a = cache
        .get_or_read(1, || async { Ok::<_, ()>(1) })
        .await
        .unwrap();
    let b = cache
        .get_or_read(2, || async { Ok::<_, ()>(2) })
        .await
        .unwrap();
    assert_eq!((*a, *b), (1, 2));
}

#[tokio::test]
async fn an_error_is_not_kept() {
    let cache = FlightCache::<u32, u32>::new(Duration::from_secs(10));
    let failed = cache
        .get_or_read(1, || async { Err::<u32, _>("pool timeout") })
        .await;
    assert_eq!(failed.unwrap_err(), "pool timeout");
    let read = cache.get_or_read(1, || async { Ok::<_, &str>(7) }).await;
    assert_eq!(*read.unwrap(), 7);
}

#[tokio::test]
async fn an_old_answer_is_read_again() {
    let cache = FlightCache::<u32, u32>::new(Duration::from_millis(20));
    cache
        .get_or_read(1, || async { Ok::<_, ()>(1) })
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(40)).await;
    let again = cache
        .get_or_read(1, || async { Ok::<_, ()>(2) })
        .await
        .unwrap();
    assert_eq!(*again, 2);
}

#[tokio::test]
async fn a_young_answer_is_kept() {
    let cache = FlightCache::<u32, u32>::new(Duration::from_secs(10));
    cache
        .get_or_read(1, || async { Ok::<_, ()>(1) })
        .await
        .unwrap();
    let kept = cache
        .get_or_read(1, || async { Ok::<_, ()>(2) })
        .await
        .unwrap();
    assert_eq!(*kept, 1);
}

#[tokio::test]
async fn a_forgotten_key_is_read_again_and_others_stay() {
    let cache = FlightCache::<(u32, u32), u32>::new(Duration::from_secs(10));
    cache
        .get_or_read((1, 1), || async { Ok::<_, ()>(1) })
        .await
        .unwrap();
    cache
        .get_or_read((2, 1), || async { Ok::<_, ()>(1) })
        .await
        .unwrap();
    cache.forget(|(workspace, _)| *workspace == 1);
    let forgotten = cache
        .get_or_read((1, 1), || async { Ok::<_, ()>(2) })
        .await
        .unwrap();
    let other = cache
        .get_or_read((2, 1), || async { Ok::<_, ()>(2) })
        .await
        .unwrap();
    assert_eq!((*forgotten, *other), (2, 1));
}
