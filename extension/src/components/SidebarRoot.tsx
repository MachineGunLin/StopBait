import { useMemo } from "react";

type SidebarRootProps = {
  visible: boolean;
  onClose: () => void;
};

const sections = [
  { key: "collect", title: "采集模块", desc: "URL/标题自动填充 + Tags + 一键存入" },
  { key: "pool", title: "管理模块", desc: "素材检索、筛选、列表展示" },
  { key: "style", title: "风格引擎", desc: "禁止词/句式与样板文管理" },
  { key: "generate", title: "创作模块", desc: "Writer/Critic 对弈生成与微调" }
];

export function SidebarRoot({ visible, onClose }: SidebarRootProps) {
  const wrapperClass = useMemo(
    () =>
      [
        "fixed right-0 top-0 z-[2147483647] h-screen w-[420px] border-l border-slate-200 bg-white shadow-2xl transition-transform",
        visible ? "translate-x-0" : "translate-x-full"
      ].join(" "),
    [visible]
  );

  return (
    <aside className={wrapperClass}>
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">SoulDraft</h2>
          <p className="text-xs text-slate-500">高效灵感采集与创作台</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          关闭
        </button>
      </header>

      <div className="space-y-3 overflow-y-auto p-4">
        {sections.map((section) => (
          <section key={section.key} className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-medium text-slate-900">{section.title}</h3>
            <p className="mt-1 text-xs text-slate-600">{section.desc}</p>
          </section>
        ))}
      </div>
    </aside>
  );
}
