"""
Apache Spark Structured Streaming job.

  stream_bluesky.py / stream_mastodon.py  ->  stream_in/*.json  ->  THIS JOB  ->  MongoDB reports

Spark watches stream_in/ for new files, and every few seconds runs the new posts through the
ML pipeline (event classifier, geotagger, duplicate detector, credibility scorer) and stores
the result in the database. Progress is checkpointed, so after a restart Spark continues
where it stopped instead of reprocessing old files.

  python spark_stream.py          # keep running (near-real-time)
  python spark_stream.py --once   # process what is already in stream_in/, then stop (first test)

Scaling note: the ML step runs inside foreachBatch on the Spark driver, which is simple and
reliable on one machine. To spread it over a cluster, move the classifier and geotagger into
mapInPandas, and keep duplicate/corroboration state in Redis or a database. To use Kafka
instead of files, replace spark.readStream.json(...) with
spark.readStream.format("kafka")... and parse the value column with from_json.
"""
import argparse
import os
from pathlib import Path

# Ensure compatible JDK (Java 23 supports -Djava.security.manager=allow for Hadoop/Spark)
_JDK23_PATH = Path(r"C:\Program Files\Java\jdk-23")
if _JDK23_PATH.exists() and "JAVA_HOME" not in os.environ:
    os.environ["JAVA_HOME"] = str(_JDK23_PATH)
    os.environ["PATH"] = str(_JDK23_PATH / "bin") + os.pathsep + os.environ.get("PATH", "")

os.environ.setdefault("SPARK_USER", "weather")
os.environ.setdefault("USER", "weather")
os.environ.setdefault("HADOOP_USER_NAME", "weather")

_JAVA_OPENS = (
    "-Djava.security.manager=allow"
    " --add-opens=java.base/javax.security.auth=ALL-UNNAMED"
    " --add-opens=java.base/sun.nio.ch=ALL-UNNAMED"
    " --add-opens=java.base/java.nio=ALL-UNNAMED"
)
os.environ["JDK_JAVA_OPTIONS"] = _JAVA_OPENS

from pyspark.sql import SparkSession
from pyspark.sql.types import DoubleType, LongType, StringType, StructField, StructType

import db
from enricher import Enricher

IN_DIR = Path("stream_in")
CHECKPOINT = Path("stream_state/spark_checkpoint")
TRIGGER_SECONDS = 10


def S(name):
    return StructField(name, StringType())


def L(name):
    return StructField(name, LongType())


SCHEMA = StructType([
    S("source"), S("author"), S("display_name"), S("text"), S("created_at"), S("language"),
    S("hashtags"), L("has_media"), S("media_types"), S("media_urls"),
    L("likes"), L("reposts"), L("replies"),
    S("account_created_at"), L("followers"), L("following"), L("account_posts"),
    StructField("lat", DoubleType()), StructField("lon", DoubleType()),
    S("matched_query"), S("uri"), S("url"), S("collected_at"),
])


def main(once):
    IN_DIR.mkdir(exist_ok=True)
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    db.init_db()
    enricher = Enricher()          # loads the models once; keeps duplicate/corroboration state

    spark = (SparkSession.builder.appName("IndiaWeatherStream").master("local[*]")
             .config("spark.sql.shuffle.partitions", "4")
             .config("spark.ui.showConsoleProgress", "false")
             .config("spark.driver.host", "127.0.0.1")
             .getOrCreate())
    spark.sparkContext.setLogLevel("WARN")

    raw = (spark.readStream.schema(SCHEMA)
           .option("maxFilesPerTrigger", 50)
           .json(IN_DIR.resolve().as_posix()))

    def handle_batch(batch_df, batch_id):
        pdf = batch_df.toPandas()
        if pdf.empty:
            return
        out = enricher.process(pdf)
        stored = db.insert_posts(out)
        events = out["category"].value_counts().to_dict() if len(out) else {}
        print(f"[batch {batch_id}] {len(pdf)} received, {len(out)} new, {stored} stored | {events}")

    writer = (raw.writeStream.foreachBatch(handle_batch)
              .option("checkpointLocation", CHECKPOINT.resolve().as_posix()))
    writer = writer.trigger(availableNow=True) if once else writer.trigger(processingTime=f"{TRIGGER_SECONDS} seconds")

    query = writer.start()
    print("Spark stream started. Watching", IN_DIR.resolve(), "(Ctrl+C to stop)")
    try:
        query.awaitTermination()
    except KeyboardInterrupt:
        print("\nStopping...")
        query.stop()
    spark.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Spark Structured Streaming job for India weather posts")
    parser.add_argument("--once", action="store_true",
                        help="process the files already in stream_in/ and exit")
    main(parser.parse_args().once)
