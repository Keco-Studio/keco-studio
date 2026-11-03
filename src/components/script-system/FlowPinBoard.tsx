import { useMemo, useState } from 'react';
import { analyzeFlow, flowText, type FlowRow } from '@/lib/script-system/flow-editing/model';
import styles from './ScriptFlowEditor.module.css';

type Props = {
  rows: FlowRow[]; source: string; outlet: string; destination: string; disabled: boolean;
  onOutlet: (row: string, slot: string) => void; onTarget: (row: string) => void;
};

export function FlowPinBoard({ rows, source, outlet, destination, disabled, onOutlet, onTarget }: Props) {
  const [armed, setArmed] = useState(false);
  const cards = useMemo(() => {
    const { outlets } = analyzeFlow(rows);
    const byRow = new Map<string, typeof outlets>();
    for (const pin of outlets) {
      const list = byRow.get(pin.rowId) ?? [];
      list.push(pin);
      byRow.set(pin.rowId, list);
    }
    const bottoms = [16, 64];
    return rows.map((row, i) => {
      const column = i % 2;
      const pins = byRow.get(row.id) ?? [];
      const y = bottoms[column];
      bottoms[column] += 90 + pins.length * 32;
      return { row, pins, x: 22 + column * 310, y };
    });
  }, [rows]);
  const byId = new Map(cards.map(card => [card.row.id, card]));
  const height = Math.max(140, ...cards.map(c => c.y + 72 + c.pins.length * 32));
  function connect(id: string) {
    if (!armed || disabled) return;
    onTarget(id);
    setArmed(false);
  }
  return <><p aria-live="polite">{armed ? 'Choose an input pin to connect.' : 'Drag an output to an input, or click the two pins.'}</p>
    <div className={styles.board} aria-label="Blueprint connections"><div style={{width:580,height,position:'relative'}}>
      <svg aria-hidden="true" width="580" height={height} className={styles.wires}>
        {cards.flatMap(({row,pins,x,y}, i) => pins.map((pin,n) => {
          const slot = String(pin.optionIndex ?? 'ordinary');
          const active = source === row.id && outlet === slot;
          const target = active ? (destination === 'sequence' ? cards[i+1]?.row.id : destination === 'end' ? undefined : destination) : pin.targetRowId;
          const dest = target && byId.get(target);
          if (!dest) return null;
          const start = x+214, top = y+53+n*32, end = dest.x, bottom = dest.y+16;
          const path = end > start ? `M ${start} ${top} C ${start+42} ${top}, ${end-42} ${bottom}, ${end} ${bottom}` :
            `M ${start} ${top} Q ${start+32} ${top}, ${start+20} ${top+18} L ${start+12} ${y+68+pins.length*32} H ${end-14} V ${bottom+8} Q ${end-14} ${bottom}, ${end} ${bottom}`;
          return <path key={row.id+':'+slot} d={path} fill="none" stroke={active?'#ffca64':'#80d9fa'} strokeWidth="2"/>;
        }))}
      </svg>
      {cards.map(({row,pins,x,y},i) => <div key={row.id} className={styles.card} style={{left:x,top:y}}>
        <div className={styles.cardTitle}><button type="button" aria-label={`Connect to row ${i+1}`} disabled={disabled} onDragOver={e=>{if(armed)e.preventDefault();}} onDrop={e=>{e.preventDefault();connect(row.id);}} onClick={()=>connect(row.id)}>●</button><span title={flowText(row.values.Content)}>{i+1}. {flowText(row.values.Content)||'End'}</span></div>
        {pins.map(pin => { const slot = String(pin.optionIndex ?? 'ordinary');
          const pick = () => {onOutlet(row.id,slot);setArmed(true);};
          return <div className={styles.pin} key={slot}><span>{pin.text || pin.kind}</span><button type="button" aria-label={`Output row ${i+1}: ${pin.text || pin.kind}`} aria-pressed={source===row.id && outlet===slot} draggable={!disabled} disabled={disabled}
            onClick={pick} onDragStart={e=>{e.dataTransfer.setData('text/plain',row.id);pick();}} onDragEnd={()=>setArmed(false)}>●</button></div>;
        })}
      </div>)}
    </div></div></>;
}
