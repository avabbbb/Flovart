import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Input, Pagination, Segmented, message } from 'antd';
import { Search, Heart, Download, Eye, Upload } from 'lucide-react';
import { promptApi, PromptPack, ListPromptsParams } from '../../services/promptApi';
import { useAuth } from '../../hooks/useAuth';
import { AuthModal } from '../auth/AuthModal';
import { PromptDetailDrawer } from './PromptDetailDrawer';
import { PromptUploadModal } from './PromptUploadModal';

type Mode = 'image' | 'video' | 'text' | '';
type Sort = 'latest' | 'popular' | 'downloads';

const SORT_LABELS: Record<Sort, string> = {
  latest: '最新',
  popular: '最热',
  downloads: '下载最多',
};

const MODE_LABELS: Record<string, string> = {
  '': '全部',
  image: '图片',
  video: '视频',
  text: '文本',
};

export function PromptsPage() {
  const navigate = useNavigate();
  const { user, isLoggedIn, authOpen, setAuthOpen } = useAuth();

  const [packs, setPacks] = useState<PromptPack[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [mode, setMode] = useState<Mode>('');
  const [sort, setSort] = useState<Sort>('latest');
  const [loading, setLoading] = useState(false);

  const [selectedPack, setSelectedPack] = useState<PromptPack | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: ListPromptsParams = {
        page,
        size,
        sort,
        ...(keyword && { keyword }),
        ...(mode && { mode: mode as 'image' | 'video' | 'text' }),
      };
      const result = await promptApi.list(params);
      setPacks(result.list || []);
      setTotal(result.total);
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, size, sort, keyword, mode]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
    fetchList();
  };

  const handleLike = async (pack: PromptPack) => {
    if (!isLoggedIn) {
      setAuthOpen(true);
      return;
    }
    try {
      const { liked } = await promptApi.toggleLike(pack.id);
      setPacks((prev) =>
        prev.map((p) =>
          p.id === pack.id
            ? { ...p, likeCount: p.likeCount + (liked ? 1 : -1) }
            : p
        )
      );
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleDownload = async (pack: PromptPack) => {
    try {
      await promptApi.download(pack.id);
      setPacks((prev) =>
        prev.map((p) =>
          p.id === pack.id ? { ...p, downloadCount: p.downloadCount + 1 } : p
        )
      );
    } catch {}
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              className="text-sm text-white/60 hover:text-white"
              onClick={() => navigate('/')}
            >
              ← 返回首页
            </button>
            <h1 className="text-xl font-bold">提示词社区</h1>
          </div>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <span className="text-sm text-white/70">{user?.username}</span>
            ) : (
              <button
                className="text-sm text-white/70 hover:text-white"
                onClick={() => setAuthOpen(true)}
              >
                登录
              </button>
            )}
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/20"
              onClick={() => (isLoggedIn ? setUploadOpen(true) : setAuthOpen(true))}
            >
              <Upload size={14} />
              分享提示词
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Input
            placeholder="搜索提示词标题、描述..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
            prefix={<Search size={16} className="text-white/40" />}
            className="flex-1 min-w-[240px]"
            style={{ maxWidth: 400, background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' }}
          />
          <Segmented
            value={mode}
            onChange={(v) => { setMode(v as Mode); setPage(1); }}
            options={[
              { label: '全部', value: '' },
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '文本', value: 'text' },
            ]}
          />
          <Segmented
            value={sort}
            onChange={(v) => { setSort(v as Sort); setPage(1); }}
            options={[
              { label: '最新', value: 'latest' },
              { label: '最热', value: 'popular' },
              { label: '下载', value: 'downloads' },
            ]}
          />
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-white/40">加载中...</div>
        ) : packs.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-white/40">
            <p>社区还没有提示词，成为第一个分享者吧</p>
            <button
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
              onClick={() => (isLoggedIn ? setUploadOpen(true) : setAuthOpen(true))}
            >
              上传第一个提示词
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {packs.map((pack) => (
              <div
                key={pack.id}
                className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/25 hover:bg-white/10"
                onClick={() => setSelectedPack(pack)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/60">
                    {MODE_LABELS[pack.mode] || pack.mode}
                  </span>
                  {pack.tags?.[0] && (
                    <span className="text-xs text-white/40">#{pack.tags[0]}</span>
                  )}
                </div>
                <h3 className="mb-1 truncate font-semibold text-white">{pack.title}</h3>
                <p className="mb-3 line-clamp-2 text-xs text-white/50">{pack.description || '暂无描述'}</p>
                <div className="flex items-center justify-between text-xs text-white/50">
                  <span>{pack.author?.username || '匿名'}</span>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <Heart size={12} /> {pack.likeCount}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Download size={12} /> {pack.downloadCount}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye size={12} /> {pack.items?.length || 0}条
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    className="flex-1 rounded-md bg-white/10 py-1.5 text-xs hover:bg-white/20"
                    onClick={(e) => { e.stopPropagation(); handleLike(pack); }}
                  >
                    <Heart size={12} className="mr-1 inline" />
                    {pack.likeCount > 0 ? '已赞' : '点赞'}
                  </button>
                  <button
                    className="flex-1 rounded-md bg-white/10 py-1.5 text-xs hover:bg-white/20"
                    onClick={(e) => { e.stopPropagation(); handleDownload(pack); }}
                  >
                    <Download size={12} className="mr-1 inline" />
                    下载
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {total > size && (
          <div className="mt-8 flex justify-center">
            <Pagination
              current={page}
              total={total}
              pageSize={size}
              onChange={setPage}
              showSizeChanger={false}
            />
          </div>
        )}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={fetchList} />
      {selectedPack && (
        <PromptDetailDrawer pack={selectedPack} onClose={() => setSelectedPack(null)} />
      )}
      <PromptUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={fetchList} />
    </div>
  );
}