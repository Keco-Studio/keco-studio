import {
  BorderOutlined,
  DragOutlined,
  HighlightOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RedoOutlined,
  RadiusSettingOutlined,
  SelectOutlined,
  ShareAltOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import styles from '../CreateMapWorkbench.module.css';

export type MapTool = 'select' | 'hand' | 'region' | 'path' | 'placement' | 'rectangle' | 'circle' | 'polygon' | 'mask';

type ToolButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function ToolButton({ label, active = false, disabled = false, onClick, children }: ToolButtonProps) {
  return (
    <span className={styles.tooltipRoot}>
      <button
        type="button"
        className={active ? styles.toolButtonActive : styles.toolButton}
        aria-label={label}
        aria-pressed={active || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      <span role="tooltip" className={styles.tooltip}>{label}</span>
    </span>
  );
}

type MapToolbarProps = {
  mode?: 'plan-review' | 'scene';
  tool: MapTool;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  snapToGrid: boolean;
  onToolChange: (tool: MapTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onSnapChange: (enabled: boolean) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

export function MapToolbar({
  mode = 'scene',
  tool,
  zoom,
  canUndo,
  canRedo,
  snapToGrid,
  onToolChange,
  onUndo,
  onRedo,
  onZoomChange,
  onSnapChange,
  onToggleLeft,
  onToggleRight,
}: MapToolbarProps) {
  const tools: Array<{ id: MapTool; label: string; icon: React.ReactNode }> = mode === 'plan-review'
    ? [
        { id: 'select', label: 'Select structure', icon: <SelectOutlined /> },
        { id: 'hand', label: 'Hand tool', icon: <DragOutlined /> },
        { id: 'region', label: 'Edit terrain regions', icon: <HighlightOutlined /> },
        { id: 'path', label: 'Edit paths', icon: <ShareAltOutlined /> },
        { id: 'placement', label: 'Move planned obstacles', icon: <BorderOutlined /> },
      ]
    : [
        { id: 'select', label: 'Select', icon: <SelectOutlined /> },
        { id: 'hand', label: 'Hand tool', icon: <DragOutlined /> },
        { id: 'rectangle', label: 'Rectangle obstacle', icon: <BorderOutlined /> },
        { id: 'circle', label: 'Circle obstacle', icon: <RadiusSettingOutlined /> },
        { id: 'polygon', label: 'Polygon obstacle', icon: <ShareAltOutlined /> },
        { id: 'mask', label: 'Inpaint mask', icon: <HighlightOutlined /> },
      ];

  return (
    <div className={styles.toolbar} aria-label="Map canvas tools">
      <div className={styles.toolbarGroup}>
        <span className={styles.mobileOnly}><ToolButton label="Toggle source panel" onClick={onToggleLeft}><MenuUnfoldOutlined /></ToolButton></span>
        {tools.map((item) => (
          <ToolButton key={item.id} label={item.label} active={tool === item.id} onClick={() => onToolChange(item.id)}>{item.icon}</ToolButton>
        ))}
      </div>
      <div className={styles.toolbarGroup}>
        <span className={styles.mobileOnly}><ToolButton label="Toggle inspector panel" onClick={onToggleRight}><MenuFoldOutlined /></ToolButton></span>
        <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}><UndoOutlined /></ToolButton>
        <ToolButton label="Redo" disabled={!canRedo} onClick={onRedo}><RedoOutlined /></ToolButton>
        <label className={styles.snapControl}>
          <input type="checkbox" checked={snapToGrid} onChange={(event) => onSnapChange(event.target.checked)} />
          Snap
        </label>
        <ToolButton label="Zoom out" onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}><ZoomOutOutlined /></ToolButton>
        <output className={styles.zoomValue} aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
        <ToolButton label="Zoom in" onClick={() => onZoomChange(Math.min(4, zoom + 0.25))}><ZoomInOutlined /></ToolButton>
      </div>
    </div>
  );
}
