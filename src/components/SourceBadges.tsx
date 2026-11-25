import { ExternalLink, ShieldCheck, Globe } from "lucide-react";
import { cleanDomain, isTier1TrustedSource } from "@/lib/enrichment/domain-filter";

export interface EvidenceSource {
  title?: string;
  url: string;
  extracted_fact?: string;
  trust_score?: number;
  published_date?: string | null;
}

interface SourceBadgesProps {
  sources: EvidenceSource[] | null | undefined;
  className?: string;
}

export default function SourceBadges({ sources, className = "" }: SourceBadgesProps) {
  if (!sources || sources.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 font-mono italic">
        No external web citations logged.
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {sources.map((source, index) => {
        const domain = cleanDomain(source.url);
        const isTier1 = isTier1TrustedSource(source.url) || (source.trust_score && source.trust_score >= 8);

        return (
          <a
            key={index}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${source.title || domain} — ${source.extracted_fact || ""}`}
            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-mono transition border ${
              isTier1
                ? "bg-indigo-950/40 text-indigo-300 border-indigo-700/40 hover:bg-indigo-900/50 hover:border-indigo-500"
                : "bg-slate-900/80 text-slate-300 border-slate-700/50 hover:bg-slate-800 hover:border-slate-500"
            }`}
          >
            {isTier1 ? (
              <ShieldCheck className="w-3 h-3 text-indigo-400 shrink-0" />
            ) : (
              <Globe className="w-3 h-3 text-slate-400 shrink-0" />
            )}
            <span className="truncate max-w-[140px]">{domain}</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
        );
      })}
    </div>
  );
}
