// FalsifyMe TUI - Metriken/Statistik
// Verantwortung: Zaehler (Lines/Events/Frames), Sekunden-Buckets, Sparkline,
// Spitzen-RSS. Pure (Date.now/performance sind die einzigen Zeitquellen).
import { createRing } from "./ring.mjs";

const SPARK_CHARS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇"];

export const sparkline = (values) => {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return SPARK_CHARS[0].repeat(values.length);
  return values.map((v) => (v <= 0 ? SPARK_CHARS[0] : SPARK_CHARS[1 + Math.min(6, Math.floor((v / max) * 6))])).join("");
};

export const createMetrics = ({ bucketMs = 1000, buckets = 20 } = {}) => {
  const now = () => performance.now ? performance.now() : Date.now();
  const m = {
    startedAt: now(),
    lines: 0,
    chars: 0,
    events: 0,
    findings: 0,
    frames: 0,
    lastFrameMs: 0,
    maxFrameMs: 0,
    rssPeak: 0,
  };
  const lineBuckets = createRing(buckets);
  let bucketStart = now();
  let bucketCount = 0;

  const flushBucket = (t) => {
    lineBuckets.push(bucketCount);
    bucketCount = 0;
    bucketStart = t;
  };

  const noteRss = () => {
    try {
      const rss = process.memoryUsage().rss;
      if (rss > m.rssPeak) m.rssPeak = rss;
    } catch { /* egal */ }
  };

  m.noteLine = () => {
    m.lines += 1;
    const t = now();
    bucketCount += 1;
    if (t - bucketStart >= bucketMs) flushBucket(t);
  };
  m.noteEvent = () => {
    m.events += 1;
  };
  m.noteFinding = () => {
    m.findings += 1;
  };
  m.noteFrame = (ms) => {
    m.frames += 1;
    m.lastFrameMs = ms;
    if (ms > m.maxFrameMs) m.maxFrameMs = ms;
    if ((m.frames & 31) === 0) noteRss(); // sporadisch messen (kein Overhead)
  };
  m.sparkline = () => {
    const t = now();
    // Angefangenen Bucket bei Vorliegen oder bei leerer Historie flushen
    // (sonst waere ein synchroner Burst unsichtbar).
    if (t - bucketStart >= bucketMs || lineBuckets.length === 0) flushBucket(t);
    return sparkline(lineBuckets.toArray());
  };
  m.linesPerSec = () => Math.round(m.lines / Math.max(1, (now() - m.startedAt) / 1000));
  m.reset = () => {
    m.lines = 0; m.chars = 0; m.events = 0; m.findings = 0; m.frames = 0;
    m.lastFrameMs = 0; m.maxFrameMs = 0; m.rssPeak = 0;
  };
  return m;
};