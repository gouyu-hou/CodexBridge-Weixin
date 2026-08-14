import { useEffect, useState } from 'react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { TextField } from '../../components/ui/Fields';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { PairingState } from '../../types/admin';

type PairingDialogProps = {
  api: AdminApi;
  onClose: () => void;
  onPaired: () => void;
};

export function PairingDialog({ api, onClose, onPaired }: PairingDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = pairing?.status === 'waiting' || pairing?.status === 'starting';

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      void api.getPairing().then((data) => {
        const next = data.pairing ?? null;
        setPairing(next);
        if (next?.status === 'confirmed') onPaired();
      }).catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [active, api, onPaired]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.startPairing(displayName);
      setPairing(data.pairing ?? null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (active) void api.cancelPairing().catch(() => undefined);
    onClose();
  };

  return (
    <Dialog open title="添加微信账号" onClose={close} footer={<Button onClick={close}>关闭</Button>}>
      <div className="pairing-layout">
        {error && <InlineAlert tone="error" title="配对失败">{error}</InlineAlert>}
        <div className="pairing-status-line">
          <span>配对状态</span>
          <StatusBadge tone={pairing?.status === 'confirmed' ? 'success' : active ? 'info' : 'neutral'}>
            {pairing?.status === 'confirmed' ? '配对成功' : active ? '等待扫码' : '尚未开始'}
          </StatusBadge>
        </div>
        <div className="pairing-qr">
          {pairing?.qrImageDataUrl
            ? <img src={pairing.qrImageDataUrl} alt="微信配对二维码" />
            : <span>生成后使用微信扫码确认</span>}
        </div>
        {pairing?.status !== 'confirmed' && (
          <div className="pairing-form">
            <TextField label="备注名称" value={displayName} placeholder="可不填写" onChange={(event) => setDisplayName(event.target.value)} />
            <Button variant="primary" busy={busy} onClick={() => { void start(); }}>生成二维码</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
