/** CodeMirror counts CRLF as one position. Keep original line endings in stored/exported text. */
export function editorText(value: string) {
  const rawBreaks: number[] = [], docBreaks: number[] = [];
  for (const match of value.matchAll(/\r\n/g)) { rawBreaks.push(match.index); docBreaks.push(match.index - docBreaks.length); }
  const before = (points: number[], position: number) => {
    let low = 0, high = points.length;
    while (low < high) { const mid = (low + high) >>> 1; if (points[mid] < position) low = mid + 1; else high = mid; }
    return low;
  };
  return {
    value, normalized: value.replace(/\r\n?/g, '\n'), lineEnding: value.match(/\r\n|\r|\n/)?.[0] ?? '\n',
    toDoc: (position: number) => position - before(rawBreaks, position),
    toRaw: (position: number) => position + before(docBreaks, position),
  };
}
