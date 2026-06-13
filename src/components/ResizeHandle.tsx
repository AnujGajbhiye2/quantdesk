'use client';

import { Separator } from 'react-resizable-panels';

interface ResizeHandleProps {
  orientation?: 'horizontal' | 'vertical';
}

export default function ResizeHandle({ orientation = 'horizontal' }: ResizeHandleProps) {
  const isH = orientation === 'horizontal';
  return (
    <Separator
      style={{
        flexShrink:     0,
        width:          isH ? 4 : '100%',
        height:         isH ? '100%' : 4,
        background:     'var(--border)',
        cursor:         isH ? 'col-resize' : 'row-resize',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
      }}
      className="resize-handle"
    >
      <div
        style={{
          width:         isH ? 2 : 24,
          height:        isH ? 24 : 2,
          background:    'var(--text-muted)',
          borderRadius:  2,
          opacity:       0.35,
          pointerEvents: 'none',
        }}
      />
    </Separator>
  );
}
