type ProgressBarProps = {
  label: string;
  max?: number;
  value: number;
};

export function ProgressBar({ label, max = 100, value }: ProgressBarProps) {
  const boundedMax = Math.max(1, max);
  const boundedValue = Math.min(Math.max(0, value), boundedMax);
  const percent = (boundedValue / boundedMax) * 100;
  return (
    <div className="progress-block">
      <div className="progress-block__label"><span>{label}</span><strong>{boundedValue} / {boundedMax}</strong></div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={boundedMax}
        aria-valuenow={boundedValue}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
