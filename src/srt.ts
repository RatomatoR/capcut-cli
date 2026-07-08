// Zero-dep SRT parser + SRT/WebVTT renderers. Cues carry microsecond timings.
// Parser format:
//   1
//   00:00:01,000 --> 00:00:04,500
//   line 1
//   line 2
//
//   2
//   ...
// Accepts '.' or ',' as the ms separator. Index lines are optional.

import { srtTime, vttTime } from "./time.js";

export interface SrtCue {
  index: number;
  startUs: number;
  endUs: number;
  text: string;
}

const TS = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function tsToUs(h: string, m: string, s: string, ms: string): number {
  const msPadded = `${ms}000`.slice(0, 3);
  return ((parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)) * 1000 + parseInt(msPadded, 10)) * 1000;
}

export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let autoIdx = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    let idx = autoIdx + 1;
    if (/^\d+$/.test(lines[i].trim())) {
      idx = parseInt(lines[i].trim(), 10);
      i++;
    }
    if (i >= lines.length) break;
    const m = TS.exec(lines[i]);
    if (!m) throw new Error(`Invalid SRT timestamp near line ${i + 1}: ${lines[i]}`);
    const startUs = tsToUs(m[1], m[2], m[3], m[4]);
    const endUs = tsToUs(m[5], m[6], m[7], m[8]);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }
    if (endUs <= startUs) throw new Error(`SRT cue ${idx} has end <= start`);
    cues.push({ index: idx, startUs, endUs, text: textLines.join("\n") });
    autoIdx = idx;
  }
  return cues;
}

// --- Export (export-srt) ---

export interface SubtitleWord {
  word: string;
  startUs: number;
  endUs: number;
}

export interface SubtitleCue {
  startUs: number;
  endUs: number;
  text: string;
  words?: SubtitleWord[]; // real per-word timings when the draft stores them
}

export interface SegmentCue extends SubtitleCue {
  styleRanges?: Array<[number, number]>; // UTF-16LE byte ranges from the material's styles
}

// No stored word timing: spread the cue's duration across its words,
// weighted by character length. Approximate by construction.
export function interpolateWords(text: string, startUs: number, endUs: number): SubtitleWord[] {
  const tokens = Array.from(text.matchAll(/\S+/g), (m) => m[0]);
  const total = tokens.reduce((n, w) => n + w.length, 0);
  if (total === 0) return [];
  const duration = endUs - startUs;
  let seen = 0;
  return tokens.map((word) => {
    const s = startUs + Math.round((duration * seen) / total);
    seen += word.length;
    const e = startUs + Math.round((duration * seen) / total);
    return { word, startUs: s, endUs: e };
  });
}

export function cueWords(cue: SubtitleCue): SubtitleWord[] {
  return cue.words ?? interpolateWords(cue.text, cue.startUs, cue.endUs);
}

// Karaoke captions (`caption --karaoke`) store one segment PER WORD: full
// phrase text, word-timed segment, one style range highlighting that word.
// A run of same-text segments whose highlighted ranges tile the phrase's
// words in order collapses back into a single cue with real word timings.
export function collapseKaraokeRuns(entries: SegmentCue[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let i = 0;
  while (i < entries.length) {
    let j = i + 1;
    while (j < entries.length && entries[j].text === entries[i].text) j++;
    const run = entries.slice(i, j);
    const words = karaokeWords(run);
    if (words) {
      cues.push({
        startUs: run[0].startUs,
        endUs: Math.max(...run.map((e) => e.endUs)),
        text: run[0].text,
        words,
      });
    } else {
      for (const e of run) cues.push({ startUs: e.startUs, endUs: e.endUs, text: e.text });
    }
    i = j;
  }
  return cues;
}

function toUtf16Bytes(text: string, codeUnitIdx: number): number {
  return Buffer.from(text.slice(0, codeUnitIdx), "utf16le").length;
}

function karaokeWords(run: SegmentCue[]): SubtitleWord[] | null {
  if (run.length < 2) return null;
  const text = run[0].text;
  const tokens = [...text.matchAll(/\S+/g)];
  if (tokens.length !== run.length) return null;
  const words: SubtitleWord[] = [];
  for (let k = 0; k < run.length; k++) {
    const tok = tokens[k];
    const at = tok.index ?? 0;
    const byteStart = toUtf16Bytes(text, at);
    const byteEnd = toUtf16Bytes(text, at + tok[0].length);
    const ranges = run[k].styleRanges ?? [];
    if (!ranges.some((r) => r[0] === byteStart && r[1] === byteEnd)) return null;
    if (k > 0 && run[k].startUs < run[k - 1].startUs) return null;
    words.push({ word: tok[0], startUs: run[k].startUs, endUs: run[k].endUs });
  }
  return words;
}

export function renderSrt(cues: Array<{ startUs: number; endUs: number; text: string }>): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startUs)} --> ${srtTime(c.endUs)}\n${c.text}\n`).join("\n");
}

// Word granularity emits ONE cue per phrase with inline word timestamps
// (`one <00:00:01.400>two`) — the karaoke form players understand. A leading
// timestamp is omitted: the first word is active from the cue start.
export function renderVtt(cues: SubtitleCue[], wordTimestamps: boolean): string {
  const blocks = cues.map((c) => {
    const text = wordTimestamps ? vttKaraokeText(c) : c.text;
    return `${vttTime(c.startUs)} --> ${vttTime(c.endUs)}\n${text}\n`;
  });
  return `WEBVTT\n\n${blocks.join("\n")}`;
}

function vttKaraokeText(cue: SubtitleCue): string {
  const words = cueWords(cue);
  if (words.length === 0) return cue.text;
  return (
    words[0].word +
    words
      .slice(1)
      .map((w) => ` <${vttTime(w.startUs)}>${w.word}`)
      .join("")
  );
}
