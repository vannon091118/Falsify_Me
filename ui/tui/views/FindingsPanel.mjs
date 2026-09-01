// FalsifyMe TUI - Views: Findings-Zaehler
// Verantwortung: visuell kompakte Zaehler (● discovered / ! critical /
// ▲ warning) mit kurzem Puls bei neuen Findings. Stateless.
import React from "react";
import { Text } from "ink";

const h = React.createElement;

const severityColor = (sev) => (sev === "critical" ? "red" : sev === "warning" ? "yellow" : "cyan");

export default function FindingsPanel({ findings }) {
  const kids = [h(Text, null, "FINDINGS ")];
  findings.forEach((f, i) => {
    const num = String(f.n).padStart(2, "0");
    kids.push(
      h(Text, { key: f.severity, color: severityColor(f.severity), bold: !!f.pulse },
        `${f.icon} ${num}${i < findings.length - 1 ? "  " : ""}`),
    );
  });
  return h(Text, null, ...kids);
}