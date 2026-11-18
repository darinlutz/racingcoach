'use client';

import AlignmentCamberDiagram from '@/components/AlignmentCamberDiagram';
import type { AlignmentDiagramProps } from '@/components/TopDownToeDiagram';

// The rear axle's camber, seen from behind the car looking forward: the left rear on the screen's left
export default function RearCamberDiagram(props: AlignmentDiagramProps) {
  return <AlignmentCamberDiagram {...props} view="rear" />;
}
