import {
  analyzeFlow,
  flowText,
  type FlowRow,
} from '@/lib/script-system/flow-editing/model';
import { isEnvironmentSpeaker } from '@/lib/script-system/scriptDialogueBlocks';

/** Readable presentation of the current rows, including destinations outside a filtered preview. */
export function ScriptReadingView({
  rows,
  visibleIds,
}: {
  rows: FlowRow[];
  visibleIds?: Set<string>;
}) {
  const byId = new Map(rows.map((row, index) => [row.id, { row, index }]));
  const { outlets } = analyzeFlow(rows);
  const bySource = new Map<string, typeof outlets>();
  for (const outlet of outlets) {
    const list = bySource.get(outlet.rowId) ?? [];
    list.push(outlet);
    bySource.set(outlet.rowId, list);
  }
  return (
    <div>
      {rows.map(({ id, values }, index) => {
        if (visibleIds && !visibleIds.has(id)) return null;
        const character = flowText(values.Name).trim();
        const content = flowText(values.Content).trim();
        const isAction =
          flowText(values.Type) === '3' && !isEnvironmentSpeaker(character);
        const speaker = isAction
          ? 'Action'
          : isEnvironmentSpeaker(character)
            ? 'Narrator'
            : character;
        return (
          <article
            key={id}
            style={{ padding: '12px 0', borderTop: '1px solid #dce2e9' }}
          >
            <small>Line {index + 1}</small>
            {content && (
              <p style={{ whiteSpace: 'pre-wrap' }}>
                <strong>{speaker}: </strong>
                {isAction ? character + ' · ' : ''}
                {content}
              </p>
            )}
            {values.If ? <p>Condition: {flowText(values.If)}</p> : null}
            {bySource.get(id)?.map((pin) => {
              const dest = pin.targetRowId
                ? byId.get(pin.targetRowId)
                : undefined;
              const to = dest
                ? `Line ${dest.index + 1} · ${flowText(dest.row.values.Content) || 'End'}`
                : pin.kind === 'end'
                  ? 'End'
                  : 'Missing target';
              return (
                <p key={pin.optionIndex ?? 'next'}>
                  {pin.kind === 'option' ? `Choice “${pin.text}”: ` : 'Next: '}
                  {to}
                </p>
              );
            })}
            {flowText(values.Commands)
              .split(';')
              .map((x) => x.trim())
              .filter((x) => x && !/^(End$|Jump\s)/i.test(x))
              .map((x, i) => (
                <p key={i}>Command: {x}</p>
              ))}
            {bySource.get(id)?.map((pin) => {
              const command =
                pin.optionIndex === undefined
                  ? ''
                  : flowText(values[`Option${pin.optionIndex}_Commands`]);
              return command ? (
                <p key={pin.optionIndex}>
                  On “{pin.text}”: {command}
                </p>
              ) : null;
            })}
          </article>
        );
      })}
    </div>
  );
}
