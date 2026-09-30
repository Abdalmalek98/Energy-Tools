import { useStore } from '../app/store';
import { Card, PageHead } from '../components/ui';
import { PRODUCT_NAME } from '../settings/defaults';

export function AboutPanel() {
  const { appInfo } = useStore();
  return (
    <dl className="kv">
      <dt>Product</dt><dd>{PRODUCT_NAME}</dd>
      <dt>Version</dt><dd>{appInfo?.version ?? '—'}</dd>
      <dt>Platform</dt><dd>{appInfo ? `${appInfo.os} / ${appInfo.arch}${appInfo.debug ? ' (debug build)' : ''}` : '—'}</dd>
      <dt>Data privacy</dt><dd>All engineering data stays on this computer. The licensing service only receives the license ID, the application version and a hashed machine fingerprint.</dd>
      <dt>Standards</dt><dd>ASHRAE Guideline 14 (CV(RMSE), NMBE), AHRI 550/590 IPLV weights, TR = 3.51685 kW</dd>
    </dl>
  );
}
export function AboutPage() {
  return (
    <>
      <PageHead title="About" />
      <Card><AboutPanel /></Card>
    </>
  );
}
