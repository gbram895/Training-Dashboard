import CadenceLoader from './CadenceLoader';

export default function PageFallback() {
  return (
    <div className="page">
      <div className="gd-cadence-page">
        <CadenceLoader size="lg" />
        <span className="gd-cadence-label mono">Loading</span>
      </div>
    </div>
  );
}
