type RoundProgressProps = {
  currentRound: number;
  totalRounds: number;
};

/** One segment per round: done rounds filled, the current one pulsing, the rest empty. */
export function RoundProgress({ currentRound, totalRounds }: RoundProgressProps) {
  return (
    <div
      role="progressbar"
      aria-label="Rounds"
      aria-valuemin={1}
      aria-valuemax={totalRounds}
      aria-valuenow={currentRound}
      aria-valuetext={`Round ${currentRound} of ${totalRounds}`}
      className="flex gap-1.5"
    >
      {Array.from({ length: totalRounds }, (_, index) => {
        const roundNumber = index + 1;
        const state = roundNumber < currentRound ? "done" : roundNumber === currentRound ? "current" : "upcoming";
        return (
          <span
            key={roundNumber}
            className={`h-1.5 flex-1 rounded-full ${
              state === "done" ? "bg-accent" : state === "current" ? "animate-pulse bg-accent/60" : "bg-border"
            }`}
          />
        );
      })}
    </div>
  );
}
