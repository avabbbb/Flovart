use flovart_lib::runtime::{BrowserImportBegin, BrowserImportStore};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
use uuid::Uuid;

const EXTENSION_ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";

fn test_root() -> PathBuf {
    std::env::temp_dir().join(format!("flovart-browser-import-test-{}", Uuid::now_v7()))
}

#[test]
fn paired_extension_streams_verified_bytes_into_a_content_addressed_artifact() {
    let root = test_root();
    let database_path = root.join("flovart-state.db");
    let artifact_root = root.join("runtime-artifacts");
    fs::create_dir_all(&root).expect("test root");
    let store = BrowserImportStore::open(&database_path, &artifact_root).expect("import store");

    let bytes = b"\x89PNG\r\n\x1a\nvalid-transfer-payload";
    let sha256 = hex::encode(Sha256::digest(bytes));
    let begin = BrowserImportBegin {
        request_id: "request-1".to_owned(),
        kind: "image".to_owned(),
        name: "reference.png".to_owned(),
        mime_type: "image/png".to_owned(),
        byte_size: bytes.len() as u64,
        sha256: sha256.clone(),
        source_url: Some("https://cdn.example.com/reference.png".to_owned()),
        source_page_url: Some("https://example.com/article".to_owned()),
        source_title: Some("Example article".to_owned()),
        natural_width: Some(1280),
        natural_height: Some(720),
    };

    let denied = store
        .begin_import(EXTENSION_ORIGIN, begin.clone())
        .expect_err("unpaired caller denied");
    assert_eq!(denied.code, "PAIRING_REQUIRED");

    let pending = store
        .request_pairing(EXTENSION_ORIGIN, "1", &["browser.import.image".to_owned()])
        .expect("pairing request");
    assert_eq!(pending.status, "pending");
    store
        .approve_pairing(EXTENSION_ORIGIN)
        .expect("approve exact extension origin");
    store
        .set_active_project(Some("workflow-active"))
        .expect("active destination");

    let transfer = store
        .begin_import(EXTENSION_ORIGIN, begin)
        .expect("begin transfer");
    assert_eq!(transfer.next_sequence, 0);

    let out_of_order = store
        .append_chunk(EXTENSION_ORIGIN, &transfer.transfer_id, 1, bytes)
        .expect_err("out-of-order chunk denied");
    assert_eq!(out_of_order.code, "CHUNK_SEQUENCE_MISMATCH");

    let ack = store
        .append_chunk(EXTENSION_ORIGIN, &transfer.transfer_id, 0, bytes)
        .expect("append bytes");
    assert_eq!(ack.received_bytes, bytes.len() as u64);
    assert_eq!(ack.next_sequence, 1);

    let receipt = store
        .commit_import(EXTENSION_ORIGIN, &transfer.transfer_id)
        .expect("commit verified artifact");
    assert_eq!(receipt.status, "pending");
    assert_eq!(receipt.artifact_id, format!("sha256:{sha256}"));
    assert_eq!(
        receipt.destination_project_id.as_deref(),
        Some("workflow-active")
    );
    assert_eq!(
        store.read_artifact(&receipt.import_id).expect("artifact"),
        bytes
    );
    assert_eq!(store.list_pending().expect("inbox").len(), 1);

    let consumed = store
        .mark_consumed(&receipt.import_id, "workflow-active", "browser-import-node")
        .expect("consumed receipt");
    assert_eq!(consumed.status, "consumed");
    assert_eq!(consumed.node_id.as_deref(), Some("browser-import-node"));
    assert!(store.list_pending().expect("empty inbox").is_empty());

    drop(store);
    fs::remove_dir_all(&root).expect("remove test root");
}

#[test]
fn commit_rejects_hash_mismatch_without_publishing_an_import() {
    let root = test_root();
    let database_path = root.join("flovart-state.db");
    let artifact_root = root.join("runtime-artifacts");
    fs::create_dir_all(&root).expect("test root");
    let store = BrowserImportStore::open(&database_path, &artifact_root).expect("import store");
    store
        .request_pairing(EXTENSION_ORIGIN, "1", &["browser.import.image".to_owned()])
        .expect("pairing request");
    store.approve_pairing(EXTENSION_ORIGIN).expect("approve");

    let bytes = b"actual bytes";
    let transfer = store
        .begin_import(
            EXTENSION_ORIGIN,
            BrowserImportBegin {
                request_id: "request-hash-mismatch".to_owned(),
                kind: "image".to_owned(),
                name: "mismatch.png".to_owned(),
                mime_type: "image/png".to_owned(),
                byte_size: bytes.len() as u64,
                sha256: "0".repeat(64),
                source_url: None,
                source_page_url: None,
                source_title: None,
                natural_width: None,
                natural_height: None,
            },
        )
        .expect("begin transfer");
    store
        .append_chunk(EXTENSION_ORIGIN, &transfer.transfer_id, 0, bytes)
        .expect("append bytes");

    let mismatch = store
        .commit_import(EXTENSION_ORIGIN, &transfer.transfer_id)
        .expect_err("hash mismatch");
    assert_eq!(mismatch.code, "CONTENT_HASH_MISMATCH");
    assert!(store.list_pending().expect("no import").is_empty());

    drop(store);
    fs::remove_dir_all(&root).expect("remove test root");
}

#[test]
fn commit_rejects_bytes_that_do_not_match_the_declared_image_mime() {
    let root = test_root();
    let database_path = root.join("flovart-state.db");
    let artifact_root = root.join("runtime-artifacts");
    fs::create_dir_all(&root).expect("test root");
    let store = BrowserImportStore::open(&database_path, &artifact_root).expect("import store");
    store
        .request_pairing(EXTENSION_ORIGIN, "1", &["browser.import.image".to_owned()])
        .expect("pairing request");
    store.approve_pairing(EXTENSION_ORIGIN).expect("approve");

    let bytes = b"plain text declared as a PNG";
    let transfer = store
        .begin_import(
            EXTENSION_ORIGIN,
            BrowserImportBegin {
                request_id: "request-mime-mismatch".to_owned(),
                kind: "image".to_owned(),
                name: "mismatch.png".to_owned(),
                mime_type: "image/png".to_owned(),
                byte_size: bytes.len() as u64,
                sha256: hex::encode(Sha256::digest(bytes)),
                source_url: None,
                source_page_url: None,
                source_title: None,
                natural_width: None,
                natural_height: None,
            },
        )
        .expect("begin transfer");
    store
        .append_chunk(EXTENSION_ORIGIN, &transfer.transfer_id, 0, bytes)
        .expect("append bytes");

    let mismatch = store
        .commit_import(EXTENSION_ORIGIN, &transfer.transfer_id)
        .expect_err("MIME mismatch");
    assert_eq!(mismatch.code, "MIME_MISMATCH");
    assert!(store.list_pending().expect("no import").is_empty());

    drop(store);
    fs::remove_dir_all(&root).expect("remove test root");
}
