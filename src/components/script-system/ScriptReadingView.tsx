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
          ? '动作'
          : isEnvironmentSpeaker(character)
            ? '旁白'
            : character;
        return (
          <article
            key={id}
            style={{ padding: '12px 0', borderTop: '1px solid #dce2e9' }}
          >
            <small>第 {index + 1} 行</small>
            {content && (
              <p style={{ whiteSpace: 'pre-wrap' }}>
                <strong>{speaker}：</strong>
                {isAction ? character + ' · ' : ''}
                {content}
              </p>
            )}
            {values.If ? <p>条件：{flowText(values.If)}</p> : null}
            {bySource.get(id)?.map((pin) => {
              const dest = pin.targetRowId
                ? byId.get(pin.targetRowId)
                : undefined;
              const to = dest
                ? `第 ${dest.index + 1} 行 · ${flowText(dest.row.values.Content) || '结束'}`
                : pin.kind === 'end'
                  ? '结束'
                  : '未找到目标';
              return (
                <p key={pin.optionIndex ?? 'next'}>
                  {pin.kind === 'option' ? `选择「${pin.text}」：` : '接下来：'}
                  {to}
                </p>
              );
            })}
            {flowText(values.Commands)
              .split(';')
              .map((x) => x.trim())
              .filter((x) => x && !/^(End$|Jump\s)/i.test(x))
              .map((x, i) => (
                <p key={i}>指令：{x}</p>
              ))}
            {bySource.get(id)?.map((pin) => {
              const command =
                pin.optionIndex === undefined
                  ? ''
                  : flowText(values[`Option${pin.optionIndex}_Commands`]);
              return command ? (
                <p key={pin.optionIndex}>
                  选择「{pin.text}」时执行：{command}
                </p>
              ) : null;
            })}
          </article>
        );
      })}
    </div>
  );
}
