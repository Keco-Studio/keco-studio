'use client';

import React from 'react';
import { Modal, InputNumber } from 'antd';

export function AiPredictModal(props: {
  open: boolean;
  patternName: string;
  propertyKey: string | null;
  count: number;
  values: number[];
  precision: number;
  onCancel: () => void;
  onOk: () => void;
  onCountChange: (value: number | null) => void;
  onValueChange: (index: number, value: number | null) => void;
}) {
  const {
    open,
    patternName,
    propertyKey,
    count,
    values,
    precision,
    onCancel,
    onOk,
    onCountChange,
    onValueChange,
  } = props;

  return (
    <Modal
      open={open}
      title="AI Predict Next"
      onCancel={onCancel}
      onOk={onOk}
      okText="Apply"
      cancelText="Cancel"
      width={640}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div><strong>Pattern:</strong> {patternName || 'Unknown'}</div>
        <div><strong>Column:</strong> {propertyKey || '-'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span><strong>Rows to predict:</strong></span>
          <InputNumber min={1} max={50} value={count} onChange={onCountChange} />
        </div>
        <div>
          <strong>Predicted values</strong>
          <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
            {values.map((value, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 64, color: '#666' }}>{`+${index + 1}`}</span>
                <InputNumber
                  style={{ width: 180 }}
                  value={value}
                  precision={Math.min(Math.max(precision, 0), 6)}
                  onChange={(next) => onValueChange(index, next)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

