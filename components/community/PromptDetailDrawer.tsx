import { Drawer, Button, Tag, message } from 'antd';
import { Copy, Heart, Download } from 'lucide-react';
import { PromptPack } from '../../services/promptApi';
import { useAuth } from '../../hooks/useAuth';
import { AuthModal } from '../auth/AuthModal';
import { useState } from 'react';

interface Props {
  pack: PromptPack;
  onClose: () => void;
}

export function PromptDetailDrawer({ pack, onClose }: Props) {
  const { isLoggedIn, authOpen, setAuthOpen } = useAuth();
  const [liked, setLiked] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制');
  };

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={pack.title}
        width={520}
        styles={{ body: { background: '#0a0a0a' } }}
      >
        <div className="flex flex-col gap-4 text-white">
          <div className="flex flex-wrap gap-2">
            {pack.tags?.map((t) => (
              <Tag key={t} color="blue">{t}</Tag>
            ))}
          </div>
          <p className="text-sm text-white/70">{pack.description || '暂无描述'}</p>
          <div className="flex gap-3 text-xs text-white/50">
            <span>作者：{pack.author?.username || '匿名'}</span>
            <span>· {pack.likeCount} 赞</span>
            <span>· {pack.downloadCount} 下载</span>
          </div>

          <div className="flex gap-2">
            <Button
              icon={<Heart size={14} />}
              onClick={() => {
                if (!isLoggedIn) { setAuthOpen(true); return; }
                setLiked(!liked);
              }}
            >
              {liked ? '已赞' : '点赞'}
            </Button>
            <Button
              icon={<Download size={14} />}
              onClick={() => message.success('已下载提示词包')}
            >
              下载全部
            </Button>
          </div>

          <div className="space-y-3">
            {(pack.items || []).map((item, idx) => (
              <div
                key={item.id || idx}
                className="rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-white">{item.name}</span>
                  <button
                    className="text-white/50 hover:text-white"
                    onClick={() => handleCopy(item.prompt)}
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <pre className="whitespace-pre-wrap break-words text-xs text-white/60">
                  {item.prompt}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </Drawer>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}