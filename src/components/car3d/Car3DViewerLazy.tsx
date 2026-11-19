'use client';

import dynamic from 'next/dynamic';
import type { Car3DViewerProps } from '@/components/car3d/Car3DViewer';

// The 3D viewer for pages: three.js, React Three Fiber and Drei only download when one is shown, and never render on
// the server (they need the browser's WebGL)
const Car3DViewer = dynamic(() => import('@/components/car3d/Car3DViewer'), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg border border-border align-grid" />,
});

export default function Car3DViewerLazy(props: Car3DViewerProps) {
  return <Car3DViewer {...props} />;
}
