import './TuningPanel.css';

export type SliderSchema<K extends string> = {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
};

type Props<T extends Record<string, number>> = {
  title: string;
  params: T;
  schema: SliderSchema<Extract<keyof T, string>>[];
  onChange: (next: T) => void;
};

export function TuningPanel<T extends Record<string, number>>({
  title,
  params,
  schema,
  onChange,
}: Props<T>) {
  return (
    <div className="tuning-panel">
      <div className="tuning-title">{title}</div>
      {schema.map((s) => {
        const v = params[s.key];
        return (
          <div key={s.key} className="tuning-row">
            <span className="tuning-label">{s.label}</span>
            <input
              className="tuning-slider"
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={v}
              onChange={(e) =>
                onChange({ ...params, [s.key]: parseFloat(e.target.value) })
              }
            />
            <span className="tuning-value">{v.toFixed(3)}</span>
          </div>
        );
      })}
    </div>
  );
}
