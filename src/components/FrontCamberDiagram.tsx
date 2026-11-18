'use client';

import AlignmentCamberDiagram from '@/components/AlignmentCamberDiagram';
import type { AlignmentDiagramProps } from '@/components/TopDownToeDiagram';

// The front axle's camber, seen from in front of the car looking rearward: the right front on the screen's left
export default function FrontCamberDiagram(props: AlignmentDiagramProps) {
  return <AlignmentCamberDiagram {...props} view="front" />;
}
