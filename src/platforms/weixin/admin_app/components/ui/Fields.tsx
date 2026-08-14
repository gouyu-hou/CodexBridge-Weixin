import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  useId,
} from 'react';

type FieldFrameProps = {
  children: React.ReactNode;
  error?: string;
  help?: string;
  id: string;
  label: string;
};

function FieldFrame({ children, error, help, id, label }: FieldFrameProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field__error" id={`${id}-message`}>{error}</span> : null}
      {!error && help ? <span className="field__help" id={`${id}-message`}>{help}</span> : null}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  error?: string;
  help?: string;
  label: string;
};

export function TextField({ error, help, label, ...props }: TextFieldProps) {
  const id = useId();
  const describedBy = error || help ? `${id}-message` : undefined;
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      <input {...props} id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)} />
    </FieldFrame>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  error?: string;
  help?: string;
  label: string;
  options: ReadonlyArray<{ disabled?: boolean; label: string; value: string }>;
};

export function SelectField({ error, help, label, options, ...props }: SelectFieldProps) {
  const id = useId();
  const describedBy = error || help ? `${id}-message` : undefined;
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      <select {...props} id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    </FieldFrame>
  );
}

type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

export function Switch({ checked, disabled = false, label, onChange }: SwitchProps) {
  const handleChange = (_event: ChangeEvent<HTMLInputElement>) => onChange(!checked);
  return (
    <label className="switch-field">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={handleChange}
      />
      <span className="switch-track" aria-hidden="true"><span /></span>
      <span>{label}</span>
    </label>
  );
}
