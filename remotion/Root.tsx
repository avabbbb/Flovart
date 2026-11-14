import { Composition } from 'remotion';
import { ProductionVideo } from '../components/reverse/ProductionVideo';
import { toPreviewSequences } from '../services/reverse/remotionAdapter';
import type { ProductionSpecV1 } from '../services/reverse/productionSpec';

export type ProductionCompositionProps = {
  spec: ProductionSpecV1;
  labels?: Record<string, string>;
  language?: 'zho' | 'en';
};

const EMPTY_SPEC: ProductionSpecV1 = {
  schemaVersion: 1,
  projectId: '',
  sourceRevision: 0,
  output: { width: 1920, height: 1080, fps: 30, durationFrames: 1 },
  shots: [],
  renderer: 'remotion',
};

function ProductionComposition({ spec, labels = {}, language = 'zho' }: ProductionCompositionProps) {
  return <ProductionVideo shots={toPreviewSequences(spec, labels)} texts={spec.texts} captions={spec.captions} audio={spec.audio} fontSrc={spec.font?.src} language={language} />;
}

export function RemotionRoot() {
  return (
    <Composition
      id='Production'
      component={ProductionComposition}
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ spec: EMPTY_SPEC }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, props.spec.output.durationFrames),
        fps: props.spec.output.fps,
        width: props.spec.output.width,
        height: props.spec.output.height,
      })}
    />
  );
}
