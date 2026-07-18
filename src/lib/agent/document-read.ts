export type DocumentReadRequest =
  | { mode?: 'full' }
  | { mode: 'outline' }
  | { mode: 'heading'; heading: string }
  | { mode: 'lines'; startLine: number; endLine: number };

export type DocumentReadSlice = {
  mode: 'full' | 'outline' | 'heading' | 'lines';
  markdown: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  complete: boolean;
};

type Heading = {
  index: number;
  level: number;
  text: string;
};

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*$/;

function headingsFromLines(lines: string[]): Heading[] {
  return lines.flatMap((line, index) => {
    const match = ATX_HEADING.exec(line);
    return match ? [{ index, level: match[1].length, text: match[2].trim() }] : [];
  });
}

export function readDocumentSlice(
  markdown: string,
  request: DocumentReadRequest
): DocumentReadSlice {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const totalLines = lines.length;
  const mode = request.mode ?? 'full';

  if (mode === 'full') {
    return {
      mode,
      markdown: normalized,
      startLine: 1,
      endLine: totalLines,
      totalLines,
      complete: true,
    };
  }

  if (mode === 'outline') {
    const headings = headingsFromLines(lines);
    return {
      mode,
      markdown: headings.map(({ index }) => lines[index]).join('\n'),
      startLine: 1,
      endLine: totalLines,
      totalLines,
      complete: false,
    };
  }

  if (request.mode === 'heading') {
    const requestedHeading = request.heading.trim();
    const headings = headingsFromLines(lines);
    const matches = headings.filter(({ text }) => text === requestedHeading);
    if (matches.length === 0) {
      throw new Error(`Heading "${requestedHeading}" was not found.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Heading "${requestedHeading}" is ambiguous: found ${matches.length} matching headings.`
      );
    }

    const heading = matches[0];
    const nextBoundary = headings.find(
      ({ index, level }) => index > heading.index && level <= heading.level
    );
    const endIndex = nextBoundary ? nextBoundary.index - 1 : lines.length - 1;
    return {
      mode,
      markdown: lines.slice(heading.index, endIndex + 1).join('\n'),
      startLine: heading.index + 1,
      endLine: endIndex + 1,
      totalLines,
      complete: false,
    };
  }

  if (request.mode !== 'lines') {
    throw new Error(`Unsupported document read mode: ${String(request.mode)}`);
  }
  if (!Number.isInteger(request.startLine) || !Number.isInteger(request.endLine)) {
    throw new Error('Line bounds must be integers.');
  }
  if (request.startLine < 1) {
    throw new Error('startLine must be at least 1.');
  }
  if (request.endLine < request.startLine) {
    throw new Error('endLine must be greater than or equal to startLine.');
  }
  if (request.endLine > totalLines) {
    throw new Error(`endLine must not exceed totalLines (${totalLines}).`);
  }

  return {
    mode,
    markdown: lines.slice(request.startLine - 1, request.endLine).join('\n'),
    startLine: request.startLine,
    endLine: request.endLine,
    totalLines,
    complete: request.startLine === 1 && request.endLine === totalLines,
  };
}
