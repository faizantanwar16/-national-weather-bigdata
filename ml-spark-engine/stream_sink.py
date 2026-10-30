"""
Hand-off between the live collectors and Spark.

Collectors call sink.write(row). Every few seconds the buffered rows are written as one
small JSON-lines file into stream_in/, which the Spark job watches. Files are written under
a hidden temporary name and then renamed, so Spark never reads a half-written file.
"""
import json
import os
import threading
import time
from pathlib import Path


class JsonlSink:
    def __init__(self, folder="stream_in", prefix="posts", flush_seconds=5, flush_records=100):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.prefix = prefix
        self.flush_records = flush_records
        self._buffer = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.written = 0
        # background timer so a quiet stream still gets flushed
        self._thread = threading.Thread(target=self._loop, args=(flush_seconds,), daemon=True)
        self._thread.start()

    def write(self, record):
        with self._lock:
            self._buffer.append(record)
            full = len(self._buffer) >= self.flush_records
        if full:
            self.flush()

    def flush(self):
        with self._lock:
            batch, self._buffer = self._buffer, []
        if not batch:
            return None
        name = f"{self.prefix}-{time.time_ns()}-{os.getpid()}.json"
        tmp = self.folder / f".{name}.tmp"       # leading dot: Spark ignores hidden files
        final = self.folder / name
        with open(tmp, "w", encoding="utf-8") as f:
            for rec in batch:
                f.write(json.dumps(rec, default=str, ensure_ascii=False) + "\n")
        os.replace(tmp, final)
        self.written += len(batch)
        return final

    def _loop(self, seconds):
        while not self._stop.wait(seconds):
            self.flush()

    def close(self):
        self._stop.set()
        self.flush()
