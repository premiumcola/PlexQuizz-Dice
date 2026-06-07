import { ArrowLeft } from 'lucide-react';
import { navigate } from '../../router';
import QuizConfig from '../../components/QuizConfig';

// X2.1 — quiz options live with the quiz (moved out of general Settings). Scrolls fully:
// bottom padding clears the mobile bottom nav + the iPhone home indicator (safe-area).
export default function QuizConfigPage() {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-12">
        <header className="mb-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/quiz')}
            aria-label="Zurück"
            className="w-10 h-10 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-300" />
          </button>
          <h1 className="font-display-tight text-2xl lg:text-3xl tracking-tight">Quiz-Einstellungen</h1>
        </header>
        <QuizConfig />
      </div>
    </div>
  );
}
