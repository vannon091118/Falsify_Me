// FalsifyMe TUI - Views: AAA Dashboard composition
// Verantwortung: sichtbare AAA-Komposition aus dem bestehenden Snapshot.
// Keine Produktlogik, keine eigene Historie, keine Demo-Daten.
import React from "react";
import { Box, Text } from "ink";
import TuiBox from "./TuiBox.mjs";
import { truncate } from "../wcwidth.mjs";
import { formatMemoryMB } from "../metrics.mjs";
import { COLORS, animatedGradient, activeGradient, activeGlyph, PROCESS } from "../visuals.mjs";

const h = React.createElement;
const value = (v) => (v === undefined || v === null || v === "" ? "-" : String(v));
const LIVE_STATES = new Set(["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS", "VERIFYING"]);
const THINK_STATES = new Set(["STARTING", "LOADING", "CLAIMING", "THINKING", "TOOL_ACTIVITY", "FINDINGS"]);
const TWIN_STATES = new Set(["VERIFYING"]);

const modelLabel = (model) => {
  if (!model?.who) return "SYSTEM";
  if (model.who === "twin") return `EVIL TWIN · ${value(model.twin)}`;
  return `THINKER · ${value(model.thinker)}`;
};

const sweep = (now, width) => {
  const safe = Math.max(8, width);
  const pos = Math.floor(Number(now || 0) / 120) % safe;
  return "░".repeat(pos) + "█" + "░".repeat(Math.max(0, safe - pos - 1));
};

const findingPulse = (findings) => findings.some((f) => f?.pulse);
const criticalPulse = (findings) => findings.some((f) => f?.severity === "critical" && f?.pulse);

const gradientLine = (cols, active, danger = false, now = 0) => {
  const width = Math.max(18, Math.min(64, cols - 4));
  const gradient = active
    ? activeGradient(now, width, PROCESS.warm, PROCESS.active)
    : danger
      ? animatedGradient(now, width, COLORS.error, COLORS.errorAlt, 150)
      : Array(width).fill(PROCESS.inactive);
  return h(Box, { key: "gradient", width: cols }, ...gradient.map((color, i) => h(Text, { key: `${color}-${i}`, color, dimColor: !active && !danger }, "━")));
};

const outputLines = (snap, cols, rows, mode = "thinker") => {
  const out = Array.isArray(snap.output) ? snap.output : [];
  const max = Math.max(1, rows - 5);
  if (!out.length) {
    const activity = snap.activity?.label ?? [snap.activity?.tool, snap.activity?.file].filter(Boolean).join(" ");
    if (activity) return [h(Text, { key: "activity", color: mode === "twin" ? COLORS.errorAlt : COLORS.info, bold: true }, `  > ${truncate(activity, Math.max(8, cols - 8), "…")}`)];
    if (LIVE_STATES.has(snap.state)) {
      const danger = snap.state === "VERIFYING" || mode === "twin";
      return [h(Text, { key: "sweep", color: danger ? COLORS.errorAlt : COLORS.mint, bold: true }, `  > ${sweep(snap.now, Math.max(12, Math.floor(cols / 4)))}`)];
    }
    return [h(Text, { key: "empty", color: COLORS.muted, dimColor: true }, "  > wartet auf echten Output …")];
  }
  return out.slice(-max).map((line, i, a) => h(
    Text,
    { key: `${i}-${a.length}`, color: i === a.length - 1 ? COLORS.bright : COLORS.muted },
    `  > ${truncate(String(line), Math.max(8, cols - 8), "…")}`,
  ));
};

function ThinkerPanel({ snap, cols, rows }) {
  const active = snap.model?.who === "thinker" && THINK_STATES.has(snap.state);
  const model = snap.model?.thinker;
  const color = active ? COLORS.secondary : COLORS.subtle;
  const body = [
    h(Box, { key: "state", width: Math.max(1, cols - 2) },
      h(Text, { color, bold: true }, `${active ? activeGlyph(snap.now) : "●"} ${active ? "THINKING" : "THINKER LOCUS"}`),
      h(Text, { color: COLORS.muted, dimColor: !active }, `  ${value(snap.stateLabel ?? snap.state)}`),
    ),
    h(Text, { key: "model", color: active ? COLORS.bright : COLORS.muted, bold: active }, ` MODEL  ${value(model)}`),
    h(Text, { key: "activity", color: active ? COLORS.mint : COLORS.muted, bold: !!snap.activity?.label }, ` ACTIVITY  ${value(snap.activity?.label ?? "-")}`),
    gradientLine(cols, active, false, snap.now),
    ...outputLines(snap, cols - 2, rows, "thinker"),
  ];
  return h(TuiBox, { title: active ? "THINKER LOCUS · ACTIVE" : "THINKER LOCUS", cols, rows, borderColor: color, titleColor: color }, ...body);
}

function TwinPanel({ snap, cols, rows }) {
  const attack = snap.state === "VERIFYING";
  const active = attack || snap.twinActive || snap.model?.who === "twin";
  const model = snap.model?.twin;
  const findings = Array.isArray(snap.findings) ? snap.findings : [];
  const findingText = findings.length ? findings.map((f) => `${f.icon ?? "?"} ${f.n ?? 0}`).join("  ") : "-";
  const color = attack || active ? COLORS.error : COLORS.subtle;
  const modelText = model ? value(model) : "WAITING FOR TWIN";
  const body = [
    h(Box, { key: "state", width: Math.max(1, cols - 2) },
      h(Text, { color, bold: true }, `${attack ? activeGlyph(snap.now) : "●"} ${attack ? "VERIFYING" : active ? "EVIL TWIN ACTIVE" : "WAITING FOR TWIN"}`),
      h(Text, { color: COLORS.muted, dimColor: !active }, "  EVIL TWIN LOCUS"),
    ),
    h(Text, { key: "model", color: attack ? COLORS.bright : COLORS.muted, bold: attack }, ` MODEL  ${modelText}`),
    h(Text, { key: "findings", color: criticalPulse(findings) ? COLORS.error : findingPulse(findings) ? COLORS.warning : COLORS.muted, bold: findingPulse(findings) }, ` FINDINGS  ${findingText}`),
    gradientLine(cols, attack || active, true, snap.now),
    ...(attack ? [h(Text, { key: "attackSweep", color: COLORS.errorAlt, bold: true }, `  ${activeGlyph(snap.now)} ATTACK ${sweep(snap.now, Math.max(8, Math.floor(cols / 4)))}`)] : []),
    ...outputLines(snap, cols - 2, rows, "twin"),
  ];
  return h(TuiBox, { title: attack ? "EVIL TWIN LOCUS · VERIFYING" : "EVIL TWIN LOCUS", cols, rows, borderColor: color, titleColor: color }, ...body);
}

export default function AAADashboardView({ snap, cols, rows }) {
  const safeRows = Math.max(6, rows);
  const gap = 1;
  const twin = TWIN_STATES.has(snap.state) || snap.twinActive || snap.model?.who === "twin";
  const half = Math.max(20, Math.floor((cols - gap) * (twin ? 0.57 : 0.70)));
  const twinWidth = Math.max(20, cols - half - gap);
  const model = modelLabel(snap.model);
  const activeSlots = (snap.slots ?? []).filter((s) => s.state !== "IDLE").length;
  const memory = snap.metrics?.rssPeak != null ? formatMemoryMB(snap.metrics.rssPeak) : "-";
  const findings = Array.isArray(snap.findings) ? snap.findings : [];
  const meta = h(TuiBox, { title: "RUN CONTEXT", cols, rows: 3, borderColor: twin ? COLORS.error : COLORS.subtle, titleColor: twin ? COLORS.error : COLORS.subtle },
    h(Box, { key: "meta", width: Math.max(1, cols - 2) },
      h(Box, { width: Math.max(18, Math.floor((cols - 2) / 2)), flexDirection: "column" },
        h(Text, { bold: true, color: COLORS.bright }, ` JOB ${value(snap.jobId)}  SCOPE ${value(snap.scopeId)}`),
        h(Text, { color: COLORS.muted, dimColor: true }, ` WHITELIST ${value(snap.files)} files`),
      ),
      h(Box, { width: Math.max(18, Math.ceil((cols - 2) / 2)), flexDirection: "column" },
        h(Text, { color: twin ? COLORS.error : COLORS.info, bold: true }, ` LOCUS ${model}`),
        h(Text, { color: COLORS.muted, dimColor: true }, ` WORKERS ${activeSlots}  MEMORY ${memory}`),
      ),
    ),
  );

  const probeActive = twin || (Array.isArray(snap.probes) && snap.probes.length > 0);
  const availableAfterContext = Math.max(1, safeRows - 3);
  const probeRows = probeActive ? Math.max(4, Math.min(7, Math.floor(availableAfterContext * 0.22))) : 0;
  const locusRows = Math.max(6, availableAfterContext - probeRows);

  return h(Box, { flexDirection: "column", width: cols, height: safeRows },
    meta,
    h(Box, { key: "loci", width: cols, height: locusRows },
      h(Box, { width: half, height: locusRows }, h(ThinkerPanel, { snap, cols: half, rows: locusRows })),
      h(Box, { width: twinWidth, height: locusRows, marginLeft: gap }, h(TwinPanel, { snap, cols: twinWidth, rows: locusRows })),
    ),
    probeRows > 0 ? h(Box, { key: "probes", width: cols, height: probeRows },
      h(TuiBox, { title: "VERIFICATION PROTOCOL (PROBES)", cols, rows: probeRows, borderColor: twin ? COLORS.error : COLORS.subtle, titleColor: twin ? COLORS.error : COLORS.subtle },
        ...(Array.isArray(snap.probes) && snap.probes.length
          ? snap.probes.slice(-(probeRows - 2)).map((p, i) => {
              const color = p.status === "WIDERSPRUCH" ? COLORS.error : p.status === "BESTAETIGT" ? COLORS.active : p.status === "UNKLAR" ? COLORS.warning : COLORS.info;
              const icon = p.status === "BESTAETIGT" ? "✓" : p.status === "WIDERSPRUCH" ? "✗" : p.status === "UNKLAR" ? "?" : "►";
              return h(Text, { key: `${p.id}-${i}`, color, bold: p.status === "WIDERSPRUCH" }, ` ${icon} ${String(p.id).padEnd(10, " ")} ${truncate(String(p.text ?? "-"), Math.max(8, cols - 38), "…")} [${String(p.status)}]`);
            })
          : [h(Text, { key: "none", color: COLORS.errorAlt, bold: true }, ` ${activeGlyph(snap.now)} VERIFYING ${sweep(snap.now, Math.max(8, Math.floor(cols / 4)))}`)]),
      ),
    ) : findings.length > 0 ? h(Box, { key: "findings", width: cols, height: 2 },
      h(Text, { color: criticalPulse(findings) ? COLORS.error : findingPulse(findings) ? COLORS.warning : COLORS.muted, bold: findingPulse(findings) },
        ` FINDINGS  ${findings.map((f) => `${f.icon ?? "?"} ${f.n ?? 0}`).join("   ")}`),
    ) : null,
  );
}
