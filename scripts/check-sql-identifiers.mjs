#!/usr/bin/env node
// FalsifyMe - CI guard for interpolated SQL identifiers.
//
// SQL values must use SQLite bind parameters. Identifiers cannot be bound, so
// the only accepted interpolation is one protected by an explicit allowlist
// guard (assertIdentifier/assertSqlIdentifier with an ALLOWED_* Set).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const GUARD_NAMES = new Set(["assertIdentifier", "assertSqlIdentifier"]);

function skipQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipComment(source, start) {
  if (source.startsWith("//", start)) {
    const end = source.indexOf("\n", start + 2);
    return end < 0 ? source.length : end;
  }
  const end = source.indexOf("*/", start + 2);
  return end < 0 ? source.length : end + 2;
}

function skipTemplate(source, start) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") return i + 1;
    if (source.startsWith("${", i)) {
      const expressionEnd = scanExpression(source, i + 2);
      i = expressionEnd < source.length ? expressionEnd + 1 : source.length;
      continue;
    }
    i++;
  }
  return source.length;
}

function scanExpression(source, start) {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(source, i, ch);
      continue;
    }
    if (ch === "`") {
      i = skipTemplate(source, i);
      continue;
    }
    if (source.startsWith("//", i) || source.startsWith("/*", i)) {
      i = skipComment(source, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
    i++;
  }
  return source.length;
}

/** Extract template literals without treating comments or ordinary strings as code. */
function extractTemplates(source) {
  const templates = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(source, i, ch);
      continue;
    }
    if (source.startsWith("//", i) || source.startsWith("/*", i)) {
      i = skipComment(source, i);
      continue;
    }
    if (ch !== "`") {
      i++;
      continue;
    }

    const start = i;
    const interpolations = [];
    let sqlBefore = "";
    let literalStart = i + 1;
    let expressionNumber = 0;
    i++;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === "`") {
        sqlBefore += source.slice(literalStart, i);
        i++;
        break;
      }
      if (source.startsWith("${", i)) {
        sqlBefore += source.slice(literalStart, i);
        const expressionEnd = scanExpression(source, i + 2);
        const expr = source.slice(i + 2, expressionEnd).trim();
        const marker = `__FM_SQL_EXPR_${expressionNumber++}__`;
        interpolations.push({ expr, start: i, end: expressionEnd + 1, before: sqlBefore });
        sqlBefore += marker;
        i = expressionEnd < source.length ? expressionEnd + 1 : source.length;
        literalStart = i;
        continue;
      }
      i++;
    }
    templates.push({ start, end: i, sql: sqlBefore, interpolations });
  }
  return templates;
}

/** Replace non-code regions while preserving offsets for static scope matching. */
function maskNonCode(source) {
  const chars = source.split("");
  const blank = (start, end) => {
    for (let i = start; i < end; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(source, i, ch);
      blank(i, end);
      i = end;
      continue;
    }
    if (source.startsWith("//", i) || source.startsWith("/*", i)) {
      const end = skipComment(source, i);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = skipTemplate(source, i);
      blank(i, end);
      i = end;
      continue;
    }
    i++;
  }
  return chars.join("");
}

function functionRanges(source) {
  const masked = maskNonCode(source);
  const pairs = new Map();
  const stack = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "{") stack.push(i);
    else if (masked[i] === "}") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, i);
    }
  }

  const ranges = [];
  const addMatches = (pattern) => {
    for (const match of masked.matchAll(pattern)) {
      const open = match.index + match[0].lastIndexOf("{");
      const close = pairs.get(open);
      if (close !== undefined) ranges.push({ start: open, end: close + 1 });
    }
  };
  addMatches(/\bfunction(?:\s*\*)?\s*[\w$]*\s*\([^)]*\)\s*\{/g);
  addMatches(/(?:\([^)]*\)|[\w$]+)\s*=>\s*\{/g);
  return ranges;
}

function containingScope(ranges, position, sourceLength) {
  const candidates = ranges.filter((range) => range.start < position && position < range.end);
  if (!candidates.length) return { start: 0, end: sourceLength };
  return candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
}

function hasAllowlistDeclaration(source) {
  return /\b(?:const|let|var)\s+(?:[A-Za-z_$]*ALLOWED[\w$]*|[A-Za-z_$]*ALLOWLIST[\w$]*)\s*=\s*new\s+Set\s*\(/.test(source);
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function callArgumentsContaining(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(start + 1, i);
  }
  return "";
}

function guardedCall(source, scopeStart, position, expression) {
  const prior = source.slice(scopeStart, position);
  const callPattern = /\b(assertIdentifier|assertSqlIdentifier)\s*\(/g;
  for (const match of prior.matchAll(callPattern)) {
    if (!GUARD_NAMES.has(match[1])) continue;
    const openParen = match.index + match[0].length - 1;
    const args = callArgumentsContaining(prior, openParen);
    const expressionPattern = new RegExp(`(?:^|[^\\w$])${escaped(expression)}(?:$|[^\\w$])`);
    if (expressionPattern.test(args) && /\b(?:ALLOWED|ALLOWLIST)\w*\b/i.test(args)) return true;
  }
  return false;
}

function isSqlTemplate(sql) {
  return /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH)\b/i.test(sql);
}

function isIdentifierPosition(sqlBefore) {
  const normalized = sqlBefore.replace(/\s+/g, " ").trimEnd();
  return [
    /\b(?:SELECT|FROM|JOIN|UPDATE|INTO|TABLE|GROUP\s+BY|ORDER\s+BY|HAVING)\s*$/i,
    /\bPRAGMA\s+[A-Za-z_][\w$]*\s*\(\s*$/i,
    /\b(?:CREATE|DROP)\s+(?:TABLE|INDEX)\s*$/i,
    /\bINDEX\s+\S+\s+ON\s*$/i,
  ].some((pattern) => pattern.test(normalized));
}

function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

/** Return all unguarded interpolated SQL identifier diagnostics in one source file. */
export function scanSource(source, file = "<source>") {
  const violations = [];
  const ranges = functionRanges(source);
  const hasAllowlist = hasAllowlistDeclaration(source);
  for (const template of extractTemplates(source)) {
    if (!template.interpolations.length || !isSqlTemplate(template.sql)) continue;
    const scope = containingScope(ranges, template.start, source.length);
    for (const interpolation of template.interpolations) {
      if (!isIdentifierPosition(interpolation.before)) continue;
      const directGuard = /^\s*(assertIdentifier|assertSqlIdentifier)\s*\(/.test(interpolation.expr);
      const protectedByGuard = hasAllowlist && (directGuard || guardedCall(source, scope.start, interpolation.start, interpolation.expr));
      if (!protectedByGuard) {
        violations.push({
          file,
          line: lineOf(source, interpolation.start),
          expression: interpolation.expr,
          message: `${file}:${lineOf(source, interpolation.start)}: interpolated SQL identifier "${interpolation.expr}" is not protected by an allowlisted guard`,
        });
      }
    }
  }
  return violations;
}

function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(path.join(dir, entry.name));
    }
  };
  walk(root);
  return files.sort();
}

export function scanRepo(root = ROOT) {
  const violations = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    violations.push(...scanSource(fs.readFileSync(file, "utf8"), relative));
  }
  return violations;
}

export function main(root = ROOT) {
  const violations = scanRepo(root);
  if (violations.length) {
    console.error("SQL identifier guard failed:");
    for (const violation of violations) console.error(`  ${violation.message}`);
    console.error("Use a bind parameter for values, or guard an identifier with assertIdentifier/assertSqlIdentifier and an ALLOWED_* Set.");
    return 1;
  }
  console.log("SQL identifier guard: PASS");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
