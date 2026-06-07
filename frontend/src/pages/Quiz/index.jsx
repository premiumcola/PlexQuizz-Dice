// Quiz sub-router. App delegates any /quiz* path here.
import { matchRoute } from '../../router';
import QuizSetup from './QuizSetup';
import QuizPlay from './QuizPlay';
import SoundPlay from './SoundPlay';
import QuizSolutions from './QuizSolutions';
import QuizResult from './QuizResult';
import QuizReview from './QuizReview';
import QuizHistory from './QuizHistory';

export default function QuizRouter({ pathname }) {
  let m;
  if (matchRoute('/quiz/setup', pathname)) return <QuizSetup />;
  if (matchRoute('/quiz/history', pathname)) return <QuizHistory />;
  if ((m = matchRoute('/quiz/play/:roundId', pathname))) return <QuizPlay roundId={m.roundId} />;
  if ((m = matchRoute('/quiz/sound/:roundId', pathname))) return <SoundPlay roundId={m.roundId} />;
  if ((m = matchRoute('/quiz/solutions/:roundId', pathname))) return <QuizSolutions roundId={m.roundId} />;
  if ((m = matchRoute('/quiz/result/:roundId', pathname))) return <QuizResult roundId={m.roundId} />;
  if ((m = matchRoute('/quiz/review/:roundId', pathname))) return <QuizReview roundId={m.roundId} />;
  // No intro page: /quiz lands straight on the round-setup config.
  return <QuizSetup />;
}
