"""Exercise the shipped migration and SQL against SQLite, including concurrent quotas."""

import concurrent.futures
import datetime
import json
import pathlib
import re
import sqlite3
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "src/lib/playback-quality.server.ts").read_text()
MIGRATION = (ROOT / "migrations/2026-10-26_playback_quality.sql").read_text()
NOW = int(datetime.datetime(2026, 10, 26, tzinfo=datetime.timezone.utc).timestamp() * 1000)
DAY = "2026-10-26"


def sql(name):
    return re.search(r"export const " + name + r" = `([\s\S]*?)`;", SOURCE).group(1)


UPSERT = sql("PLAYBACK_QUALITY_UPSERT_SQL")
BIND = re.search(r"\.prepare\(PLAYBACK_QUALITY_UPSERT_SQL\)\s*\.bind\(([\s\S]*?)\)\s*\.first", SOURCE).group(1)


def record(**updates):
    value = dict(
        sessionId="watch-1", roundId=1, rootRoundId=1, rowKind="round", attemptId=0,
        seq=1, status="pending", outcome=None, contentKey=None, episodeIndex=0,
        sourceKey=None, platform="desktop-hlsjs", runtime="hlsjs", entryKind="direct",
        roundReason="initial", sourceReason=None, releaseId="release-1",
        policyVersion="startup-baseline-v1", elapsedMs=0, activeWaitMs=0,
        clickToFrameMs=None, pageToFrameMs=None, sourceToFrameMs=None,
        frameEvidence=None, hadHidden=False, autoplayBlocked=False,
        promptChoice=None, nextRoundId=None,
    )
    value.update(updates)
    return value


def bindings(value, owner="alice", now=NOW, day=DAY):
    result = []
    for token in BIND.split(","):
        token = token.strip()
        if not token:
            continue
        if token.startswith("record."):
            result.append(value[token[7:]])
        elif token.startswith("Number(record."):
            result.append(int(value[token[14:-1]]))
        else:
            result.append(dict(owner=owner, dayKey=day, now=now, DAILY_ROW_LIMIT=2000)[token])
    return result


def database(path=":memory:"):
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.executescript(MIGRATION)
    db.executescript(MIGRATION)
    return db


def upsert(db, value, **kwargs):
    row = db.execute(UPSERT, bindings(value, **kwargs)).fetchone()
    db.commit()
    return row


def success(**kwargs):
    return record(seq=3, status="terminal", outcome="frame-ready", elapsedMs=1000,
                  activeWaitMs=1000, pageToFrameMs=1000, frameEvidence="rvfc", **kwargs)


def test_idempotency_and_identity():
    db = database()
    assert upsert(db, record())
    assert upsert(db, success(contentKey="movie::2026", episodeIndex=4, sourceKey="source-4"))
    assert upsert(db, record(seq=2, elapsedMs=500)) is None
    assert upsert(db, success()) is None
    assert upsert(db, record(seq=4, status="terminal", outcome="network-error", elapsedMs=2000)) is None
    row = db.execute("SELECT * FROM playback_quality").fetchone()
    assert row["outcome"] == "frame-ready" and row["page_to_frame_ms"] == 1000
    assert row["episode_index"] == 4 and row["source_key"] == "source-4"
    assert upsert(db, record(seq=5, releaseId="other")) is None
    assert upsert(db, record(), owner="bob")
    assert db.execute("SELECT COUNT(*) FROM playback_quality").fetchone()[0] == 2
    db.close()


def test_budget_choice_and_day():
    db = database()
    budget = record(status="terminal", outcome="budget-exhausted", elapsedMs=30000, activeWaitMs=30000)
    assert upsert(db, budget)
    assert upsert(db, {**budget, "seq": 2, "promptChoice": "continue", "nextRoundId": 2}, day="2026-10-27", now=NOW + 86400000)
    assert upsert(db, {**budget, "seq": 3, "promptChoice": "leave"}) is None
    row = db.execute("SELECT day_key, received_at, outcome, prompt_choice FROM playback_quality").fetchone()
    assert tuple(row) == (DAY, NOW, "budget-exhausted", "continue")
    db.close()


def test_terminal_choice_and_link_protection():
    db = database()
    budget = record(status="terminal", outcome="budget-exhausted", elapsedMs=30000, activeWaitMs=30000)
    assert upsert(db, budget)
    chosen = {**budget, "seq": 2, "promptChoice": "manual"}
    assert upsert(db, chosen)
    assert upsert(db, {**chosen, "seq": 3, "elapsedMs": 80000}) is None
    assert upsert(db, {**chosen, "seq": 3, "promptChoice": "leave"}) is None
    linked = {**chosen, "seq": 3, "nextRoundId": 2}
    assert upsert(db, linked)
    for revision in [
        {**linked, "seq": 4, "nextRoundId": 3},
        {**linked, "seq": 4, "nextRoundId": None},
        {**linked, "seq": 4, "promptChoice": None},
        {**linked, "seq": 4, "outcome": "frame-ready", "frameEvidence": "rvfc"},
        {**linked, "seq": 4, "activeWaitMs": 30001},
        {**linked, "seq": 4, "pageToFrameMs": 80000},
        chosen,
        linked,
    ]:
        assert upsert(db, revision) is None
    row = db.execute("SELECT seq,outcome,prompt_choice,next_round_id,elapsed_ms,active_wait_ms FROM playback_quality").fetchone()
    assert tuple(row) == (3, "budget-exhausted", "manual", 2, 30000, 30000)
    leave = {**budget, "sessionId": "left"}
    assert upsert(db, leave)
    assert upsert(db, {**leave, "seq": 2, "promptChoice": "leave", "nextRoundId": 2}) is None
    assert upsert(db, {**leave, "seq": 2, "promptChoice": "leave"})
    assert upsert(db, {**leave, "seq": 3, "promptChoice": "leave", "nextRoundId": 2}) is None
    db.close()


def test_summary():
    db = database()
    for index in range(1, 21):
        assert upsert(db, success(sessionId=f"sample-{index}"))
        db.execute("UPDATE playback_quality SET elapsed_ms=?, active_wait_ms=?, page_to_frame_ms=? WHERE session_id=?", (index * 1000, index * 1000, index * 1000, f"sample-{index}"))
        assert upsert(db, record(sessionId=f"sample-{index}", rowKind="source", attemptId=1, sourceKey="line-1", sourceReason="initial"))
    assert upsert(db, record(sessionId="abandoned", status="terminal", outcome="abandoned"))
    assert upsert(db, record(sessionId="waiting"))
    assert upsert(db, record(sessionId="missing"), now=NOW - 86400001)
    budget = record(sessionId="continued", status="terminal", outcome="budget-exhausted", elapsedMs=30000, activeWaitMs=30000)
    assert upsert(db, budget)
    assert upsert(db, success(sessionId="continued", roundId=2, roundReason="continue", hadHidden=True))
    rows = db.execute(sql("PLAYBACK_QUALITY_COUNTS_SQL"), (DAY, NOW - 86400000, NOW - 86400000)).fetchall()
    assert len(rows) == 1
    row = rows[0]
    assert (row["starts"], row["within30"], row["pending"], row["unobserved"], row["successfulChains"]) == (24, 20, 1, 1, 21)
    assert row["completedChains"] == 22
    latency = db.execute(sql("PLAYBACK_QUALITY_LATENCY_SQL"), (DAY,)).fetchall()
    page = next(row for row in latency if row["metric"] == "pageToFrameMs")
    assert (page["samples"], page["p50"], page["p95"]) == (20, 10000, 19000)
    sources = db.execute(sql("PLAYBACK_QUALITY_SOURCES_SQL"), (DAY,)).fetchall()
    assert sources[0]["attempts"] == 20
    db.close()
    empty = database()
    assert empty.execute(sql("PLAYBACK_QUALITY_LATENCY_SQL"), (DAY,)).fetchall() == []
    upsert(empty, success())
    one = next(row for row in empty.execute(sql("PLAYBACK_QUALITY_LATENCY_SQL"), (DAY,)) if row["metric"] == "pageToFrameMs")
    assert (one["samples"], one["p50"], one["p95"]) == (1, 1000, 1000)
    empty.close()


def test_concurrent_quota():
    with tempfile.TemporaryDirectory() as directory:
        path = str(pathlib.Path(directory) / "quota.sqlite")
        db = database(path)
        base = record()
        for index in range(1999):
            db.execute(UPSERT, bindings({**base, "sessionId": f"seed-{index}"})).fetchone()
        db.commit()
        def insert(index):
            connection = sqlite3.connect(path, timeout=5)
            try:
                return bool(upsert(connection, {**base, "sessionId": f"racer-{index}"}))
            finally:
                connection.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            inserted = list(executor.map(insert, range(2)))
        assert sum(inserted) == 1, inserted
        assert db.execute("SELECT COUNT(*) FROM playback_quality").fetchone()[0] == 2000
        assert upsert(db, {**base, "sessionId": "seed-1", "seq": 2, "elapsedMs": 100})
        assert upsert(db, {**base, "sessionId": "beyond"}) is None
        db.close()


def replay_client_records():
    db = database()
    for value in json.load(sys.stdin):
        upsert(db, value)
    rows = [dict(row) for row in db.execute("SELECT * FROM playback_quality")]
    groups = [dict(row) for row in db.execute(sql("PLAYBACK_QUALITY_COUNTS_SQL"), (DAY, NOW - 86400000, NOW - 86400000))]
    print(json.dumps(dict(rows=rows, groups=groups)))
    db.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--replay-stdin"]:
        replay_client_records()
        sys.exit(0)
    for test in [test_idempotency_and_identity, test_budget_choice_and_day, test_terminal_choice_and_link_protection, test_summary, test_concurrent_quota]:
        test()
        print(f"PASS {test.__name__}")
