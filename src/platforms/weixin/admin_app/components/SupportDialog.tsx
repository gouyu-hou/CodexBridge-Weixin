import { Heart } from 'lucide-react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

type SupportDialogProps = {
  onClose: () => void;
  open: boolean;
};

export function SupportDialog({ onClose, open }: SupportDialogProps) {
  return (
    <Dialog open={open} title="支持 CodexBridge" onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      <div className="support-dialog">
        <div className="support-dialog__mark"><Heart aria-hidden="true" /></div>
        <h3>感谢你的支持</h3>
        <p>使用微信扫描赞赏码，支持项目持续维护。</p>
        <img src="/donate/wechat-reward.png" alt="微信赞赏码" />
      </div>
    </Dialog>
  );
}
