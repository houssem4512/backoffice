import { TrendingUp, GitMerge, Bot, BarChart3, Sliders, FileText } from 'lucide-react';

interface PlaceholderProps { title: string; icon: React.FC<{ className?: string }>; }
function Placeholder({ title, icon: Icon }: PlaceholderProps) {
  return (
    <section className="fade-in">
      <div className="empty-state">
        <div className="inner">
          <Icon className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p>Page en cours de construction</p>
        </div>
      </div>
    </section>
  );
}

export const Profitability = () => <Placeholder title="Rentabilité" icon={TrendingUp} />;
export const MatchingIA = () => <Placeholder title="Matching IA" icon={GitMerge} />;
export const AgentIA = () => <Placeholder title="Agent IA" icon={Bot} />;
export const Statistics = () => <Placeholder title="Statistiques" icon={BarChart3} />;
export const Settings = () => <Placeholder title="Paramètres" icon={Sliders} />;
export const Journal = () => <Placeholder title="Journal" icon={FileText} />;
