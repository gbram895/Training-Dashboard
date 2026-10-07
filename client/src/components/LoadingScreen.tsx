import CadenceLoader from './CadenceLoader';

/**
 * A whole-screen wait: the cadence loader centred on an otherwise empty page.
 * Used for route chunks that haven't arrived yet, for pages whose first fetch
 * hasn't landed, and for the launch splash — so every full-page wait in the
 * app is the same thing.
 */
export default function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="page">
      <div className="gd-cadence-page">
        <CadenceLoader size="lg" />
        <span className="gd-cadence-label mono">{label}</span>
      </div>
    </div>
  );
}
